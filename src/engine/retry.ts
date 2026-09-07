// withRetry: 指数退避重试（幂等语义见 DECISIONS: 调用方负责幂等，见 checkpoint）
import type { RetryOptions } from '../types';

const DEFAULT: RetryOptions = { maxAttempts: 3, baseDelayMs: 200, maxDelayMs: 5000, factor: 2 };

export function retryOptions(over?: Partial<RetryOptions>): RetryOptions {
  return { ...DEFAULT, ...over };
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// 对操作重试。isRetryable 默认所有异常都可重试；onRetry 用于记录。
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: Partial<RetryOptions> = {},
  onRetry?: (attempt: number, error: unknown) => void,
): Promise<T> {
  const o = retryOptions(opts);
  let lastErr: unknown;
  for (let attempt = 1; attempt <= o.maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      lastErr = e;
      if (attempt >= o.maxAttempts) break;
      onRetry?.(attempt, e);
      const delay = Math.min(o.maxDelayMs, o.baseDelayMs * (Math.pow(o.factor ?? 2, attempt - 1)));
      await sleep(delay);
    }
  }
  throw lastErr;
}