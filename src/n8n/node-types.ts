// node-types: 节点类型元数据（n8n 前端渲染节点面板用）
// 返回我们支持的内置节点在 n8n 模型下的描述 + 轻量 jsonSchema。
import { Hono } from 'hono';
import type { Env } from '../types';

// 每个内置节点在一处定义，即给前端、也给执行层（可后续统一）
export interface MiniNodeType {
  name: string;
  type: string;              // n8n type 形如 n8n-nodes-base.httpRequest
  typeVersion: number;
  displayName: string;
  description: string;
  group: string[];
  icon: string;
  inputs: string[];
  outputs: string[];
}

export const NODE_TYPE_DEFS: MiniNodeType[] = [
  { name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 1.1, displayName: 'Webhook', description: '通过 URL 接收请求触发', group: ['trigger'], icon: 'fa:globe', inputs: [], outputs: ['main'] },
  { name: 'Schedule Trigger', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, displayName: '定时 Cron', description: '按计划自动运行', group: ['trigger'], icon: 'fa:clock', inputs: [], outputs: ['main'] },
  { name: 'HTTP Request', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, displayName: 'HTTP Request', description: '调用外部 HTTP 接口', group: ['action'], icon: 'fa:paper-plane', inputs: ['main'], outputs: ['main'] },
  { name: 'Set', type: 'n8n-nodes-base.set', typeVersion: 3.4, displayName: '字段赋值 Set', description: '写入字段值', group: ['action'], icon: 'fa:pen', inputs: ['main'], outputs: ['main'] },
  { name: 'IF', type: 'n8n-nodes-base.if', typeVersion: 2.2, displayName: '条件判断 IF', description: '按条件选择分支', group: ['action'], icon: 'fa:code-branch', inputs: ['main'], outputs: ['main', 'main'] },
  { name: 'Function', type: 'n8n-nodes-base.function', typeVersion: 1, displayName: '受限求值', description: '安全公式与函数（受限，非任意 JS）', group: ['action'], icon: 'fa:tachometer-alt', inputs: ['main'], outputs: ['main'] },
];

export const nodeTypeRoutes = new Hono<{ Bindings: Env }>()
  // 全部节点：给 /rest/node-types?additionalFields=... 用，直接返回数组
  .get('/', (c) => c.json({ data: NODE_TYPE_DEFS }))
  // 单个：/rest/node-types/n8n-nodes-base.httpRequest
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