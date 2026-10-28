import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
import worker, { handleUploadMessage, MAX_IMAGE_BYTES, parseUploadEvent, runScheduledCleanup, stripJpegMetadata, VARIANTS, LEGACY_VARIANTS } from "./worker.mjs";

const ID = "9f301dbb-29f3-4ec2-a260-80fdded8977b";
const LEASE = "8641a850-87cb-4051-b496-2f58f5973848";
const SOURCE = `intake/v1/${ID}.jpg`;
const TARGETS = Object.fromEntries(VARIANTS.map(variant => [variant.name, `staged/v1/${ID}/${LEASE}/${variant.file}`]));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const stream = bytes => new Response(bytes).body;
const bytesFrom = async body => new Uint8Array(await new Response(body).arrayBuffer());

async function fixture(options = {}) {
  const source = options.source ?? await sharp({ create: { width: 2400, height: 1200, channels: 3, background: "#397b68" } })
    .jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const records = new Map([[SOURCE, { data: source, httpMetadata: { contentType: "image/jpeg" } }]]);
  const writes = [], reads = [], deleted = [], callbacks = [], transforms = [], logs = [];
  const info = async body => {
    const metadata = await sharp(await bytesFrom(body)).metadata();
    return { format: `image/${metadata.format}`, width: metadata.width, height: metadata.height, fileSize: metadata.size };
  };
  const env = {
    SERVER_ORIGIN: "https://server.example.test",
    INTAKE_BUCKET_NAME: "private-intake",
    IMAGE_WORKER_SECRET: "isolated-worker-secret-at-least-32-characters",
    INTAKE: {
      async get(key) {
        reads.push(key);
        const record = records.get(key);
        return record ? { ...record, body: stream(record.data), size: record.data.length } : null;
      },
      async put(key, data, settings) {
        writes.push({ key, settings });
        assert.deepEqual(settings.onlyIf, { etagDoesNotMatch: "*" });
        assert.equal(settings.httpMetadata.cacheControl, "private, no-store");
        if (records.has(key)) return null;
        records.set(key, { data: new Uint8Array(data), ...settings });
        return { key };
      },
      async delete(keys) {
        deleted.push(...keys);
        for (const key of keys) {
          assert.ok(key === SOURCE || key.startsWith(`staged/v1/${ID}/`), "never deletes public/evidence keys");
          records.delete(key);
        }
      },
    },
    IMAGES: {
      info,
      input(body) {
        const input = bytesFrom(body);
        let transformation;
        const builder = {
          transform(value) { transformation = value; transforms.push(value); return builder; },
          async output(value) {
            assert.deepEqual(Object.keys(value).sort(), ["anim", "format", "quality"]);
            assert.equal(value.anim, false);
            assert.equal(transformation.fit, "scale-down");
            let image = sharp(await input).rotate().resize({
              width: transformation.width, height: transformation.height, fit: "inside", withoutEnlargement: true,
            });
            image = value.format === "image/jpeg"
              ? image.jpeg({ quality: value.quality }).withMetadata()
              : image.webp({ quality: value.quality });
            const output = await image.toBuffer();
            return { response: () => new Response(output, { headers: { "Content-Type": value.format } }) };
          },
        };
        return builder;
      },
    },
  };
  let claimResult = {
    action: "process", leaseToken: LEASE,
    source: { key: SOURCE, sha256: hash(source), sizeBytes: source.length }, targets: TARGETS,
  };
  let completionResult = { action: "ready" };
  const effects = {
    logger: { warn: value => logs.push(JSON.parse(value)) },
    fetch: async (url, init) => {
      const action = new URL(url).pathname.split("/").at(-1);
      const body = JSON.parse(init.body);
      callbacks.push({ url, action, body, init });
      assert.equal(new Headers(init.headers).get("Authorization"), `Bearer ${env.IMAGE_WORKER_SECRET}`);
      assert.equal(init.redirect, "manual");
      return Response.json(action === "claim" ? claimResult : completionResult);
    },
  };
  const message = {
    body: { bucket: env.INTAKE_BUCKET_NAME, action: "PutObject", object: { key: SOURCE, size: source.length } },
    attempts: 1, acknowledgements: 0, retries: [],
    ack() { this.acknowledgements++; }, retry(settings) { this.retries.push(settings); },
  };
  return { env, effects, message, records, reads, writes, deleted, callbacks, transforms, logs, source,
    setClaim(value) { claimResult = value; }, setCompletion(value) { completionResult = value; },
    run() { return handleUploadMessage(message, env, effects); },
  };
}

test("only raw JPEG create events from the configured private bucket are eligible", () => {
  for (const action of ["PutObject", "CopyObject", "CompleteMultipartUpload"]) {
    assert.deepEqual(parseUploadEvent({ bucket: "private", action, object: { key: SOURCE } }, "private"), { uploadId: ID, key: SOURCE });
  }
  for (const event of [null, {}, { bucket: "other", action: "PutObject", object: { key: SOURCE } },
    { bucket: "private", action: "DeleteObject", object: { key: SOURCE } },
    ...[TARGETS.original, `intake/v1/../${ID}.jpg`, "profiles/anything.jpg", "intake/old.jpg", "intake/v1/one.png"].map(key => ({ bucket: "private", action: "PutObject", object: { key } }))]) {
    assert.equal(parseUploadEvent(event, "private"), null);
  }
});

test("complete path generates three private correctly sized files, awaits server commit and then cleans intake", async () => {
  const f = await fixture();
  const collected = [];
  const originalFetch = f.effects.fetch;
  f.effects.fetch = async (url, init) => {
    if (url.endsWith("/complete")) {
      assert.ok(f.records.has(SOURCE));
      for (const variant of VARIANTS) {
        const record = f.records.get(TARGETS[variant.name]);
        assert.ok(record);
        const metadata = await sharp(record.data).metadata();
        assert.equal(Math.max(metadata.width, metadata.height), variant.dimension);
        assert.equal(metadata.height, variant.dimension, "EXIF orientation is applied before metadata is removed");
        assert.equal(metadata.width / metadata.height, 0.5);
        assert.equal(metadata.format, variant.format === "image/jpeg" ? "jpeg" : "webp");
        assert.equal(metadata.exif, undefined);
        assert.equal(metadata.xmp, undefined);
        assert.equal(metadata.iptc, undefined);
        assert.equal(record.customMetadata.sourceSha256, hash(f.source));
        assert.equal(record.customMetadata.sha256, hash(record.data));
        collected.push(record);
      }
    }
    return originalFetch(url, init);
  };
  await f.run();
  assert.equal(f.message.acknowledgements, 1);
  assert.deepEqual(f.message.retries, []);
  assert.equal(f.writes.length, 3);
  assert.equal(collected.length, 3);
  assert.deepEqual(f.callbacks.map(call => call.action), ["claim", "complete"]);
  assert.deepEqual(f.callbacks[1].body, { leaseToken: LEASE });
  assert.deepEqual(f.deleted.sort(), [SOURCE, ...Object.values(TARGETS)].sort());
  assert.equal(f.records.size, 0);
});

test("Worker advertises WebP capability and new jobs retain only processed WebP outputs", async () => {
  const f = await fixture();
  const originalFetch = f.effects.fetch;
  f.effects.fetch = async (url, init) => {
    if (url.endsWith("/complete")) {
      assert.ok(f.records.has(SOURCE), "raw source remains private until server confirms commit");
      assert.equal(f.writes.length, 3);
      for (const { key } of f.writes) {
        assert.ok(key.endsWith(".webp"));
        assert.equal((await sharp(f.records.get(key).data).metadata()).format, "webp");
      }
    }
    return originalFetch(url, init);
  };
  await f.run();
  assert.deepEqual(f.callbacks[0].body, { outputFormats: ["webp-v1", "jpeg-v1"] });
  assert.equal(f.message.acknowledgements, 1);
  assert.equal(f.records.size, 0, "source and private stages are deleted only after final acknowledgement");
});

test("new Worker honors an existing JPEG lease from an old server without changing immutable output keys", async () => {
  const f = await fixture();
  const targets = Object.fromEntries(LEGACY_VARIANTS.map(variant => [variant.name, `staged/v1/${ID}/${LEASE}/${variant.file}`]));
  f.setClaim({ action: "process", leaseToken: LEASE,
    source: { key: SOURCE, sha256: hash(f.source), sizeBytes: f.source.length }, targets });
  let sawLegacyOriginal = false;
  const originalFetch = f.effects.fetch;
  f.effects.fetch = async (url, init) => {
    if (url.endsWith("/complete")) {
      const original = f.records.get(targets.original);
      sawLegacyOriginal = true;
      assert.equal((await sharp(original.data).metadata()).format, "jpeg");
      assert.equal(original.httpMetadata.contentType, "image/jpeg");
      assert.equal(f.records.has(TARGETS.original), false);
    }
    return originalFetch(url, init);
  };
  await f.run();
  assert.ok(sawLegacyOriginal);
  assert.equal(f.message.acknowledgements, 1);
  assert.deepEqual(f.deleted.sort(), [SOURCE, ...Object.values(targets)].sort());
});

test("small images preserve their dimensions without enlargement or cropping", async () => {
  const source = await sharp({ create: { width: 90, height: 45, channels: 3, background: "white" } }).jpeg().toBuffer();
  const f = await fixture({ source });
  f.setCompletion({ action: "retry" });
  await f.run();
  for (const record of [...f.records.values()].slice(1)) {
    const info = await sharp(record.data).metadata();
    assert.equal(info.width, 90); assert.equal(info.height, 45);
  }
  assert.equal(f.message.retries.length, 1);
});

test("duplicate terminal events clean only private paths and never reprocess a committed image", async () => {
  const f = await fixture();
  f.setClaim({ action: "discard", source: { key: SOURCE }, targets: TARGETS });
  await f.run();
  assert.equal(f.message.acknowledgements, 1);
  assert.equal(f.writes.length, 0);
  assert.equal(f.reads.length, 0);
  assert.equal(f.callbacks.length, 1);
  assert.deepEqual(f.deleted.sort(), [SOURCE, ...Object.values(TARGETS)].sort());
});

test("unknown terminal jobs can discard only the event's exact intake object", async () => {
  const f = await fixture();
  f.setClaim({ action: "discard" });
  await f.run();
  assert.deepEqual(f.deleted, [SOURCE]);
  assert.equal(f.message.acknowledgements, 1);
});

test("pending hash mismatches are permanent failures and never create a variant", async () => {
  const f = await fixture();
  f.setClaim({ action: "process", leaseToken: LEASE, source: { key: SOURCE, sha256: "0".repeat(64), sizeBytes: f.source.length }, targets: TARGETS });
  f.setCompletion({ action: "discard" });
  await f.run();
  assert.equal(f.writes.length, 0);
  assert.deepEqual(f.callbacks[1].body, { leaseToken: LEASE, errorCode: "image_hash_mismatch", retryable: false });
  assert.equal(f.message.acknowledgements, 1);
  assert.equal(f.message.retries.length, 0);
});

test("raw size mismatches are rejected before image decoding", async () => {
  const f = await fixture();
  f.setClaim({ action: "process", leaseToken: LEASE, source: { key: SOURCE, sha256: hash(f.source), sizeBytes: f.source.length + 1 }, targets: TARGETS });
  f.setCompletion({ action: "discard" });
  await f.run();
  assert.equal(f.callbacks[1].body.errorCode, "image_size_mismatch");
  assert.equal(f.callbacks[1].body.retryable, false);
  assert.equal(f.writes.length, 0);
});

test("oversized raw objects are rejected before allocating or decoding them", async () => {
  const f = await fixture();
  let cancelled = false;
  f.env.INTAKE.get = async () => ({ size: MAX_IMAGE_BYTES + 1, body: { cancel: async () => { cancelled = true; } } });
  f.setCompletion({ action: "discard" });
  await f.run();
  assert.equal(cancelled, true);
  assert.equal(f.callbacks[1].body.errorCode, "image_too_large");
  assert.equal(f.writes.length, 0);
});

test("pixel limits reject decompression bombs before transforms", async () => {
  const f = await fixture();
  f.env.IMAGES.info = async () => ({ format: "image/jpeg", width: 10_000, height: 10_000 });
  f.setCompletion({ action: "discard" });
  await f.run();
  assert.equal(f.callbacks[1].body.errorCode, "image_dimensions_invalid");
  assert.equal(f.callbacks[1].body.retryable, false);
  assert.equal(f.writes.length, 0);
});

test("non-JPEG payloads cannot enter the JPEG-only protocol even with matching hashes", async () => {
  const source = await sharp({ create: { width: 10, height: 10, channels: 3, background: "white" } }).png().toBuffer();
  const f = await fixture({ source });
  f.setCompletion({ action: "discard" });
  await f.run();
  assert.equal(f.callbacks[1].body.errorCode, "invalid_jpeg");
  assert.equal(f.callbacks[1].body.retryable, false);
});

test("multi-picture JPEG input is not silently flattened into a single accepted product", async () => {
  const f = await fixture();
  const mpf = new Uint8Array([0xff, 0xe2, 0, 6, 0x4d, 0x50, 0x46, 0]);
  const source = Buffer.concat([f.source.subarray(0, 2), mpf, f.source.subarray(2)]);
  f.records.set(SOURCE, { data: source });
  f.setClaim({ action: "process", leaseToken: LEASE, source: { key: SOURCE, sha256: hash(source), sizeBytes: source.length }, targets: TARGETS });
  f.setCompletion({ action: "discard" });
  await f.run();
  assert.equal(f.callbacks[1].body.errorCode, "multi_picture_jpeg_not_allowed");
  assert.equal(f.writes.length, 0);
});

test("metadata stripping preserves the decoded JPEG while removing EXIF/IPTC/comments/private application markers", async () => {
  const f = await fixture();
  const segment = marker => Buffer.from([0xff, marker, 0, 5, 1, 2, 3]);
  const input = Buffer.concat([f.source.subarray(0, 2), segment(0xe3), segment(0xed), segment(0xfe), f.source.subarray(2)]);
  const sanitized = stripJpegMetadata(input);
  const originalPixels = await sharp(input).removeAlpha().raw().toBuffer();
  const sanitizedPixels = await sharp(sanitized).removeAlpha().raw().toBuffer();
  assert.deepEqual(sanitizedPixels, originalPixels);
  assert.equal((await sharp(sanitized).metadata()).exif, undefined);
  assert.ok(sanitized.byteLength < input.byteLength);
  assert.throws(() => stripJpegMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 255, 255])), /invalid_jpeg/);
});

test("an active competing lease retries without reading, writing or deleting anything", async () => {
  const f = await fixture();
  f.effects.fetch = async () => new Response(null, { status: 409 });
  await f.run();
  assert.equal(f.message.acknowledgements, 0);
  assert.deepEqual(f.message.retries, [{ delaySeconds: 15 }]);
  assert.deepEqual(f.deleted, []);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.reads, []);
});

test("a stale complete lease cannot delete files belonging to a newer lease", async () => {
  const f = await fixture();
  const originalFetch = f.effects.fetch;
  f.effects.fetch = (url, init) => url.endsWith("/complete") ? new Response(null, { status: 409 }) : originalFetch(url, init);
  await f.run();
  assert.equal(f.message.acknowledgements, 0);
  assert.equal(f.message.retries.length, 1);
  assert.deepEqual(f.deleted, []);
  assert.equal(f.records.size, 4);
});

test("a lost commit response preserves raw and staged files for server reconciliation", async () => {
  const f = await fixture();
  const originalFetch = f.effects.fetch;
  f.effects.fetch = (url, init) => {
    if (url.endsWith("/complete")) throw new TypeError("Connection dropped after server commit");
    return originalFetch(url, init);
  };
  await f.run();
  assert.equal(f.message.acknowledgements, 0);
  assert.equal(f.message.retries.length, 1);
  assert.equal(f.deleted.length, 0);
  assert.equal(f.records.size, 4);
  f.setClaim({ action: "discard", source: { key: SOURCE }, targets: TARGETS });
  f.effects.fetch = originalFetch;
  await f.run();
  assert.equal(f.message.acknowledgements, 1);
  assert.equal(f.records.size, 0);
  assert.equal(f.writes.length, 3, "reconciliation does not rerun transforms");
});

test("server-requested retry leaves every private file intact", async () => {
  const f = await fixture();
  f.setCompletion({ action: "retry" });
  await f.run();
  assert.equal(f.message.retries.length, 1);
  assert.equal(f.message.acknowledgements, 0);
  assert.equal(f.deleted.length, 0);
  assert.equal(f.records.size, 4);
});

test("transient processing failures report retryable state and never acknowledge successful upload", async () => {
  const f = await fixture();
  f.env.IMAGES.input = () => { throw new TypeError("temporary processing outage"); };
  f.setCompletion({ action: "retry" });
  await f.run();
  assert.deepEqual(f.callbacks[1].body, { leaseToken: LEASE, errorCode: "image_processing_unavailable", retryable: true });
  assert.equal(f.message.acknowledgements, 0);
  assert.equal(f.message.retries.length, 1);
  assert.equal(f.records.has(SOURCE), true);
});

test("unsafe server target keys cannot write or remove another upload's objects", async () => {
  const f = await fixture();
  f.setClaim({ action: "discard", source: { key: SOURCE }, targets: { ...TARGETS, thumbnail: `listings/${ID}.webp` } });
  await f.run();
  assert.equal(f.message.retries.length, 1);
  assert.equal(f.message.acknowledgements, 0);
  assert.equal(f.deleted.length, 0);
});

test("missing bucket configuration retries rather than silently acknowledging queued uploads", async () => {
  const f = await fixture();
  delete f.env.INTAKE_BUCKET_NAME;
  await f.run();
  assert.equal(f.message.acknowledgements, 0);
  assert.equal(f.message.retries.length, 1);
  assert.equal(f.callbacks.length, 0);
});

test("staging events are acknowledged without creating a recursive processing loop", async () => {
  const f = await fixture();
  f.message.body.object.key = TARGETS.original;
  await f.run();
  assert.equal(f.message.acknowledgements, 1);
  assert.equal(f.callbacks.length, 0);
  assert.equal(f.deleted.length, 0);
});

test("an immutable staged result is reusable after a lost write response only with matching bytes and ownership", async () => {
  const f = await fixture();
  f.setCompletion({ action: "retry" });
  await f.run();
  const previousHashes = Object.values(TARGETS).map(key => hash(f.records.get(key).data));
  f.setCompletion({ action: "ready" });
  await f.run();
  assert.equal(f.message.acknowledgements, 1);
  assert.equal(f.writes.length, 6);
  assert.deepEqual(f.writes.slice(3).map(write => write.key), Object.values(TARGETS));
  assert.equal(previousHashes.length, 3);
  assert.equal(f.callbacks.at(-1).body.errorCode, undefined);
});

test("a conflicting existing staged file is rejected instead of overwritten", async () => {
  const f = await fixture();
  const foreign = new Uint8Array([1, 2, 3]);
  f.records.set(TARGETS.original, { data: foreign, customMetadata: { uploadId: "another-upload" } });
  f.setCompletion({ action: "discard" });
  await f.run();
  assert.equal(f.callbacks.at(-1).body.errorCode, "staged_output_conflict");
  assert.equal(f.callbacks.at(-1).body.retryable, false);
  assert.equal(f.writes.length, 1);
  assert.equal(f.message.acknowledgements, 1);
});

test("cleanup failure retries terminal reconciliation without claiming false completion", async () => {
  const f = await fixture();
  f.setClaim({ action: "discard", source: { key: SOURCE }, targets: TARGETS });
  f.env.INTAKE.delete = async () => { throw new TypeError("temporary R2 outage"); };
  await f.run();
  assert.equal(f.message.acknowledgements, 0);
  assert.equal(f.message.retries.length, 1);
  assert.equal(f.records.has(SOURCE), true);
});

test("retry logging excludes bearer credentials and response bodies", async () => {
  const f = await fixture();
  f.message.attempts = 8;
  f.effects.fetch = () => { throw new Error(`provider failure containing ${f.env.IMAGE_WORKER_SECRET}`); };
  await f.run();
  assert.deepEqual(f.message.retries, [{ delaySeconds: 300 }]);
  const serialized = JSON.stringify(f.logs);
  assert.ok(!serialized.includes(f.env.IMAGE_WORKER_SECRET));
  assert.deepEqual(f.logs[0], { event: "image_pipeline_retry", uploadId: ID, code: "server_callback_unavailable",
    upstreamError: "Error: provider failure containing [redacted]" });
});

test("queue-only Worker exposes no public upload, image or administration HTTP route", async () => {
  const response = await worker.fetch(new Request("https://worker.example.test/"));
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("scheduled cleanup calls only the protected server janitor with its Worker credential", async () => {
  const f = await fixture();
  const calls = [];
  f.effects.fetch = async (url, init) => {
    calls.push({ url, init });
    return Response.json({ cleaned: 2, incomplete: 0, expired: 1 });
  };
  const result = await runScheduledCleanup(f.env, f.effects);
  assert.equal(result.cleaned, 2);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://server.example.test/api/internal/image-uploads/cleanup");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.redirect, "manual");
  assert.equal(new Headers(calls[0].init.headers).get("Authorization"), `Bearer ${f.env.IMAGE_WORKER_SECRET}`);
  assert.equal(f.deleted.length, 0, "the server decides deletions, not the cron Worker");
});

test("remaining cleanup backlog is reported as progress, not a deletion failure", async () => {
  const f = await fixture();
  f.effects.fetch = async () => Response.json({ inspected: 10, cleaned: 10, incomplete: 0, remaining: true });
  const result = await runScheduledCleanup(f.env, f.effects);
  assert.equal(result.remaining, true);
  assert.deepEqual(f.logs, []);
});

for (const failure of ["http", "malformed", "oversized", "incomplete", "network"]) {
  test(`scheduled cleanup reports ${failure} failure instead of silently claiming success`, async () => {
    const f = await fixture();
    f.effects.fetch = async () => {
      if (failure === "http") return new Response(null, { status: 503 });
      if (failure === "malformed") return Response.json({ arbitrary: true });
      if (failure === "oversized") return new Response("x".repeat(64 * 1024 + 1));
      if (failure === "network") throw new TypeError("Connection failed");
      return Response.json({ cleaned: 1, incomplete: 1 });
    };
    await assert.rejects(runScheduledCleanup(f.env, f.effects), /server_/);
    assert.equal(f.logs.length, 1);
    assert.equal(f.logs[0].event, "image_pipeline_cleanup_failed");
    assert.equal(JSON.stringify(f.logs).includes(f.env.IMAGE_WORKER_SECRET), false);
  });
}
