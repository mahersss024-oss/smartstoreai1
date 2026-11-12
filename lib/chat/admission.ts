import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/db/prisma';
import { isSessionVersionCurrent, type AuthSession } from '@/lib/auth/session';

type Usage = { day: string; requests: number; leases: Record<string, number> };
const localUsage = new Map<string, Usage>();
// Crash recovery without a maintenance task. Longer than generation/check/retry
// deadlines; leases hold through asynchronous model work, not response headers.
const leaseLifetimeMs = 10 * 60_000;
const localAccountLimit = 10_000;

function configuredInteger(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name]?.trim();
  const value = raw && /^\d+$/.test(raw) ? Number(raw) : fallback;
  return Number.isSafeInteger(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function chatGenerationLimits() {
  return {
    // Preserve the SDK's prior 20-step allowance. Output accommodates draft
    // arguments and platform help; this is per model step, not total billing.
    maxSteps: configuredInteger('SMARTSTORE_CHAT_MAX_STEPS', 20, 1, 20),
    maxOutputTokens: configuredInteger('SMARTSTORE_CHAT_MAX_OUTPUT_TOKENS', 4096, 256, 16384),
    concurrent: configuredInteger('SMARTSTORE_CHAT_MAX_CONCURRENT_PER_USER', 2, 1, 10),
    // A new business allowance is a deployment choice, not an implicit policy.
    // 0 disables this daily ceiling only; other request/model limits remain.
    dailyRequests: configuredInteger('SMARTSTORE_CHAT_DAILY_REQUEST_LIMIT', 0, 0, 100000),
  };
}

function currentUsage(value: unknown, now: number): Usage {
  const day = new Date(now + 3 * 60 * 60_000).toISOString().slice(0, 10);
  const raw = value && typeof value === 'object' ? value as Partial<Usage> : {};
  const leases = Object.fromEntries(Object.entries(raw.leases ?? {}).filter(([key, expiry]) =>
    key.length <= 64 && typeof expiry === 'number' && Number.isSafeInteger(expiry) && expiry > now));
  return { day, requests: raw.day === day && Number.isSafeInteger(raw.requests) && raw.requests! >= 0 ? raw.requests! : 0, leases };
}

function admissionResponse(error: string, retryAfter: number, status = 429) {
  return Response.json({ error, message: '\u062a\u0639\u0630\u0631 \u0628\u062f\u0621 \u0627\u0644\u0645\u062d\u0627\u062f\u062b\u0629 \u0627\u0644\u0622\u0646. \u062d\u0627\u0648\u0644 \u0644\u0627\u062d\u0642\u064b\u0627.' }, {
    status, headers: { 'Cache-Control': 'private, no-store', 'Retry-After': String(retryAfter) },
  });
}

export async function reserveChatGeneration(session: AuthSession): Promise<{
  response?: Response; release: () => Promise<void>;
}> {
  const id = randomUUID();
  const now = Date.now();
  const limits = chatGenerationLimits();
  const database = process.env.SMARTSTORE_MARKETPLACE_STORE === 'database';
  const reserve = (value: unknown) => {
    // Evaluate time only after acquiring the row lock. Parallel requests can
    // otherwise discard leases committed after their earlier captured clock.
    const reservedAt = Date.now();
    const usage = currentUsage(value, reservedAt);
    if (Object.keys(usage.leases).length >= limits.concurrent)
      return { response: admissionResponse('chat_concurrency_limited', 3) };
    if (limits.dailyRequests && usage.requests >= limits.dailyRequests) {
      const nextDay = Date.parse(usage.day + 'T00:00:00Z') + 21 * 60 * 60_000;
      return { response: admissionResponse('chat_daily_limit_reached', Math.max(1, Math.ceil((nextDay - reservedAt) / 1000))) };
    }
    usage.requests++;
    usage.leases[id] = reservedAt + leaseLifetimeMs;
    return { usage };
  };
  let response: Response | undefined;
  try {
    if (database) {
      response = await prisma.$transaction(async tx => {
        const [account] = await tx.$queryRaw<Array<{ chatUsage: unknown; deletedAt: Date | null; sessionVersion: number }>>`
          SELECT "chatUsage", "deletedAt", "sessionVersion" FROM "User" WHERE id = ${session.user.id} FOR UPDATE`;
        if (!account || account.deletedAt || !isSessionVersionCurrent(session, account) || session.expiresAt <= Math.floor(Date.now() / 1000))
          return admissionResponse('auth_required', 1, 401);
        const result = reserve(account.chatUsage);
        if (result.response) return result.response;
        // Raw UPDATE intentionally leaves the public profile updatedAt untouched.
        await tx.$executeRaw`UPDATE "User" SET "chatUsage" = ${JSON.stringify(result.usage)}::jsonb WHERE id = ${session.user.id}`;
        return undefined;
      });
    } else {
      for (const [userId, value] of localUsage) {
        if (!Object.keys(currentUsage(value, now).leases).length && value.day !== currentUsage({}, now).day) localUsage.delete(userId);
      }
      if (!localUsage.has(session.user.id) && localUsage.size >= localAccountLimit)
        response = admissionResponse('chat_admission_unavailable', 3, 503);
      else {
        const result = reserve(localUsage.get(session.user.id));
        response = result.response;
        if (result.usage) localUsage.set(session.user.id, result.usage);
      }
    }
  } catch {
    // A shared database limit must not silently become an instance-local limit.
    console.warn('[chat_admission] reservation_failed');
    response = admissionResponse('chat_admission_unavailable', 3, 503);
  }
  let released = false;
  return { response, release: async () => {
    if (released || response) return;
    released = true;
    try {
      if (database) {
        await prisma.$executeRaw`UPDATE "User" SET "chatUsage" = jsonb_set("chatUsage", '{leases}', COALESCE("chatUsage"->'leases', '{}'::jsonb) - ${id}) WHERE id = ${session.user.id}`;
      } else {
        const usage = localUsage.get(session.user.id);
        if (usage) delete usage.leases[id];
      }
    } catch { console.warn('[chat_admission] release_failed'); }
  } };
}
