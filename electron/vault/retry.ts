/**
 * Retry utility for file operations that may fail due to cloud-drive file locks.
 *
 * Cloud sync providers (Google Drive, iCloud, Dropbox, OneDrive) can temporarily
 * lock files while syncing, causing EBUSY, EPERM, or EACCES errors. This utility
 * retries the operation with exponential backoff.
 */

/** Error codes that indicate a transient file lock from a cloud sync provider. */
const RETRYABLE_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);

/**
 * Returns true if the error is a transient file-lock error that should be retried.
 */
function isRetryableError(err: unknown): boolean {
  if (err && typeof err === 'object' && 'code' in err) {
    return RETRYABLE_CODES.has((err as { code: string }).code);
  }
  return false;
}

/**
 * Executes `fn` and retries on transient file-lock errors (EBUSY, EPERM, EACCES).
 *
 * Uses exponential backoff: baseDelayMs, baseDelayMs * 2, baseDelayMs * 4, ...
 *
 * @param fn          The (possibly async) function to execute.
 * @param maxRetries  Maximum number of retry attempts (default 3).
 * @param baseDelayMs Base delay in milliseconds before the first retry (default 200).
 * @returns           The return value of `fn`.
 * @throws            The last error if all retries are exhausted.
 */
export async function withRetry<T>(
  fn: () => T | Promise<T>,
  maxRetries = 3,
  baseDelayMs = 200
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (!isRetryableError(err) || attempt === maxRetries) {
        throw err;
      }

      // Exponential backoff: 200ms, 400ms, 800ms, ...
      const delay = baseDelayMs * Math.pow(2, attempt);
      await sleep(delay);
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError;
}

/**
 * Synchronous version of withRetry for use in synchronous code paths.
 * Uses busy-wait (not ideal, but necessary for sync fs operations).
 *
 * @param fn          The synchronous function to execute.
 * @param maxRetries  Maximum number of retry attempts (default 3).
 * @param baseDelayMs Base delay in milliseconds before the first retry (default 200).
 * @returns           The return value of `fn`.
 * @throws            The last error if all retries are exhausted.
 */
export function withRetrySync<T>(
  fn: () => T,
  maxRetries = 3,
  baseDelayMs = 200
): T {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return fn();
    } catch (err) {
      lastError = err;

      if (!isRetryableError(err) || attempt === maxRetries) {
        throw err;
      }

      // Synchronous sleep via busy-wait
      const delay = baseDelayMs * Math.pow(2, attempt);
      sleepSync(delay);
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError as Error;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sleepSync(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // busy-wait
  }
}
