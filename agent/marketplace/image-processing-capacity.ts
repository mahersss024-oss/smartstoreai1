export class ImageProcessingCapacityError extends Error {
  readonly code = 'image_processing_busy';
  constructor() { super('Image processing capacity is temporarily unavailable.'); this.name = 'ImageProcessingCapacityError'; }
}

/** Small bounded FIFO. A timed-out waiter is removed before it can start work. */
export function createImageProcessingGate(options: { concurrent: number; queued: number; waitMs: number }) {
  let active = 0;
  const queue: Array<{ start: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }> = [];
  async function run<T>(operation: () => Promise<T>): Promise<T> {
    if (active >= options.concurrent) {
      if (queue.length >= options.queued) throw new ImageProcessingCapacityError();
      await new Promise<void>((resolve, reject) => {
        const waiter = { start: () => { active++; clearTimeout(waiter.timer); resolve(); }, reject,
          timer: setTimeout(() => {
            const index = queue.indexOf(waiter);
            if (index >= 0) queue.splice(index, 1);
            reject(new ImageProcessingCapacityError());
          }, options.waitMs) };
        queue.push(waiter);
      });
    } else active++;
    try { return await operation(); }
    finally { active--; queue.shift()?.start(); }
  }
  return { run };
}

function boundedEnv(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}
let gate: ReturnType<typeof createImageProcessingGate> | undefined;
export function withImageProcessingCapacity<T>(operation: () => Promise<T>) {
  gate ??= createImageProcessingGate({
    concurrent: boundedEnv('SMARTSTORE_IMAGE_PROCESSING_CONCURRENCY', 2, 1, 8),
    queued: boundedEnv('SMARTSTORE_IMAGE_PROCESSING_QUEUE_LIMIT', 8, 0, 32),
    waitMs: boundedEnv('SMARTSTORE_IMAGE_PROCESSING_QUEUE_WAIT_MS', 10_000, 100, 30_000),
  });
  return gate.run(async () => {
    try { return await operation(); }
    catch (error) {
      if (error instanceof Error && /(?:timeout|timed out)/i.test(error.message)) throw new ImageProcessingCapacityError();
      throw error;
    }
  });
}
export function imageProcessingTimeoutSeconds() {
  return boundedEnv('SMARTSTORE_IMAGE_PROCESSING_TIMEOUT_SECONDS', 15, 1, 30);
}
