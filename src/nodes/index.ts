// 内置节点执行器
// n8n 节点 type 形如 "n8n-nodes-base.httpRequest" / "n8n-nodes-base.if" / "n8n-nodes-base.set"
// 此处按可执行的行为分派（名称剥离前缀后映射）。

import type { NodeExecutor } from '../types';

import { httpRequestNode } from './http-request';
import { setNode, ifNode } from './if-condition';
import { scheduleNode, webhookNode, manualTriggerNode } from './webhook';
import {
  noOpNode, errorTriggerNode, respondToWebhookNode, switchNode, removeDuplicatesNode, textSplitterNode,
} from './logic';
import { codeNode } from './code-node';
import { mergeNode, splitInBatchesNode, delayNode, outputNode } from './common';
import { filterNode, sortNode, aggregateNode, mathNode, dateTimeNode, extractJsonNode, editFieldsNode } from './transform';

// stickyNote：画布便签，无逻辑。作为 no-op 透传输入，避免模板内的便签节点中断执行。
const stickyNoteNode: NodeExecutor = {
  execute: async (ctx) => (ctx.inputData?.main?.length ? { main: ctx.inputData.main } : { main: [{ json: {} }] }),
};

// passthrough：未知/未实现的节点类型。不做真实逻辑，仅把合并后的上游输入原样向下传递，
// 使模板（往往带大量第三方/AI 节点）能完整跑完，而非中断到 DLQ。节点会在检查点被记录为完成。
export const passthroughNode: NodeExecutor = stickyNoteNode;

// 关键词 → 执行器。通过节点 type 的子串匹配。
export const nodeRegistry: Array<{ match: RegExp; executor: NodeExecutor }> = [
  { match: /manualTrigger|manual_trigger|manual-trigger/i, executor: manualTriggerNode },
  { match: /httpRequest|http_req/i, executor: httpRequestNode },
  { match: /\.set\b|\.set$|set\b/i, executor: setNode },
  { match: /\.if\b|\.if$|if\b/i, executor: ifNode },
  { match: /schedule|cron|interval/i, executor: scheduleNode },
  { match: /webhook/i, executor: webhookNode },
  { match: /stickyNote|sticky_note/i, executor: stickyNoteNode },
  { match: /noOp|noop|\bno-op\b/i, executor: noOpNode },
  { match: /respondToWebhook|respond_to_webhook/i, executor: respondToWebhookNode },
  { match: /\.switch\b|node\.switch|switch/i, executor: switchNode },
  { match: /removeDuplicates|remove_duplicates/i, executor: removeDuplicatesNode },
  { match: /errorTrigger|error_trigger/i, executor: errorTriggerNode },
  { match: /textSplitterRecursiveCharacterTextSplitter|recursiveCharacterTextSplitter/i, executor: textSplitterNode },
  { match: /\.code\b|\.code$|node\.code/i, executor: codeNode },
  { match: /function|\.fn\b|Function/i, executor: codeNode },
  { match: /node\.merge|\.merge\b|merge/i, executor: mergeNode },
  { match: /splitInBatches|split_in_batches|splitInBatch/i, executor: splitInBatchesNode },
  { match: /node\.delay|\.delay\b|delay/i, executor: delayNode },
  { match: /outputNode|node\.output|\.output\b/i, executor: outputNode },
  { match: /node\.filter|\.filter\b|filter/i, executor: filterNode },
  { match: /node\.sort|\.sort\b/i, executor: sortNode },
  { match: /node\.aggregate|\.aggregate\b|aggregation/i, executor: aggregateNode },
  { match: /node\.math|\.math\b|math/i, executor: mathNode },
  { match: /dateTime|date_time|node\.date/i, executor: dateTimeNode },
  { match: /extractFromFile|extractFromJson|extract.*json/i, executor: extractJsonNode },
  { match: /editFields|edit_fields|node\.set\b|node\.editFields/i, executor: editFieldsNode },
];

// 兜底：未知节点 → 返回 passthrough（透传），保证模板执行不中断。
export function resolveExecutor(nodeType: string): NodeExecutor | null {
  for (const r of nodeRegistry) {
    if (r.match.test(nodeType)) return r.executor;
  }
  return passthroughNode;
}

export { httpRequestNode, setNode, ifNode, scheduleNode, webhookNode };