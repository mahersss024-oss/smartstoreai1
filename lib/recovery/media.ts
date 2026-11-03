import { createHash, createHmac } from 'node:crypto';
import { z } from 'zod';
import { RecoveryError, type RecoveryEnvironment } from './types';

const uuid = z.string().uuid();
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const wireRunSchema = z.object({
  runId: uuid,
  kind: z.enum(['backup', 'restore', 'quarantine_restore']),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  createdAt: z.string().datetime(),
  objects: integer.optional(), bytes: integer.optional(), errors: integer.optional(),
  processedObjects: integer.optional(), processedBytes: integer.optional(),
});
export type RecoveryMediaRun = { id: string; kind: 'backup' | 'quarantine_restore';
  status: 'queued' | 'running' | 'completed' | 'failed'; createdAt: string; objects: number; bytes: number; errors: number };
export type RecoveryMediaStatus = { configured: boolean; monitoringOnly: true; readStatus: 'available' | 'not_configured' | 'unavailable';
  backupEnabled: boolean; quarantineOnly: true; productionCutoverAllowed: false; runs: RecoveryMediaRun[] };
type MediaOptions = { env?: RecoveryEnvironment; fetcher?: typeof fetch; now?: number };

function configuration(env: RecoveryEnvironment) {
  if (env.SMARTSTORE_RECOVERY_MEDIA_MONITORING_ENABLED !== '1') return null;
  const origin = env.SMARTSTORE_RECOVERY_MEDIA_MONITORING_ORIGIN?.trim() ?? '';
  const secret = env.SMARTSTORE_RECOVERY_MEDIA_MONITORING_SECRET?.trim() ?? '';
  if (!origin && !secret) return null;
  let url: URL;
  try { url = new URL(origin); } catch { throw new RecoveryError('recovery_media_configuration_invalid', 503); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/' ||
    url.hostname !== 'recovery-status.souqhamad.com' ||
    secret.length < 32) throw new RecoveryError('recovery_media_configuration_invalid', 503);
  return { origin: url.origin, secret };
}

export function signRecoveryMediaRequest(timestamp: string, method: string, path: string, body: string, secret: string) {
  const digest = createHash('sha256').update(body).digest('hex');
  return createHmac('sha256', secret).update(`${timestamp}\n${method}\n${path}\n${digest}`).digest('hex');
}

async function request(path: string, options: MediaOptions) {
  const env = options.env ?? process.env;
  const config = configuration(env);
  if (!config) throw new RecoveryError('recovery_media_not_configured', 503);
  const encoded = '';
  const timestamp = String(options.now ?? Date.now());
  const method = 'GET';
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { if (reader) void reader.cancel().catch(() => {}); };
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { reject(new RecoveryError('recovery_media_timeout', 503)); controller.abort(); cancel(); }, 12_000);
    });
    const operation = (async () => {
      const response = await (options.fetcher ?? fetch)(`${config.origin}${path}`, {
        method, redirect: 'manual', credentials: 'omit', cache: 'no-store', signal: controller.signal,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Recovery-Timestamp': timestamp,
          'X-Recovery-Signature': signRecoveryMediaRequest(timestamp, method, path, encoded, config.secret) },
      });
      if (response.status < 200 || response.status >= 300 || response.redirected ||
        (response.url && response.url !== `${config.origin}${path}`)) {
        void response.body?.cancel().catch(() => {});
        throw new RecoveryError('recovery_media_unavailable', 503);
      }
      if (!response.body) throw new RecoveryError('recovery_media_invalid_response', 503);
      reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 64 * 1024) throw new RecoveryError('recovery_media_invalid_response', 503);
        chunks.push(chunk.value);
      }
      const joined = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
      try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(joined)) as unknown; }
      catch { throw new RecoveryError('recovery_media_invalid_response', 503); }
    })();
    return await Promise.race([operation, deadline]);
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    throw new RecoveryError('recovery_media_unavailable', 503);
  } finally { clearTimeout(timer); cancel(); }
}

function run(value: unknown): RecoveryMediaRun {
  const result = wireRunSchema.safeParse(value);
  if (!result.success) throw new RecoveryError('recovery_media_invalid_response', 503);
  const data = result.data;
  return { id: data.runId, kind: data.kind === 'backup' ? 'backup' : 'quarantine_restore', status: data.status,
    createdAt: data.createdAt, objects: data.objects ?? data.processedObjects ?? 0,
    bytes: data.bytes ?? data.processedBytes ?? 0, errors: data.errors ?? 0 };
}

export async function getRecoveryMediaStatus(options: MediaOptions = {}): Promise<RecoveryMediaStatus> {
  const base = { configured: false, monitoringOnly: true as const, readStatus: 'not_configured' as const, backupEnabled: false,
    quarantineOnly: true as const, productionCutoverAllowed: false as const, runs: [] as RecoveryMediaRun[] };
  let config;
  try { config = configuration(options.env ?? process.env); } catch { return { ...base, readStatus: 'unavailable' }; }
  if (!config) return base;
  try {
    const response = z.object({ runs: z.array(wireRunSchema).max(20) }).safeParse(await request('/v1/status', options));
    if (!response.success) throw new RecoveryError('recovery_media_invalid_response', 503);
    return { ...base, configured: true, readStatus: 'available',
      runs: response.data.runs.map(run) };
  } catch { return { ...base, configured: true, readStatus: 'unavailable' }; }
}
