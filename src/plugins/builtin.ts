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
import { filterNode, sortNode, aggregateNode, mathNode, dateTimeNode, extractJsonNode, editFieldsNode } from '../nodes/transform';
import { d1QueryNode, dbPlaceholderNode } from '../nodes/db';
import { cronNode, formTriggerNode, intervalNode } from '../nodes/triggers';
import { openaiChatNode, aiPlaceholderNode } from '../nodes/ai';
import { textReplaceNode, regexExtractNode, textCaseNode, textSplitNode, textTemplateNode, textTruncateNode, textCountNode } from '../nodes/text';
import { limitNode, renameKeysNode, zipNode, itemListsNode, storeNode, convertToJsonNode, joinListNode, assignNode } from '../nodes/util';
import { httpSendNode, notifyPlaceholderNode, webhookSendNode } from '../nodes/notify';
import { telegramChannelNode } from '../nodes/telegram';
import { weComSendNode, translateNode } from '../nodes/messaging';

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
  // 关键：n8n 的 INodeTypeDescription.name 必须等于完整类型(type)，而非可读标签。
  // 前端 nodeTypes store 用 nodeType.name 建索引，getNodeType(node.type) 按其查询；
  // 若 name 用短标签("Manual Trigger")，画布用 type("n8n-nodes-base.manualTrigger")
  // 查表会 miss → 图标渲染成 "?" 且无法打开参数面板。故这里强制 name=type。
  // displayName 中文字段友好：defaults.name 用 short 标签（去空格取首个词）
  const short = displayName.length <= 14 ? displayName : displayName.split(/\s+/)[0];
  return {
    type, name: type, typeVersion: partial.typeVersion ?? 1, version: partial.version ?? [1],
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
  def({ type: 'n8n-nodes-base.delay', name: 'Delay', displayName: 'Delay', description: '延迟/节流', group: ['transform'], icon: 'fa:clock', inputs: ['main'], outputs: ['main'], executor: delayNode }),
  def({ type: 'n8n-nodes-base.httpRequest', name: 'HTTP Request', displayName: 'HTTP Request', description: '调用外部 HTTP 接口', group: ['transform'], icon: 'fa:paper-plane', inputs: ['main'], outputs: ['main'],
    properties: [
      { displayName: 'Method', name: 'method', type: 'options', noDataExpression: true, default: 'GET', options: ['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT'].map((m) => ({ name: m, value: m })) },
      { displayName: 'URL', name: 'url', type: 'string', required: true, default: '', placeholder: 'https://example.com' },
      { displayName: 'Body', name: 'jsonBody', type: 'string', typeOptions: { rows: 4 }, default: '' },
    ], executor: httpRequestNode }),

  // ---- 代码/流程 ----
  def({ type: 'n8n-nodes-base.code', name: 'Code', displayName: 'Code', description: '受限表达式求值', group: ['transform'], icon: 'fa:code', color: '#ff6d5a', inputs: ['main'], outputs: ['main'],
    properties: [{ displayName: 'Javascript', name: 'javascriptCode', type: 'string', typeOptions: { editor: 'codeNodeEditor', rows: 8 }, default: 'return $json;' }], executor: codeNode }),
  def({ type: 'n8n-nodes-base.function', name: 'Function', displayName: '受限求值', description: '安全公式与函数（受限，非任意 JS）', group: ['transform'], icon: 'fa:tachometer-alt', color: '#ff6d5a', inputs: ['main'], outputs: ['main'], executor: codeNode }),
  def({ type: 'n8n-nodes-base.outputNode', name: 'Output', displayName: 'Output', description: '结果透出', group: ['transform'], icon: 'fa:sign-out-alt', inputs: ['main'], outputs: ['main'], executor: outputNode }),

  // ---- 辅助/透传 ----
  def({ type: 'n8n-nodes-base.noOp', name: 'NoOp', displayName: 'NoOp', description: '透传（无操作）', group: ['transform'], icon: 'fa:circle', inputs: ['main'], outputs: ['main'], executor: noOpNode }),
  def({ type: 'n8n-nodes-base.respondToWebhook', name: 'Respond To Webhook', displayName: 'Respond To Webhook', description: '回显输入', group: ['trigger'], icon: 'fa:undo', inputs: ['main'], outputs: ['main'], executor: respondToWebhookNode }),
  def({ type: 'n8n-nodes-base.errorTrigger', name: 'Error Trigger', displayName: 'Error Trigger', description: '错误触发（透传）', group: ['trigger'], icon: 'fa:exclamation-circle', inputs: [], outputs: ['main'], executor: errorTriggerNode }),
  def({ type: 'n8n-nodes-base.stickyNote', name: 'Sticky Note', displayName: '便签', description: '画布便签，无逻辑', group: ['auxiliary'], icon: 'fa:sticky-note', inputs: [], outputs: [], executor: noOpNode }),
  def({ type: 'n8n-nodes-base.textSplitter', name: 'Text Splitter', displayName: 'Text Splitter', description: '递归文本切块', group: ['transform'], icon: 'fa:scissors', inputs: ['main'], outputs: ['main'], executor: textSplitterNode }),

  // ---- 数据转换/工具（真实可执行） ----
  def({ type: 'n8n-nodes-base.filter', name: 'Filter', displayName: 'Filter', description: '按条件过滤行', group: ['transform'], icon: 'fa:filter', inputs: ['main'], outputs: ['main'], executor: filterNode }),
  def({ type: 'n8n-nodes-base.sort', name: 'Sort', displayName: 'Sort', description: '按字段排序', group: ['transform'], icon: 'fa:sort', inputs: ['main'], outputs: ['main'], executor: sortNode }),
  def({ type: 'n8n-nodes-base.aggregate', name: 'Aggregate', displayName: 'Aggregate', description: '分组聚合(sum/count/avg/min/max)', group: ['transform'], icon: 'fa:table', inputs: ['main'], outputs: ['main'], executor: aggregateNode }),
  def({ type: 'n8n-nodes-base.math', name: 'Math', displayName: 'Math', description: '四则/公式运算', group: ['transform'], icon: 'fa:calculator', inputs: ['main'], outputs: ['main'], executor: mathNode }),
  def({ type: 'n8n-nodes-base.dateTime', name: 'Date & Time', displayName: 'Date & Time', description: '日期时间计算', group: ['transform'], icon: 'fa:calendar', inputs: ['main'], outputs: ['main'], executor: dateTimeNode }),
  def({ type: 'n8n-nodes-base.extractFromFile', name: 'Extract From File', displayName: 'Extract From File', description: '从 JSON 提取字段', group: ['transform'], icon: 'fa:file', inputs: ['main'], outputs: ['main'], executor: extractJsonNode }),
  def({ type: 'n8n-nodes-base.editFields', name: 'Edit Fields', displayName: 'Edit Fields (Set 多字段)', description: '批量写入字段', group: ['transform'], icon: 'fa:pen', inputs: ['main'], outputs: ['main'], executor: editFieldsNode }),

  // ---- 数据库 ----
  def({ type: 'n8n-nodes-base.d1query', name: 'D1 Query', displayName: 'D1 Query', description: '对 Cloudflare D1(SQLite) 执行 SQL', group: ['action'], categories: ['Database'], icon: 'fa:database', inputs: ['main'], outputs: ['main'],
    properties: [{ displayName: 'SQL Query', name: 'query', type: 'string', required: true, default: '', typeOptions: { editor: 'sqlEditor', rows: 5 }, description: '支持 {{ $json.x }} 插值' }], executor: d1QueryNode }),
  def({ type: 'n8n-nodes-base.mySql', name: 'MySQL', displayName: 'MySQL', description: 'MySQL 数据库（需外部连接）', group: ['action'], categories: ['Database'], icon: 'fa:database', inputs: ['main'], outputs: ['main'], executor: dbPlaceholderNode }),
  def({ type: 'n8n-nodes-base.postgres', name: 'PostgreSQL', displayName: 'PostgreSQL', description: 'PostgreSQL 数据库（需外部连接）', group: ['action'], categories: ['Database'], icon: 'fa:database', inputs: ['main'], outputs: ['main'], executor: dbPlaceholderNode }),
  def({ type: 'n8n-nodes-base.sqlite', name: 'SQLite', displayName: 'SQLite', description: 'SQLite 数据库', group: ['action'], categories: ['Database'], icon: 'fa:database', inputs: ['main'], outputs: ['main'], executor: d1QueryNode }),

  // ---- 触发器补充 ----
  def({ type: 'n8n-nodes-base.cron', name: 'Cron', displayName: 'Cron', description: '按 cron 表达式定时触发', group: ['trigger'], icon: 'fa:calendar', inputs: [], outputs: ['main'],
    properties: [{ displayName: 'Cron Expression', name: 'cronExpression', type: 'string', default: '0 * * * *' }], executor: cronNode }),
  def({ type: 'n8n-nodes-base.formTrigger', name: 'Form Trigger', displayName: 'Form Trigger', description: '外部表单提交触发', group: ['trigger'], icon: 'fa:file-alt', inputs: [], outputs: ['main'], executor: formTriggerNode }),
  def({ type: 'n8n-nodes-base.intervalTrigger', name: 'Interval Trigger', displayName: 'Interval Trigger', description: '按固定间隔触发', group: ['trigger'], icon: 'fa:repeat', inputs: [], outputs: ['main'], executor: intervalNode }),

  // ---- AI ----
  def({ type: 'n8n-nodes-base.openAi', name: 'OpenAI', displayName: 'OpenAI Chat', description: '调用 OpenAI 兼容对话模型', group: ['ai'], categories: ['AI'], icon: 'fa:microchip', inputs: ['main'], outputs: ['main'],
    properties: [
      { displayName: 'Model', name: 'model', type: 'string', default: 'gpt-4o-mini' },
      { displayName: 'Prompt', name: 'prompt', type: 'string', typeOptions: { rows: 4 }, default: '' },
    ], executor: openaiChatNode }),
  def({ type: 'n8n-nodes-base.embeddings', name: 'Embeddings', displayName: 'Embeddings', description: '文本向量化（需凭据）', group: ['ai'], categories: ['AI'], icon: 'fa:cube', inputs: ['main'], outputs: ['main'], executor: aiPlaceholderNode }),
  def({ type: 'n8n-nodes-base.huggingFace', name: 'Hugging Face', displayName: 'Hugging Face', description: 'HF 推理 API（需凭据）', group: ['ai'], categories: ['AI'], icon: 'fa:smile', inputs: ['main'], outputs: ['main'], executor: aiPlaceholderNode }),

  // ---- 文本处理（全部真实可执行） ----
  def({ type: 'n8n-nodes-base.replace', name: 'Text Replace', displayName: 'Text Replace', description: '文本查找替换', group: ['transform'], categories: ['Text'], icon: 'fa:search', inputs: ['main'], outputs: ['main'],
    properties: [{ displayName: '字段', name: 'field', type: 'string', default: 'text' }, { displayName: '查找', name: 'search', type: 'string', default: '' }, { displayName: '替换', name: 'replace', type: 'string', default: '' }],
    executor: textReplaceNode }),
  def({ type: 'n8n-nodes-base.regexExtract', name: 'Regex Extract', displayName: 'Regex Extract', description: '正则提取文本', group: ['transform'], categories: ['Text'], icon: 'fa:terminal', inputs: ['main'], outputs: ['main'],
    properties: [{ displayName: '字段', name: 'field', type: 'string', default: 'text' }, { displayName: 'Regex', name: 'regex', type: 'string', default: '' }],
    executor: regexExtractNode }),
  def({ type: 'n8n-nodes-base.textCase', name: 'Text Case', displayName: 'Text Case', description: '转换大小写', group: ['transform'], categories: ['Text'], icon: 'fa:font', inputs: ['main'], outputs: ['main'],
    executor: textCaseNode }),
  def({ type: 'n8n-nodes-base.splitOut', name: 'Text Split', displayName: 'Text Split', description: '按分隔符拆分为数组', group: ['transform'], categories: ['Text'], icon: 'fa:scissors', inputs: ['main'], outputs: ['main'],
    properties: [{ displayName: '分隔符', name: 'separator', type: 'string', default: ',' }],
    executor: textSplitNode }),
  def({ type: 'n8n-nodes-base.textTemplate', name: 'Text Template', displayName: 'Text Template', description: '{{ $json }} 模板插值', group: ['transform'], categories: ['Text'], icon: 'fa:paragraph', inputs: ['main'], outputs: ['main'],
    properties: [{ displayName: '模板', name: 'template', type: 'string', typeOptions: { rows: 5 }, default: '' }],
    executor: textTemplateNode }),
  def({ type: 'n8n-nodes-base.textTruncate', name: 'Text Truncate', displayName: 'Text Truncate', description: '按长度截断', group: ['transform'], categories: ['Text'], icon: 'fa:cut', inputs: ['main'], outputs: ['main'],
    properties: [{ displayName: '最大长度', name: 'length', type: 'number', default: 100 }],
    executor: textTruncateNode }),
  def({ type: 'n8n-nodes-base.textCount', name: 'Text Count', displayName: 'Text Count', description: '统计字符/单词/行数', group: ['transform'], categories: ['Text'], icon: 'fa:hashtag', inputs: ['main'], outputs: ['main'],
    executor: textCountNode }),

  // ---- 列表/数据工具（全部真实可执行） ----
  def({ type: 'n8n-nodes-base.limit', name: 'Limit', displayName: 'Limit', description: '限制输出条数', group: ['transform'], categories: ['Data'], icon: 'fa:filter', inputs: ['main'], outputs: ['main'],
    properties: [{ displayName: '最大条数', name: 'maxItems', type: 'number', default: 10 }],
    executor: limitNode }),
  def({ type: 'n8n-nodes-base.renameKeys', name: 'Rename Keys', displayName: 'Rename Keys', description: '批量重命名字段', group: ['transform'], categories: ['Data'], icon: 'fa:pen', inputs: ['main'], outputs: ['main'],
    executor: renameKeysNode }),
  def({ type: 'n8n-nodes-base.zip', name: 'Zip', displayName: 'Zip', description: '多条输入压缩为单条对象', group: ['transform'], categories: ['Data'], icon: 'fa:archive', inputs: ['main'], outputs: ['main'],
    properties: [{ displayName: '字段名', name: 'field', type: 'string', default: 'items' }],
    executor: zipNode }),
  def({ type: 'n8n-nodes-base.itemLists', name: 'Item Lists', displayName: 'Item Lists', description: '把对象数组展开为多行', group: ['transform'], categories: ['Data'], icon: 'fa:list-ul', inputs: ['main'], outputs: ['main'],
    properties: [{ displayName: '拆分字段', name: 'fieldToSplitName', type: 'string', default: 'items' }],
    executor: itemListsNode }),
  def({ type: 'n8n-nodes-base.store', name: 'Store (KV)', displayName: 'Store (KV)', description: '读写 Cloudflare KV(CREDENTIALS)', group: ['action'], categories: ['Storage'], icon: 'fa:key', inputs: ['main'], outputs: ['main'],
    properties: [{ displayName: '操作', name: 'operation', type: 'string', default: 'get' }, { displayName: '键', name: 'key', type: 'string', default: '' }],
    executor: storeNode }),
  def({ type: 'n8n-nodes-base.convertToJson', name: 'Convert To JSON', displayName: 'Convert To JSON', description: 'JSON 字符串转对象并展开', group: ['transform'], categories: ['Data'], icon: 'fa:code', inputs: ['main'], outputs: ['main'],
    properties: [{ displayName: '源字段', name: 'dataPropertyName', type: 'string', default: 'json' }],
    executor: convertToJsonNode }),
  def({ type: 'n8n-nodes-base.joinList', name: 'Join List', displayName: 'Join List', description: '把多行对象合并为单条，按分隔符拼接字段', group: ['transform'], categories: ['Data'], icon: 'fa:arrows-alt-h', inputs: ['main'], outputs: ['main'],
    properties: [{ displayName: '待拼接字段', name: 'field', type: 'string', default: 'items' }, { displayName: '分隔符', name: 'separator', type: 'string', default: ',' }],
    executor: joinListNode }),
  def({ type: 'n8n-nodes-base.assign', name: 'Assign', displayName: 'Assign', description: '给每个输入项赋值变量/字段', group: ['transform'], categories: ['Data'], icon: 'fa:plus-square', inputs: ['main'], outputs: ['main'],
    executor: assignNode }),

  // ---- 消息通讯 ----
  def({ type: 'n8n-nodes-base.httpSend', name: 'HTTP Send', displayName: 'HTTP Send', description: '通用 HTTP 请求发送（回调/通知）', group: ['action'], categories: ['Communications'], icon: 'fa:paper-plane', inputs: ['main'], outputs: ['main'],
    properties: [{ displayName: 'URL', name: 'url', type: 'string', default: '', required: true }, { displayName: 'Method', name: 'method', type: 'options', options: ['GET','POST','PUT','DELETE','PATCH'].map((x)=>({name:x,value:x})) }],
    executor: httpSendNode }),
  def({ type: 'n8n-nodes-base.webhookSend', name: 'Webhook Send', displayName: 'Webhook Send', description: '发送到 Webhook 回调地址', group: ['action'], categories: ['Communications'], icon: 'fa:globe', inputs: ['main'], outputs: ['main'],
    properties: [{ displayName: 'URL', name: 'url', type: 'string', required: true, default: '' }, { displayName: 'Payload', name: 'message', type: 'json', default: '{}' }],
    executor: webhookSendNode }),
  def({ type: 'n8n-nodes-base.sendgrid', name: 'SendGrid', displayName: 'SendGrid (Email)', description: '发送邮件（需 SendGrid API Key）', group: ['action'], categories: ['Communications'], icon: 'fa:envelope', inputs: ['main'], outputs: ['main'], executor: notifyPlaceholderNode }),
  def({ type: 'n8n-nodes-base.email', name: 'Email', displayName: 'Email', description: '发送邮件（需凭据）', group: ['action'], categories: ['Communications'], icon: 'fa:envelope', inputs: ['main'], outputs: ['main'], executor: notifyPlaceholderNode }),
  def({ type: 'n8n-nodes-base.slack', name: 'Slack', displayName: 'Slack', description: 'Slack 消息发送（需凭据）', group: ['action'], categories: ['Communications'], icon: 'fa:hashtag', inputs: ['main'], outputs: ['main'], executor: notifyPlaceholderNode }),
  def({ type: 'n8n-nodes-base.telegram', name: 'Telegram', displayName: 'Telegram', description: 'Telegram 消息（需 Bot Token）', group: ['action'], categories: ['Communications'], icon: 'fa:paper-plane', inputs: ['main'], outputs: ['main'], executor: notifyPlaceholderNode }),
  def({ type: 'n8n-nodes-base.discord', name: 'Discord', displayName: 'Discord', description: 'Discord 消息（需 Webhook）', group: ['action'], categories: ['Communications'], icon: 'fa:comments', inputs: ['main'], outputs: ['main'], executor: notifyPlaceholderNode }),

  // ---- 消息自动化（Telegram / 企业微信 / 翻译，全部真实可执行） ----
  def({ type: 'n8n-nodes-base.telegramChannelReader', name: 'Telegram Channel', displayName: 'Telegram Channel', description: '抓取 t.me 公开频道最近消息（无需 token）', group: ['action'], categories: ['Communications', 'Data'], icon: 'fa:paper-plane', inputs: ['main'], outputs: ['main'],
    properties: [
      { displayName: '频道德', name: 'channel', type: 'string', default: 'FireflyLeak', required: true, description: '单个频道名(不带 @)' },
      { displayName: '频道列表', name: 'channels', type: 'json', default: '["FireflyLeak"]', description: '多个用数组；优先于单频道字段' },
      { displayName: '每条上限', name: 'limit', type: 'number', default: 3 },
    ],
    executor: telegramChannelNode }),
  def({ type: 'n8n-nodes-base.weCom', name: '企业微信 (WeChat Work)', displayName: '企业微信 Webhook', description: '推送到企业微信群机器人(需 webhook URL 含 key)', group: ['action'], categories: ['Communications'], icon: 'fa:comment', inputs: ['main'], outputs: ['main'],
    properties: [
      { displayName: 'Webhook URL', name: 'webhookUrl', type: 'string', default: '', required: true, placeholder: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...' },
      { displayName: '消息类型', name: 'msgtype', type: 'options', default: 'markdown', options: [{ name: 'Markdown', value: 'markdown' }, { name: 'Text', value: 'text' }] },
      { displayName: '自定义内容(可选)', name: 'content', type: 'string', typeOptions: { rows: 5 }, default: '', description: '留空则自动把输入整合为 markdown 列表' },
    ],
    executor: weComSendNode }),
  def({ type: 'n8n-nodes-base.translate', name: 'Translate', displayName: 'Translate', description: '翻译文本(Google 免费/OpenAI 兼容可配)', group: ['transform'], categories: ['Text'], icon: 'fa:language', inputs: ['main'], outputs: ['main'],
    properties: [
      { displayName: '引擎', name: 'engine', type: 'options', default: 'google', options: [{ name: 'Google(免费)', value: 'google' }, { name: 'OpenAI 兼容', value: 'openai' }] },
      { displayName: '目标语言', name: 'target', type: 'string', default: 'zh-CN' },
      { displayName: '文本字段', name: 'textField', type: 'string', default: 'text' },
    ],
    executor: translateNode }),
];

export const builtinPlugin: NodePlugin = {
  id: 'n8n-nodes-base',
  label: 'n8n-nodes-base',
  description: 'mini-flow 内置基础节点（触发器/数据/流程/代码/工具）',
  isCommunity: false,
  nodes,
};

registerPlugin(builtinPlugin);