const retryDelaysMs = [200, 500] as const;

export class ImageStorageResponseError extends Error {
  constructor(readonly status: number) {
    super(`Image storage request failed with status ${status}.`);
    this.name = 'ImageStorageResponseError';
  }
}

export function isTransientImageStorageStatus(status: number) {
  return [408, 425, 429].includes(status) || status >= 500;
}

function isTransientFailure(error: unknown) {
  if (error instanceof ImageStorageResponseError) {
    return isTransientImageStorageStatus(error.status);
  }
  return error instanceof Error &&
    ['TypeError', 'AbortError', 'TimeoutError'].includes(error.name);
}

/** One total timeout budget per operation, rather than one full budget per try. */
export async function retryImageStorage<T>(
  operation: (remainingMs: number) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation(Math.max(1, deadline - Date.now()));
    } catch (error) {
      const delay = retryDelaysMs[attempt];
      if (!isTransientFailure(error) || delay === undefined || Date.now() + delay >= deadline) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
