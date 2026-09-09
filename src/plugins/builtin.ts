// plugins/builtin: 内置插件 —— n8n-nodes-base 全套基础节点
// 以插件形式把节点元数据 + 执行逻辑统一注册。node-types 只读 registry 输出，
// 保证"编辑器节点面板"与"运行时执行"始终同源，彻底避免节点漏注册。
import type { NodePlugin, PluginNodeType } from './types';
import { registerPlugin } from './registry';

import { manualTriggerNode, webhookNode, scheduleNode } from '../nodes/webhook';
import { httpRequestNode } from '../nodes/http-request';
import { setNode, ifNode } from '../nodes/if-condition';
import { codeNode } from '../nodes/code-node';
import { mergeNode, splitInBatchesNode, delayNode, outputNode } from '../nodes/common';
import {
  noOpNode, errorTriggerNode, respondToWebhookNode, switchNode, removeDuplicatesNode, textSplitterNode,
} from '../nodes/logic';

type Def = Omit<PluginNodeType, 'typeVersion' | 'version' | 'type'> & {
  type: string; typeVersion: number; version: number | number[];
  executor: NodePlugin['nodes'][number]['executor'];
};

// 便捷构造：统一补齐 meta 字段，保证 defaults.name / defaults.color 存在
function def(partial: {
  type: string; name: string; displayName: string; description: string;
  group: string[]; categories?: string[]; icon: string;
  inputs: string[] | string; outputs: string[] | string;
  color?: string; properties?: any[]; version?: number | number[]; typeVersion?: number;
  executor?: any;
}): PluginNodeType {
  const { type, displayName, color, properties: props, executor } = partial;
  // displayName 中文字段友好：defaults.name 用 short 标签（去空格取首个词）
  const short = displayName.length <= 14 ? displayName : displayName.split(/\s+/)[0];
  return {
    type, name: partial.name, typeVersion: partial.typeVersion ?? 1, version: partial.version ?? [1],
    displayName, description: partial.description,
    group: partial.group, categories: partial.categories ?? ['Core Nodes'],
    icon: partial.icon, defaults: { name: short, color: color ?? '#8064a2', typeVersion: partial.typeVersion ?? 1 },
    inputs: partial.inputs, outputs: partial.outputs, properties: props ?? [], executor,
  };
}

const nodes: PluginNodeType[] = [
  // ---- 触发器 ----
  def({ type: 'n8n-nodes-base.manualTrigger', name: 'Manual Trigger', displayName: 'Manual Trigger', description: '在编辑器中点击按钮手动触发', group: ['trigger'], icon: 'fa:mouse-pointer', color: '#ff6d5a', inputs: [], outputs: ['main'], executor: manualTriggerNode }),
  def({ type: 'n8n-nodes-base.webhook', name: 'Webhook', displayName: 'Webhook', description: '通过 URL 接收请求触发', group: ['trigger'], icon: 'fa:globe', inputs: [], outputs: ['main'],
    properties: [
      { displayName: 'HTTP Method', name: 'httpMethod', type: 'options', noDataExpression: true, default: 'GET', options: ['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT'].map((m) => ({ name: m, value: m })) },
      { displayName: 'Path', name: 'path', type: 'string', noDataExpression: true, required: true, default: '', placeholder: 'webhook', description: '监听该路径上的请求' },
    ], executor: webhookNode }),
  def({ type: 'n8n-nodes-base.scheduleTrigger', name: 'Scheduled Trigger', displayName: '定时 Cron', description: '按计划自动运行', group: ['trigger'], icon: 'fa:clock', inputs: [], outputs: ['main'],
    properties: [
      { displayName: 'Rule Type', name: 'rule', type: 'options', noDataExpression: true, default: 'interval', options: [{ name: 'Cron Expression', value: 'cron' }, { name: 'Interval', value: 'interval' }] },
      { displayName: 'Cron Expression', name: 'cronExpression', type: 'string', default: '0 0 * * *' },
      { displayName: 'Interval (minutes)', name: 'minutesInterval', type: 'number', default: 60 },
    ], executor: scheduleNode }),

  // ---- 数据操作 ----
  def({ type: 'n8n-nodes-base.if', name: 'IF', displayName: '条件判断 IF', description: '按条件选择分支', group: ['transform'], icon: 'fa:code-branch', inputs: ['main'], outputs: ['main', 'main'],
    properties: [
      { displayName: 'Field', name: 'conditionSt', type: 'string', default: '' },
    ], executor: ifNode }),
  def({ type: 'n8n-nodes-base.switch', name: 'Switch', displayName: 'Switch', description: '多分支路由', group: ['transform'], icon: 'fa:code-branch', inputs: ['main'], outputs: ['main'], executor: switchNode }),
  def({ type: 'n8n-nodes-base.set', name: 'Set', displayName: '字段赋值 Set', description: '写入字段值', group: ['transform'], icon: 'fa:pen', inputs: ['main'], outputs: ['main'], executor: setNode }),
  def({ type: 'n8n-nodes-base.merge', name: 'Merge', displayName: 'Merge', description: '合并分支数据', group: ['transform'], icon: 'fa:code-merge', inputs: ['main', 'main'], outputs: ['main'], executor: mergeNode }),
  def({ type: 'n8n-nodes-base.removeDuplicates', name: 'Remove Duplicates', displayName: 'Remove Duplicates', description: '按字段去重', group: ['transform'], icon: 'fa:clone', inputs: ['main'], outputs: ['main'], executor: removeDuplicatesNode }),
  def({ type: 'n8n-nodes-base.splitInBatches', name: 'Split In Batches', displayName: 'Split In Batches', description: '分批处理', group: ['transform'], icon: 'fa:columns', inputs: ['main'], outputs: ['main'], executor: splitInBatchesNode }),
  def({ type: 'n8n-nodes-base.delay', name: 'Delay', displayName: 'Delay', description: '延迟/节流', group: ['transform'], icon: 'fa:clock-o', inputs: ['main'], outputs: ['main'], executor: delayNode }),
  def({ type: 'n8n-nodes-base.httpRequest', name: 'HTTP Request', displayName: 'HTTP Request', description: '调用外部 HTTP 接口', group: ['transform'], icon: 'fa:paper-plane', inputs: ['main'], outputs: ['main'],
    properties: [
      { displayName: 'Method', name: 'method', type: 'options', noDataExpression: true, default: 'GET', options: ['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT'].map((m) => ({ name: m, value: m })) },
      { displayName: 'URL', name: 'url', type: 'string', required: true, default: '', placeholder: 'https://example.com' },
      { displayName: 'Body', name: 'jsonBody', type: 'string', typeOptions: { rows: 4 }, default: '' },
    ], executor: httpRequestNode }),

  // ---- 代码/流程 ----
  def({ type: 'n8n-nodes-base.code', name: 'Code', displayName: 'Code', description: '受限表达式求值', group: ['transform'], icon: 'fa:terminus', color: '#ff6d5a', inputs: ['main'], outputs: ['main'],
    properties: [{ displayName: 'Javascript', name: 'javascriptCode', type: 'string', typeOptions: { editor: 'codeNodeEditor', rows: 8 }, default: 'return $json;' }], executor: codeNode }),
  def({ type: 'n8n-nodes-base.function', name: 'Function', displayName: '受限求值', description: '安全公式与函数（受限，非任意 JS）', group: ['transform'], icon: 'fa:tachometer-alt', color: '#ff6d5a', inputs: ['main'], outputs: ['main'], executor: codeNode }),
  def({ type: 'n8n-nodes-base.outputNode', name: 'Output', displayName: 'Output', description: '结果透出', group: ['transform'], icon: 'fa:sign-out', inputs: ['main'], outputs: ['main'], executor: outputNode }),

  // ---- 辅助/透传 ----
  def({ type: 'n8n-nodes-base.noOp', name: 'NoOp', displayName: 'NoOp', description: '透传（无操作）', group: ['transform'], icon: 'fa:circle-o', inputs: ['main'], outputs: ['main'], executor: noOpNode }),
  def({ type: 'n8n-nodes-base.respondToWebhook', name: 'Respond To Webhook', displayName: 'Respond To Webhook', description: '回显输入', group: ['trigger'], icon: 'fa:undo', inputs: ['main'], outputs: ['main'], executor: respondToWebhookNode }),
  def({ type: 'n8n-nodes-base.errorTrigger', name: 'Error Trigger', displayName: 'Error Trigger', description: '错误触发（透传）', group: ['trigger'], icon: 'fa:exclamation-circle', inputs: [], outputs: ['main'], executor: errorTriggerNode }),
  def({ type: 'n8n-nodes-base.stickyNote', name: 'Sticky Note', displayName: '便签', description: '画布便签，无逻辑', group: ['auxiliary'], icon: 'fa:sticky-note-o', inputs: [], outputs: [], executor: noOpNode }),
  def({ type: 'n8n-nodes-base.textSplitter', name: 'Text Splitter', displayName: 'Text Splitter', description: '递归文本切块', group: ['transform'], icon: 'fa:scissors', inputs: ['main'], outputs: ['main'], executor: textSplitterNode }),
];

export const builtinPlugin: NodePlugin = {
  id: 'n8n-nodes-base',
  label: 'n8n-nodes-base',
  description: 'mini-flow 内置基础节点（触发器/数据/流程/代码/工具）',
  isCommunity: false,
  nodes,
};

registerPlugin(builtinPlugin);