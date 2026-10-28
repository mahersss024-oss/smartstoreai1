/* Queue-only image processing. This Worker has no public bucket binding and
 * cannot publish listings. The application server owns claims and finalization.
 */
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 45_000_000;
export const VARIANTS = Object.freeze([
  { name: "original", dimension: 1800, quality: 84, format: "image/webp", file: "original.webp" },
  { name: "display", dimension: 900, quality: 78, format: "image/webp", file: "display.webp" },
  { name: "thumbnail", dimension: 360, quality: 68, format: "image/webp", file: "thumbnail.webp" },
]);
// Keep old leases and either server/Worker deployment order compatible. The
// server persists the negotiated choice in its lease targets before processing.
export const LEGACY_VARIANTS = Object.freeze(VARIANTS.map(variant => variant.name === "original"
  ? { ...variant, quality: 88, format: "image/jpeg", file: "original.jpg" } : variant));
const variantsForTargets = targets => typeof targets?.original === "string" && targets.original.endsWith("/original.webp") ? VARIANTS : LEGACY_VARIANTS;
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SOURCE_KEY = /^intake\/v1\/([A-Za-z0-9_-]{1,128})\.jpg$/;
const CREATE_ACTIONS = new Set(["PutObject", "CopyObject", "CompleteMultipartUpload"]);
const PRIVATE_METADATA = { cacheControl: "private, no-store" };
const CLAIM_TIMEOUT_MS = 10_000;
const COMPLETE_TIMEOUT_MS = 180_000;
const CLEANUP_TIMEOUT_MS = 120_000;

class PipelineError extends Error {
  constructor(code, retryable = true, upstreamStatus = undefined, upstreamError = undefined) {
    super(code);
    this.name = "PipelineError";
    this.code = code;
    this.retryable = retryable;
    this.upstreamStatus = upstreamStatus;
    this.upstreamError = upstreamError;
  }
}

export async function sha256(bytes) {
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function bytesStream(bytes) {
  return new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
}

function concatenate(parts) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

async function limitedBytes(stream, maximum = MAX_IMAGE_BYTES) {
  if (!stream) throw new PipelineError("image_body_missing");
  const reader = stream.getReader();
  const chunks = [];
  let count = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      count += chunk.value.byteLength;
      if (count > maximum) throw new PipelineError("image_too_large", false);
      chunks.push(chunk.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  return concatenate(chunks);
}

function jpegSegments(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new PipelineError("invalid_jpeg", false);
  }
  const segments = [];
  let offset = 2;
  while (offset < bytes.length) {
    const start = offset;
    if (bytes[offset++] !== 0xff) throw new PipelineError("invalid_jpeg", false);
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) {
      segments.push({ marker, start, end: bytes.length, payload: offset });
      return segments;
    }
    if (offset + 2 > bytes.length || marker === 0 || marker === undefined) throw new PipelineError("invalid_jpeg", false);
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    const end = offset + length;
    if (length < 2 || end > bytes.length) throw new PipelineError("invalid_jpeg", false);
    segments.push({ marker, start, end, payload: offset + 2 });
    offset = end;
  }
  throw new PipelineError("invalid_jpeg", false);
}

export function stripJpegMetadata(bytes) {
  // Images applies EXIF orientation/color before encoding. Its binding does not
  // expose the URL API's metadata option. Strip EXIF/XMP, ICC/MPF, IPTC and COM
  // from the re-encoded JPEG; retain JPEG/JFIF and Adobe color decoding markers.
  return concatenate([bytes.subarray(0, 2), ...jpegSegments(bytes)
    .filter(segment => segment.marker !== 0xfe &&
      !(segment.marker >= 0xe1 && segment.marker <= 0xef && segment.marker !== 0xee))
    .map(segment => bytes.subarray(segment.start, segment.end))]);
}

function assertStaticJpeg(bytes) {
  const segments = jpegSegments(bytes);
  if (segments.some(segment => segment.marker === 0xe2 &&
    bytes[segment.payload] === 0x4d && bytes[segment.payload + 1] === 0x50 && bytes[segment.payload + 2] === 0x46 && bytes[segment.payload + 3] === 0)) {
    throw new PipelineError("multi_picture_jpeg_not_allowed", false);
  }
}

function assertInfo(info, format, dimension = null) {
  if (info?.format !== format) throw new PipelineError("image_type_mismatch", false);
  if (!Number.isSafeInteger(info.width) || !Number.isSafeInteger(info.height) || info.width < 1 || info.height < 1 ||
    info.width * info.height > MAX_IMAGE_PIXELS || (dimension && Math.max(info.width, info.height) > dimension)) {
    throw new PipelineError("image_dimensions_invalid", false);
  }
}

export function parseUploadEvent(body, expectedBucket) {
  if (!body || typeof body !== "object" || body.bucket !== expectedBucket || !CREATE_ACTIONS.has(body.action)) return null;
  const match = typeof body.object?.key === "string" && SOURCE_KEY.exec(body.object.key);
  return match ? { uploadId: match[1], key: body.object.key } : null;
}

function validateConfiguration(env) {
  let origin;
  try { origin = new URL(env.SERVER_ORIGIN); } catch { throw new PipelineError("worker_configuration_invalid"); }
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash ||
    origin.pathname !== "/" || origin.hostname.endsWith(".invalid") || typeof env.IMAGE_WORKER_SECRET !== "string" || env.IMAGE_WORKER_SECRET.length < 32 ||
    !env.INTAKE_BUCKET_NAME || !env.INTAKE || !env.IMAGES) throw new PipelineError("worker_configuration_invalid");
  return origin.origin;
}

function validateTargets(targets, uploadId, leaseToken) {
  if (!targets || typeof targets !== "object") throw new PipelineError("worker_contract_invalid");
  let prefix;
  for (const variant of variantsForTargets(targets)) {
    const key = targets[variant.name];
    const match = typeof key === "string" && key.match(/^staged\/v1\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{1,128})\/(original\.(?:jpg|webp)|display\.webp|thumbnail\.webp)$/);
    if (!match || match[1] !== uploadId || match[3] !== variant.file || (leaseToken && match[2] !== leaseToken)) throw new PipelineError("worker_contract_invalid");
    if (prefix && prefix !== match[2]) throw new PipelineError("worker_contract_invalid");
    prefix = match[2];
  }
  return targets;
}

function validateClaim(claim, upload) {
  if (!claim || !["process", "discard"].includes(claim.action)) throw new PipelineError("worker_contract_invalid");
  if (claim.source && claim.source.key !== upload.key) throw new PipelineError("worker_contract_invalid");
  if (claim.targets) validateTargets(claim.targets, upload.uploadId, claim.action === "process" ? claim.leaseToken : null);
  if (claim.action === "discard") return;
  if (typeof claim.leaseToken !== "string" || !SAFE_ID.test(claim.leaseToken) || claim.source?.key !== upload.key ||
    !/^[a-f0-9]{64}$/.test(claim.source?.sha256) || !Number.isSafeInteger(claim.source?.sizeBytes) || claim.source.sizeBytes < 1 || claim.source.sizeBytes > MAX_IMAGE_BYTES || !claim.targets) {
    throw new PipelineError("worker_contract_invalid");
  }
}

async function serverCall(fetcher, origin, env, path, body, timeoutMs = CLAIM_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(`${origin}${path}`, {
      // Cloudflare Workers support only `follow` and `manual`; manual keeps
      // this internal callback from following any origin redirect.
      method: "POST", redirect: "manual", signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.IMAGE_WORKER_SECRET}` },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      await response.body?.cancel();
      // 409 also means a different lease is live. Never interpret it as a
      // cancellation or delete any private objects on behalf of an old lease.
      throw new PipelineError(response.status === 409 ? "lease_busy" : "server_callback_unavailable", true, response.status);
    }
    let payload;
    try { payload = JSON.parse(new TextDecoder().decode(await limitedBytes(response.body, 64 * 1024))); }
    catch { throw new PipelineError("server_callback_invalid"); }
    if (controller.signal.aborted) throw new PipelineError("server_callback_timeout");
    return payload;
  } catch (error) {
    if (error instanceof PipelineError) throw error;
    const message = error instanceof Error ? `${error.name}: ${error.message}` : "unknown fetch error";
    const safeMessage = message.replaceAll(env.IMAGE_WORKER_SECRET, "[redacted]").replaceAll(origin, "[origin]").slice(0, 160);
    throw new PipelineError(controller.signal.aborted ? "server_callback_timeout" : "server_callback_unavailable", true, undefined, safeMessage);
  } finally { clearTimeout(timeout); }
}

function callback(fetcher, origin, env, uploadId, action, body) {
  return serverCall(fetcher, origin, env,
    `/api/internal/image-uploads/${encodeURIComponent(uploadId)}/${action}`, body,
    action === "complete" ? COMPLETE_TIMEOUT_MS : CLAIM_TIMEOUT_MS);
}

async function readSource(env, claim) {
  const object = await env.INTAKE.get(claim.source.key);
  if (!object?.body) throw new PipelineError("image_source_missing");
  if (object.size > MAX_IMAGE_BYTES) {
    await object.body.cancel();
    throw new PipelineError("image_too_large", false);
  }
  const bytes = await limitedBytes(object.body);
  if (bytes.length !== claim.source.sizeBytes) throw new PipelineError("image_size_mismatch", false);
  if (await sha256(bytes) !== claim.source.sha256) throw new PipelineError("image_hash_mismatch", false);
  assertStaticJpeg(bytes);
  let info;
  try { info = await env.IMAGES.info(bytesStream(bytes)); }
  catch (error) {
    if (error?.code === 9412) throw new PipelineError("invalid_jpeg", false);
    throw error;
  }
  assertInfo(info, "image/jpeg");
  return { bytes, info };
}

async function storeStage(env, uploadId, claim, variant, bytes) {
  const hash = await sha256(bytes);
  const key = claim.targets[variant.name];
  const stored = await env.INTAKE.put(key, bytes, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { ...PRIVATE_METADATA, contentType: variant.format },
    customMetadata: { uploadId, leaseToken: claim.leaseToken, sourceSha256: claim.source.sha256, sha256: hash },
  });
  if (stored) return;
  // A lost response may leave an immutable staged object. Reuse it only if the
  // actual bytes and ownership metadata match; never overwrite a verified stage.
  const existing = await env.INTAKE.get(key);
  if (!existing?.body || existing.size > MAX_IMAGE_BYTES || existing.customMetadata?.uploadId !== uploadId ||
    existing.customMetadata?.leaseToken !== claim.leaseToken || existing.customMetadata?.sourceSha256 !== claim.source.sha256) {
    await existing?.body?.cancel();
    throw new PipelineError("staged_output_conflict", false);
  }
  if (await sha256(await limitedBytes(existing.body)) !== hash) throw new PipelineError("staged_output_conflict", false);
}

async function processImage(env, uploadId, claim) {
  const { bytes, info: sourceInfo } = await readSource(env, claim);
  // Sequential transforms bound per-invocation memory and service concurrency.
  for (const variant of variantsForTargets(claim.targets)) {
    const output = await env.IMAGES.input(bytesStream(bytes))
      .transform({ width: variant.dimension, height: variant.dimension, fit: "scale-down" })
      .output({ format: variant.format, quality: variant.quality, anim: false });
    const response = output.response();
    if (!response.ok || response.headers.get("content-type")?.split(";")[0] !== variant.format) throw new PipelineError("image_output_invalid");
    let transformed = await limitedBytes(response.body);
    if (variant.format === "image/jpeg") transformed = stripJpegMetadata(transformed);
    const info = await env.IMAGES.info(bytesStream(transformed));
    assertInfo(info, variant.format, variant.dimension);
    // EXIF orientation may swap axes; area and the unordered pair still forbid
    // enlargement. scale-down itself preserves the entire source image.
    if (Math.max(info.width, info.height) > Math.max(sourceInfo.width, sourceInfo.height) ||
      Math.min(info.width, info.height) > Math.min(sourceInfo.width, sourceInfo.height)) throw new PipelineError("image_output_enlarged", false);
    await storeStage(env, uploadId, claim, variant, transformed);
  }
}

async function cleanPrivate(env, upload, targets) {
  const keys = [upload.key];
  if (targets) keys.push(...VARIANTS.map(variant => targets[variant.name]));
  await env.INTAKE.delete(keys);
}

async function finish(fetcher, origin, env, upload, claim, body) {
  const result = await callback(fetcher, origin, env, upload.uploadId, "complete", body);
  if (result?.action === "retry") throw new PipelineError("server_requested_retry");
  if (!["ready", "discard"].includes(result?.action)) throw new PipelineError("worker_contract_invalid");
  // Only an explicit committed terminal response authorizes cleanup. Network,
  // HTML/error responses, active leases and retry responses preserve all inputs.
  await cleanPrivate(env, upload, claim.targets);
}

export async function handleUploadMessage(message, env, dependencies = {}) {
  const fetcher = dependencies.fetch ?? globalThis.fetch;
  const logger = dependencies.logger ?? console;
  let upload;
  try {
    const origin = validateConfiguration(env);
    upload = parseUploadEvent(message.body, env.INTAKE_BUCKET_NAME);
    if (!upload) { message.ack(); return; }
    const claim = await callback(fetcher, origin, env, upload.uploadId, "claim", { outputFormats: ["webp-v1", "jpeg-v1"] });
    validateClaim(claim, upload);
    if (claim.action === "discard") {
      await cleanPrivate(env, upload, claim.targets);
      message.ack();
      return;
    }
    try { await processImage(env, upload.uploadId, claim); }
    catch (error) {
      const known = error instanceof PipelineError ? error : new PipelineError("image_processing_unavailable");
      await finish(fetcher, origin, env, upload, claim, { leaseToken: claim.leaseToken, errorCode: known.code, retryable: known.retryable });
      message.ack();
      return;
    }
    await finish(fetcher, origin, env, upload, claim, { leaseToken: claim.leaseToken });
    message.ack();
  } catch (error) {
    const code = error instanceof PipelineError ? error.code : "image_pipeline_unavailable";
    logger.warn(JSON.stringify({ event: "image_pipeline_retry", ...(upload ? { uploadId: upload.uploadId } : {}), code,
      ...(error instanceof PipelineError && error.upstreamStatus ? { upstreamStatus: error.upstreamStatus } : {}),
      ...(error instanceof PipelineError && error.upstreamError ? { upstreamError: error.upstreamError } : {}) }));
    const delaySeconds = Math.min(300, 15 * 2 ** Math.min(Math.max(0, (message.attempts ?? 1) - 1), 5));
    message.retry({ delaySeconds });
  }
}

/** Application server retains job records and decides which files are disposable. */
export async function runScheduledCleanup(env, dependencies = {}) {
  const fetcher = dependencies.fetch ?? globalThis.fetch;
  const logger = dependencies.logger ?? console;
  try {
    const origin = validateConfiguration(env);
    const result = await serverCall(fetcher, origin, env, "/api/internal/image-uploads/cleanup", {}, CLEANUP_TIMEOUT_MS);
    if (!Number.isSafeInteger(result?.cleaned) || result.cleaned < 0 ||
      !Number.isSafeInteger(result?.incomplete) || result.incomplete < 0) {
      throw new PipelineError("server_cleanup_invalid");
    }
    if (result.incomplete) throw new PipelineError("server_cleanup_incomplete");
    return result;
  } catch (error) {
    const code = error instanceof PipelineError ? error.code : "server_cleanup_unavailable";
    logger.warn(JSON.stringify({ event: "image_pipeline_cleanup_failed", code }));
    // A failed scheduled event is observable and not reported as a successful cleanup.
    throw new Error(code);
  }
}

const imagePipelineWorker = {
  // No HTTP image/administration endpoint and no public-bucket access.
  async fetch() { return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } }); },
  async queue(batch, env) {
    for (const message of batch.messages) await handleUploadMessage(message, env);
  },
  async scheduled(_event, env) { await runScheduledCleanup(env); },
};

export default imagePipelineWorker;
