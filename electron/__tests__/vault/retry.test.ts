import { describe, it, expect } from 'vitest';
import { withRetry, withRetrySync } from '../../vault/retry';

function makeNodeError(code: string, message = 'file error'): NodeJS.ErrnoException {
  const err = new Error(message) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

describe('withRetry (async)', () => {
  it('returns the result on first success', async () => {
    const result = await withRetry(() => 42);
    expect(result).toBe(42);
  });

  it('retries on EBUSY and succeeds', async () => {
    let attempts = 0;
    const result = await withRetry(
      () => {
        attempts++;
        if (attempts < 3) throw makeNodeError('EBUSY');
        return 'ok';
      },
      3,
      10
    );
    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('retries on EPERM and succeeds', async () => {
    let attempts = 0;
    const result = await withRetry(
      () => {
        attempts++;
        if (attempts < 2) throw makeNodeError('EPERM');
        return 'ok';
      },
      3,
      10
    );
    expect(result).toBe('ok');
    expect(attempts).toBe(2);
  });

  it('retries on EACCES and succeeds', async () => {
    let attempts = 0;
    const result = await withRetry(
      () => {
        attempts++;
        if (attempts < 2) throw makeNodeError('EACCES');
        return 'ok';
      },
      3,
      10
    );
    expect(result).toBe('ok');
  });

  it('throws after exhausting retries', async () => {
    await expect(
      withRetry(
        () => {
          throw makeNodeError('EBUSY');
        },
        2,
        10
      )
    ).rejects.toThrow('file error');
  });

  it('does not retry non-retryable errors', async () => {
    let attempts = 0;
    await expect(
      withRetry(
        () => {
          attempts++;
          throw new Error('ENOENT');
        },
        3,
        10
      )
    ).rejects.toThrow('ENOENT');
    expect(attempts).toBe(1);
  });

  it('works with async functions', async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 2) throw makeNodeError('EBUSY');
        return 'async-ok';
      },
      3,
      10
    );
    expect(result).toBe('async-ok');
  });
});

describe('withRetrySync', () => {
  it('returns the result on first success', () => {
    const result = withRetrySync(() => 42);
    expect(result).toBe(42);
  });

  it('retries on EBUSY and succeeds', () => {
    let attempts = 0;
    const result = withRetrySync(
      () => {
        attempts++;
        if (attempts < 2) throw makeNodeError('EBUSY');
        return 'ok';
      },
      3,
      10
    );
    expect(result).toBe('ok');
    expect(attempts).toBe(2);
  });

  it('throws after exhausting retries', () => {
    expect(() =>
      withRetrySync(
        () => {
          throw makeNodeError('EBUSY');
        },
        2,
        10
      )
    ).toThrow('file error');
  });

  it('does not retry non-retryable errors', () => {
    let attempts = 0;
    expect(() =>
      withRetrySync(
        () => {
          attempts++;
          throw new Error('not retryable');
        },
        3,
        10
      )
    ).toThrow('not retryable');
    expect(attempts).toBe(1);
  });
});
