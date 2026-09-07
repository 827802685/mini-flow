// lock: 防重叠乐观锁（D1 原子更新）
// Cron/定时触发先抢锁，失败即跳过本次（防重复执行）。
// 锁带超时，配合 cleanup 定期清理过期锁。
import type { Env } from '../types';
import { withRetry } from './retry';

export const LOCK_TTL_SECONDS = 600; // 10 分钟，超过视为过期（可清理）

// 尝试获取锁：success=false 表示已被占用（本次跳过）
// 利用 UPDATE ... SET locked_at=now WHERE id=? AND (locked_at IS NULL OR locked_at < expired)
// 若 affected 行数为 1 则抢到锁；0 则被他人持有。
export async function tryAcquireExecutionLock(
  env: Env,
  executionId: string,
  ttlSeconds = LOCK_TTL_SECONDS,
): Promise<{ ok: boolean }> {
  return withRetry(async () => {
    const now = new Date().toISOString();
    const expiredAt = new Date(Date.now() - ttlSeconds * 1000).toISOString();
    const res = await env.DB.prepare(
      "UPDATE executions SET locked_at=? WHERE id=? AND (locked_at IS NULL OR locked_at < ?) AND status IN ('pending','running')",
    ).bind(now, executionId, expiredAt).run();
    return { ok: res.meta.changes === 1 };
  });
}

// 释放锁（完成/失败时）
export function releaseLock(env: Env, executionId: string): Promise<void> {
  return withRetry(async () => {
    await env.DB.prepare('UPDATE executions SET locked_at=NULL WHERE id=?').bind(executionId).run();
  });
}

// 清理过期锁（cron 调用）：把超过 TTL 且仍是 running 的执行标记为 failed（进程死了）
export async function cleanupStaleLocks(env: Env, ttlSeconds = LOCK_TTL_SECONDS): Promise<number> {
  const staleAt = new Date(Date.now() - ttlSeconds * 1000).toISOString();
  const res = await env.DB.prepare(
    "UPDATE executions SET status='failed', error_message='stale lock: worker died', finished_at=datetime('now') WHERE locked_at < ? AND status IN ('pending','running')",
  ).bind(staleAt).run();
  return res.meta.changes;
}