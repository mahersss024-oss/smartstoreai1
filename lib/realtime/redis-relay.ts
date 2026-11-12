import { randomUUID } from 'node:crypto';
import { fetchWithTimeout } from '@/lib/api/fetch-timeout';
import type { RealtimeEventEnvelope } from './events';

type Command = Array<string | number>;
type CommandRunner = (command: Command, signal?: AbortSignal) => Promise<unknown>;
const eventTypes = new Set(['ad_created', 'ad_updated', 'ad_deleted', 'ad_status_changed',
  'follow_listing_published', 'listing_notification_created', 'message_created',
  'conversation_updated', 'commission_updated', 'moderation_updated', 'maintenance_cleanup']);
const maxEnvelopeBytes = 16 * 1024;
const appendScript = "local id=redis.call('XADD',KEYS[1],'MAXLEN','=',2000,'*','envelope',ARGV[1]);redis.call('EXPIRE',KEYS[1],3600);return id";

export function realtimeRedisConfiguration() {
  if (process.env.SMARTSTORE_REALTIME_BACKEND === 'memory') return null;
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim().replace(/\/$/, '');
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  const stream = process.env.SMARTSTORE_REALTIME_REDIS_STREAM?.trim() || 'smartstore:realtime:v1';
  return { url, token, stream };
}

async function redisCommand(command: Command, signal?: AbortSignal) {
  const config = realtimeRedisConfiguration();
  if (!config) throw new Error('realtime_redis_unconfigured');
  const response = await fetchWithTimeout(config.url, {
    method: 'POST', redirect: 'error', signal,
    headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  }, 2000);
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error('realtime_redis_unavailable');
  }
  // Bound even an invalid upstream body; no credentials or private frames in logs.
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 1024 * 1024) throw new Error('realtime_redis_response_too_large');
      chunks.push(next.value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { result?: unknown; error?: unknown };
  if (!payload || typeof payload !== 'object' || !Object.prototype.hasOwnProperty.call(payload, 'result') || payload.error) {
    throw new Error('realtime_redis_command_failed');
  }
  return payload.result;
}

function decodeEnvelope(raw: string): { origin: string; token: string; event: RealtimeEventEnvelope } | null {
  if (Buffer.byteLength(raw) > maxEnvelopeBytes) return null;
  try {
    const value = JSON.parse(raw);
    const event = value?.event, visibility = event?.visibility;
    if (typeof value.origin !== 'string' || value.origin.length > 128 ||
      typeof value.token !== 'string' || value.token.length > 128 ||
      !Number.isSafeInteger(event?.id) || event.id <= 0 || !eventTypes.has(event?.type) ||
      typeof event.occurredAt !== 'string' || !Number.isFinite(Date.parse(event.occurredAt)) ||
      !event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload) ||
      typeof visibility?.includePublic !== 'boolean' || typeof visibility?.includeAdmins !== 'boolean' ||
      !Array.isArray(visibility.userIds) || visibility.userIds.length > 1000 ||
      visibility.userIds.some((id: unknown) => typeof id !== 'string' || !id || id.length > 256)) return null;
    return value;
  } catch { return null; }
}

/** A bounded shared fan-out log, not a durable customer-facing event cursor.
 * Each replica assigns its own numeric SSE IDs; clients still reconcile API reads.
 */
export class RedisRealtimeRelay {
  private readonly origin = randomUUID();
  private readonly seen = new Set<string>();
  private readonly outgoing: Array<{ value: string; attempts: number }> = [];
  private cursor = '0-0';
  private active = false;
  private writing = false;
  private generation = 0;
  private pollTimer?: ReturnType<typeof setTimeout>;
  private writeTimer?: ReturnType<typeof setTimeout>;
  private controller?: AbortController;
  private lastWarningAt = 0;

  constructor(
    private readonly receive: (event: RealtimeEventEnvelope) => void,
    private readonly command: CommandRunner = redisCommand,
    private readonly configuration = realtimeRedisConfiguration,
  ) {}

  private warn() {
    if (Date.now() - this.lastWarningAt < 60_000) return;
    this.lastWarningAt = Date.now();
    console.warn('[realtime] shared_relay_unavailable');
  }

  publish(event: RealtimeEventEnvelope) {
    if (!this.configuration()) return;
    const value = JSON.stringify({ origin: this.origin, token: randomUUID(), event });
    if (Buffer.byteLength(value) > maxEnvelopeBytes || this.outgoing.length >= 256) { this.warn(); return; }
    this.outgoing.push({ value, attempts: 0 });
    void this.flush();
  }

  private async flush() {
    if (this.writing || this.writeTimer) return;
    this.writing = true;
    try {
      while (this.outgoing.length) {
        const config = this.configuration();
        if (!config) { this.outgoing.length = 0; return; }
        const entry = this.outgoing[0];
        try {
          await this.command(['EVAL', appendScript, 1, config.stream, entry.value]);
          this.outgoing.shift();
        } catch {
          this.warn();
          if (++entry.attempts >= 3) { this.outgoing.shift(); continue; }
          this.writeTimer = setTimeout(() => { this.writeTimer = undefined; void this.flush(); }, 2000);
          this.writeTimer.unref?.();
          return;
        }
      }
    } finally { this.writing = false; }
  }

  start() {
    if (this.active || !this.configuration()) return;
    this.active = true;
    const generation = ++this.generation;
    void this.poll(generation);
  }

  stop() {
    this.active = false;
    this.generation++;
    clearTimeout(this.pollTimer);
    this.pollTimer = undefined;
    this.controller?.abort();
  }

  private async poll(generation: number) {
    if (!this.active || generation !== this.generation) return;
    const config = this.configuration();
    if (!config) { this.stop(); return; }
    const controller = new AbortController();
    this.controller = controller;
    let delay = 1000;
    try {
      const result = await this.command(['XREAD', 'COUNT', 32, 'STREAMS', config.stream, this.cursor], controller.signal);
      if (!this.active || generation !== this.generation) return;
      if (Array.isArray(result)) for (const stream of result) {
        if (!Array.isArray(stream) || stream[0] !== config.stream || !Array.isArray(stream[1])) continue;
        if (stream[1].length === 32) delay = 0;
        for (const entry of stream[1]) {
          if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !/^\d+-\d+$/.test(entry[0]) || !Array.isArray(entry[1])) continue;
          this.cursor = entry[0];
          const index = entry[1].indexOf('envelope');
          const raw = index >= 0 ? entry[1][index + 1] : undefined;
          const envelope = typeof raw === 'string' ? decodeEnvelope(raw) : null;
          if (!envelope || envelope.origin === this.origin || this.seen.has(envelope.token)) continue;
          this.seen.add(envelope.token);
          if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value!);
          this.receive(envelope.event);
        }
      }
    } catch {
      if (this.active && generation === this.generation) { this.warn(); delay = 5000; }
    } finally {
      if (this.controller === controller) this.controller = undefined;
      if (this.active && generation === this.generation) {
        this.pollTimer = setTimeout(() => { void this.poll(generation); }, delay);
        this.pollTimer.unref?.();
      }
    }
  }
}
