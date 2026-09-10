// node-types: 节点类型元数据（n8n 前端节点面板 + 画布渲染）
// 必须提供 n8n 前端完整期望的字段，尤其是 defaults.name / defaults.color：
// 画布添加节点时用 defaults.name 生成节点名；缺它会导致
// getUniqueNodeName(undefined) 报 "reading 'match'" 错误，节点名成为 undefined，
// 保存的 nodes 缺少 name、图标渲染成 "?"。
import { Hono } from 'hono';
import type { Env } from '../types';
import { allNodeTypeDefs } from '../plugins';

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

// 节点定义统一来自插件注册中心(plugins/builtin + 任何 registerPlugin 的扩展)，
// 保证编辑器面板(/rest/node-types) 与运行时执行同源。
export const NODE_TYPE_DEFS: MiniNodeType[] = allNodeTypeDefs();

// 暴露给其它渲染源（types/nodes.json 静态文件同构）
export function nodeTypeDefs(): MiniNodeType[] {
  return NODE_TYPE_DEFS;
}

// 请求中带 typeVersion 时优先匹配版本，否则按 type 匹配（fallback 到第一个）
function findDef(t: string, typeVersion?: number): MiniNodeType | undefined {
  const candidates = NODE_TYPE_DEFS.filter((d) => d.type === t);
  if (candidates.length === 0) return undefined;
  if (typeVersion !== undefined) {
    const byVer = candidates.find((d) => Number(d.typeVersion) === Number(typeVersion));
    if (byVer) return byVer;
  }
  return candidates[0];
}

// 兜底：请求了注册集中不存在的节点类型时，生成一个最小可编辑的定义，
// 保证导入外部模板/未知节点不会渲染成 "?" 且能打开参数面板。
function fallbackDef(t: string, name?: string): MiniNodeType {
  const last = (name && String(name)) || t.split('.').pop() || t;
  return {
    name: last, type: t, typeVersion: 1, version: [1],
    displayName: last, description: `节点类型 ${t}`,
    group: ['transform'], categories: ['Core Nodes'], icon: 'fa:plug',
    defaults: { name: last, color: '#8064a2' },
    inputs: ['main'], outputs: ['main'],
    properties: [{ displayName: '未知节点', name: '__unknown', type: 'string', default: '', description: `类型 ${t} 未注册，参数原样透传` }],
  };
}

export const nodeTypeRoutes = new Hono<{ Bindings: Env }>()
  // 全部节点：给 /rest/node-types 用
  .get('/', (c) => c.json({ data: NODE_TYPE_DEFS }))
  // POST /node-types：前端编辑器对画布上"注册集中未声明的节点"调用 getNodeInfo 拉取定义
  // 以注入图标 + 参数面板。请求体 { nodeInfos: [{ name, type, typeVersion? }] }，返回对应定义数组。
  .post('/', async (c) => {
    const body = await c.req.json<{ nodeInfos?: Array<{ name?: string; type: string; typeVersion?: number }> }>()
      .catch(() => ({ nodeInfos: [] as Array<{ name?: string; type: string; typeVersion?: number }> }));
    const infos = Array.isArray(body?.nodeInfos) ? body.nodeInfos : [];
    const out = infos.map((info) => {
      if (!info || typeof info.type !== 'string') return undefined;
      return findDef(info.type, info.typeVersion) ?? fallbackDef(info.type, info.name);
    }).filter((d): d is MiniNodeType => !!d);
    return c.json({ data: out });
  })
  // 单个：/rest/node-types/:type
  .get('/:type', (c) => {
    const t = c.req.param('type');
    const def = NODE_TYPE_DEFS.find((d) => d.type === t);
    if (!def) return c.json({ data: null, code: 404, message: `Unknown node type ${t}` }, 404);
    return c.json({ data: def });
  })
  // POST /node-types/by-identifier：前端模板导入/画布批量节点解析。
  // 请求体 { identifiers: [{ name?, type, typeVersion? }] }，返回节点定义数组。
  // 必须在 GET /:type 之前无冲突（POST vs GET 方法不同）；显式注册保证命中。
  .post('/by-identifier', async (c) => {
    const body = await c.req.json<{ identifiers?: Array<{ name?: string; type: string; typeVersion?: number }> }>()
      .catch(() => ({ identifiers: [] as Array<{ name?: string; type: string; typeVersion?: number }> }));
    const ids = Array.isArray(body?.identifiers) ? body.identifiers : [];
    const out = ids.map((info) => {
      if (!info || typeof info.type !== 'string') return undefined;
      return findDef(info.type, info.typeVersion) ?? fallbackDef(info.type, info.name);
    }).filter((d): d is MiniNodeType => !!d);
    return c.json({ data: out });
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
    'n8n-nodes-base.httpRequest': { ...base, method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], title: '方法' }, jsonBody: { type: 'string', title: 'Body' } },
    'n8n-nodes-base.set': { name: { type: 'string', title: '字段' }, value: { type: 'string', title: '值' } },
    'n8n-nodes-base.if': { conditionSt: { type: 'string', title: '条件表达式' } },
    'n8n-nodes-base.switch': { conditions: { type: 'object', title: '规则' } },
    'n8n-nodes-base.removeDuplicates': { options: { type: 'object', title: '去重字段' } },
    'n8n-nodes-base.splitInBatches': { batchSize: { type: 'number', title: '每批数量' } },
    'n8n-nodes-base.merge': { mode: { type: 'string', enum: ['append', 'combine'], title: '模式' } },
    'n8n-nodes-base.delay': { amount: { type: 'number', title: '延迟量' }, unit: { type: 'string', title: '单位' } },
    'n8n-nodes-base.code': { javascriptCode: { type: 'string', title: 'Javascript' } },
    'n8n-nodes-base.function': { code: { type: 'string', title: '表达式' } },
    'n8n-nodes-base.webhook': { path: { type: 'string', title: '路径' } },
    'n8n-nodes-base.scheduleTrigger': { cronExpression: { type: 'string', title: 'Cron' }, minutesInterval: { type: 'number', title: '间隔(分钟)' } },
  };
  return byType[type] ?? base;
}