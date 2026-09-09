// node-types: 节点类型元数据（n8n 前端节点面板 + 画布渲染）
// 必须提供 n8n 前端完整期望的字段，尤其是 defaults.name / defaults.color：
// 画布添加节点时用 defaults.name 生成节点名；缺它会导致
// getUniqueNodeName(undefined) 报 "reading 'match'" 错误，节点名成为 undefined，
// 保存的 nodes 缺少 name、图标渲染成 "?"。
import { Hono } from 'hono';
import type { Env } from '../types';

// 完整 n8n INodeTypeDescription 结构（前端需要的子集）
export interface MiniNodeType {
  name: string;
  type: string;
  typeVersion: number;
  version: number | number[];
  displayName: string;
  description: string;
  group: string[];
  categories?: string[];
  icon: string;
  codex?: { categories?: string[]; subcategories?: Record<string, string[]> };
  defaults: { name: string; color: string; typeVersion?: number };
  inputs: string[] | string;
  outputs: string[] | string;
  properties: unknown[];
}

export const NODE_TYPE_DEFS: MiniNodeType[] = [
  {
    name: 'n8n-nodes-base.manualTrigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, version: [1, 2],
    displayName: 'Manual Trigger', description: '在编辑器中点击按钮手动触发', group: ['trigger'],
    categories: ['Core Nodes'], icon: 'fa:mouse-pointer', defaults: { name: 'Manual Trigger', color: '#ff6d5a' },
    inputs: [], outputs: ['main'], properties: [],
  },
  {
    name: 'n8n-nodes-base.webhook', type: 'n8n-nodes-base.webhook', typeVersion: 1.1, version: [1, 1.1],
    displayName: 'Webhook', description: '通过 URL 接收请求触发', group: ['trigger'],
    categories: ['Core Nodes'], icon: 'fa:globe',
    defaults: { name: 'Webhook', color: '#8064a2' }, inputs: [], outputs: ['main'],
    properties: [
      {
        displayName: 'HTTP Method', name: 'httpMethod', type: 'options', noDataExpression: true,
        default: 'GET',
        options: ['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT'].map((m) => ({ name: m, value: m })),
      },
      {
        displayName: 'Path', name: 'path', type: 'string', noDataExpression: true, required: true,
        default: '', placeholder: 'webhook', description: '监听该路径上的请求',
      },
    ],
  },
  {
    name: 'n8n-nodes-base.scheduleTrigger', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, version: [1, 1.1, 1.2],
    displayName: '定时 Cron', description: '按计划自动运行', group: ['trigger'],
    categories: ['Core Nodes', 'Flow'], icon: 'fa:clock', defaults: { name: '定时 Cron', color: '#8064a2' },
    inputs: [], outputs: ['main'],
    properties: [
      {
        displayName: 'Rule Type', name: 'rule', type: 'options', noDataExpression: true, default: 'interval',
        options: [
          { name: 'Cron Expression', value: 'cron' },
          { name: 'Interval', value: 'interval' },
        ],
      },
      { displayName: 'Cron Expression', name: 'cronExpression', type: 'string', default: '0 0 * * *' },
      { displayName: 'Interval (minutes)', name: 'minutesInterval', type: 'number', default: 60 },
    ],
  },
  {
    name: 'n8n-nodes-base.httpRequest', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, version: [4.2],
    displayName: 'HTTP Request', description: '调用外部 HTTP 接口', group: ['transform'],
    categories: ['Core Nodes', 'Development'], icon: 'fa:paper-plane', defaults: { name: 'HTTP Request', color: '#8064a2' },
    inputs: ['main'], outputs: ['main'],
    properties: [
      {
        displayName: 'Method', name: 'method', type: 'options', noDataExpression: true, default: 'GET',
        options: ['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT'].map((m) => ({ name: m, value: m })),
      },
      { displayName: 'URL', name: 'url', type: 'string', required: true, default: '', placeholder: 'https://example.com' },
      { displayName: 'Send Headers', name: 'sendHeaders', type: 'boolean', default: false },
      { displayName: 'Body', name: 'body', type: 'string', typeOptions: { rows: 4 }, default: '' },
    ],
  },
  {
    name: 'n8n-nodes-base.set', type: 'n8n-nodes-base.set', typeVersion: 3.4, version: [3.4],
    displayName: '字段赋值 Set', description: '写入字段值', group: ['transform'],
    categories: ['Core Nodes', 'Data Transformation'], icon: 'fa:pen', defaults: { name: '字段赋值', color: '#8064a2' },
    inputs: ['main'], outputs: ['main'],
    properties: [
      { displayName: '字段名', name: 'key', type: 'string', default: 'value' },
      { displayName: '值', name: 'value', type: 'string', default: '' },
    ],
  },
  {
    name: 'n8n-nodes-base.if', type: 'n8n-nodes-base.if', typeVersion: 2.2, version: [2.2],
    displayName: '条件判断 IF', description: '按条件选择分支', group: ['transform'],
    categories: ['Core Nodes', 'Logic'], icon: 'fa:code-branch', defaults: { name: 'IF', color: '#8064a2' },
    inputs: ['main'], outputs: ['main', 'main'],
    properties: [
      { displayName: '字段', name: 'field', type: 'string', default: '' },
      {
        displayName: '运算', name: 'operator', type: 'options', default: '==',
        options: [
          { name: '等于 (=)', value: '==' },
          { name: '存在（exists）', value: 'exists' },
          { name: '包含（contains）', value: 'contains' },
        ],
      },
      { displayName: '值', name: 'value', type: 'string', default: '' },
    ],
  },
  {
    name: 'n8n-nodes-base.function', type: 'n8n-nodes-base.function', typeVersion: 1, version: [1],
    displayName: '受限求值', description: '安全公式与函数（受限，非任意 JS）', group: ['transform'],
    categories: ['Core Nodes', 'Function'], icon: 'fa:tachometer-alt', defaults: { name: '受限求值', color: '#ff6d5a' },
    inputs: ['main'], outputs: ['main'],
    properties: [
      {
        displayName: '表达式', name: 'code', type: 'string', typeOptions: { editor: 'codeNodeEditor', rows: 6 },
        default: '', description: '返回单个值的表达式（支持 $json.* 引用）',
      },
    ],
  },
];

// 暴露给其它渲染源（types/nodes.json 静态文件同构）
export function nodeTypeDefs(): MiniNodeType[] {
  return NODE_TYPE_DEFS;
}

export const nodeTypeRoutes = new Hono<{ Bindings: Env }>()
  // 全部节点：给 /rest/node-types 用
  .get('/', (c) => c.json({ data: NODE_TYPE_DEFS }))
  // 单个：/rest/node-types/:type
  .get('/:type', (c) => {
    const t = c.req.param('type');
    const def = NODE_TYPE_DEFS.find((d) => d.type === t);
    if (!def) return c.json({ data: null, code: 404, message: `Unknown node type ${t}` }, 404);
    return c.json({ data: def });
  })
  // 参数 jsonSchema：给 /rest/node-types/:type/json-schema
  .get('/:type/json-schema', (c) => {
    const t = c.req.param('type');
    const schema = jsonSchemaFor(t);
    return c.json({ data: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', properties: schema } });
  });

// 精简 jsonSchema（每个节点基础参数面板）
function jsonSchemaFor(type: string): Record<string, object> {
  const base = { url: { type: 'string', title: 'URL' } };
  const byType: Record<string, Record<string, object>> = {
    'n8n-nodes-base.httpRequest': { ...base, method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], title: '方法' }, body: { type: 'object', title: 'Body' } },
    'n8n-nodes-base.set': { name: { type: 'string', title: '字段' }, value: { type: 'string', title: '值' } },
    'n8n-nodes-base.if': { field: { type: 'string', title: '字段' }, operator: { type: 'string', enum: ['==', 'exists', 'contains'], title: '运算' }, value: { type: 'string', title: '值' } },
    'n8n-nodes-base.function': { code: { type: 'string', title: '表达式' } },
    'n8n-nodes-base.webhook': { path: { type: 'string', title: '路径' } },
    'n8n-nodes-base.scheduleTrigger': { cron: { type: 'string', title: 'Cron' } },
  };
  return byType[type] ?? base;
}