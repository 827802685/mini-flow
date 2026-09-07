// 内置节点执行器
// n8n 节点 type 形如 "n8n-nodes-base.httpRequest" / "n8n-nodes-base.if" / "n8n-nodes-base.set"
// 此处按可执行的行为分派（名称剥离前缀后映射）。

import type { NodeExecutor } from '../types';

import { httpRequestNode } from './http-request';
import { setNode, ifNode } from './if-condition';
import { scheduleNode, webhookNode } from './webhook';

// 关键词 → 执行器。通过节点 type 的子串匹配。
export const nodeRegistry: Array<{ match: RegExp; executor: NodeExecutor }> = [
  { match: /httpRequest|http_req/i, executor: httpRequestNode },
  { match: /\.set\b|\.set$|set\b/i, executor: setNode },
  { match: /\.if\b|\.if$|if\b/i, executor: ifNode },
  { match: /schedule|cron|interval/i, executor: scheduleNode },
  { match: /webhook/i, executor: webhookNode },
];

// 兜底：未知节点（走 DLQ / 告警，模版里用 noop 保证不中断骨架）
export function resolveExecutor(nodeType: string): NodeExecutor | null {
  for (const r of nodeRegistry) {
    if (r.match.test(nodeType)) return r.executor;
  }
  return null;
}

export { httpRequestNode, setNode, ifNode, scheduleNode, webhookNode };