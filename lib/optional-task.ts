// Bound the caller's wait; the underlying SDK may finish later if it cannot cancel.
export async function runOptionalTask<T>(
  name: string,
  task: () => T | Promise<T>,
  timeoutMs = 2_000,
): Promise<T | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const result = Promise.resolve().then(task).catch((error: unknown) => {
    console.warn(`[optional_task:${name}] failure=${error instanceof Error ? error.name : 'UnknownError'}`);
    return null;
  });
  const expired = new Promise<null>(resolve => {
    timeout = setTimeout(() => {
      console.warn(`[optional_task:${name}] failure=TimeoutError`);
      resolve(null);
    }, timeoutMs);
  });
  try {
    return await Promise.race([result, expired]);
  } finally {
    clearTimeout(timeout);
  }
}
