// aux: 编辑器初始化还需要的辅助 REST（roles / variables / credentials）
// 均返回前端所期望的 JSON（空集合，避免 read-only 场景误判/崩溃）。
import { Hono } from 'hono';
import type { Env } from '../types';
import { isAuthed } from './auth';

export const rolesRoutes = new Hono<{ Bindings: Env }>()
  // GET /rest/roles?withUsageCount=true → { data: { roles, count } }
  .get('/', (c) => c.json({ data: { roles: [], count: 0 } }))
  // GET /rest/roles/:slug?withUsageCount=true
  .get('/:slug', (c) => c.json({ data: null, code: 404, message: 'Role not found' }, 404));

export const variablesRoutes = new Hono<{ Bindings: Env }>()
  // GET /rest/variables → 前端 users.store 直接对 data 调 .filter()，必须是数组
  .get('/', async (c) => {
    if (!(await isAuthed(c))) return c.json({ code: 401, message: 'Unauthorized', data: undefined }, 401);
    const { results } = await c.env.DB.prepare(
      'SELECT id, key, value, type, created_at AS createdAt, updated_at AS updatedAt FROM variables ORDER BY key ASC'
    ).all<any>();
    return c.json({ data: results.map((v) => ({ ...v, value: valueFromStore(v.value, v.type) })) });
  })
  // POST /rest/variables → 创建变量 { key, value, type }
  .post('/', async (c) => {
    if (!(await isAuthed(c))) return c.json({ code: 401, message: 'Unauthorized', data: undefined }, 401);
    const body = await c.req.json<any>().catch(() => ({}));
    const key = String(body.key ?? '').trim();
    if (!key) return c.json({ code: 400, message: 'Variable key is required', data: undefined }, 400);
    const type = normalizeType(body.type);
    const storeValue = valueToStore(body.value, type);
    const existing = await c.env.DB.prepare('SELECT id FROM variables WHERE key=?').bind(key).first<any>();
    if (existing) {
      return c.json({ code: 409, message: `Variable "${key}" already exists`, data: undefined }, 409);
    }
    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      "INSERT INTO variables (id, key, value, type, created_at, updated_at) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))"
    ).bind(id, key, storeValue, type).run();
    const row = await c.env.DB.prepare(
      'SELECT id, key, value, type, created_at AS createdAt, updated_at AS updatedAt FROM variables WHERE id=?'
    ).bind(id).first<any>();
    return c.json({ data: { ...row, value: valueFromStore(row.value, row.type) } }, 201);
  })
  // GET /rest/variables/:id → 单变量
  .get('/:id', async (c) => {
    if (!(await isAuthed(c))) return c.json({ code: 401, message: 'Unauthorized', data: undefined }, 401);
    const row = await c.env.DB.prepare(
      'SELECT id, key, value, type, created_at AS createdAt, updated_at AS updatedAt FROM variables WHERE id=?'
    ).bind(c.req.param('id')).first<any>();
    if (!row) return c.json({ code: 404, message: 'Variable not found', data: undefined }, 404);
    return c.json({ data: { ...row, value: valueFromStore(row.value, row.type) } });
  })
  // PATCH /rest/variables/:id → 更新（key/value/type 可部分，type 还原值类型）
  .patch('/:id', async (c) => {
    if (!(await isAuthed(c))) return c.json({ code: 401, message: 'Unauthorized', data: undefined }, 401);
    const body = await c.req.json<any>().catch(() => ({}));
    const row = await c.env.DB.prepare(
      'SELECT id, key, value, type FROM variables WHERE id=?'
    ).bind(c.req.param('id')).first<any>();
    if (!row) return c.json({ code: 404, message: 'Variable not found', data: undefined }, 404);
    const key = body.key !== undefined ? String(body.key).trim() : row.key;
    const type = body.type !== undefined ? normalizeType(body.type) : row.type;
    let storeValue = row.value;
    if (body.value !== undefined || body.type !== undefined) {
      storeValue = valueToStore(body.value ?? valueFromStore(row.value, row.type), type);
    }
    await c.env.DB.prepare(
      "UPDATE variables SET key=?, value=?, type=?, updated_at=datetime('now') WHERE id=?"
    ).bind(key, storeValue, type, c.req.param('id')).run();
    const updated = await c.env.DB.prepare(
      'SELECT id, key, value, type, created_at AS createdAt, updated_at AS updatedAt FROM variables WHERE id=?'
    ).bind(c.req.param('id')).first<any>();
    return c.json({ data: { ...updated, value: valueFromStore(updated.value, updated.type) } });
  })
  // DELETE /rest/variables/:id → 删除
  .delete('/:id', async (c) => {
    if (!(await isAuthed(c))) return c.json({ code: 401, message: 'Unauthorized', data: undefined }, 401);
    await c.env.DB.prepare('DELETE FROM variables WHERE id=?').bind(c.req.param('id')).run();
    return c.json({ data: true });
  });

// ---- 变量值 类型还原 / 存储编码 ----
function normalizeType(t: unknown): string {
  const v = String(t ?? 'string').toLowerCase();
  return ['string', 'number', 'boolean', 'object', 'array', 'null'].includes(v) ? v : 'string';
}
// 存库：JSON 字符串（保证 NF 支持 null/对象/数组；布尔/数字也转 JSON）
function valueToStore(value: unknown, type: string): string {
  if (value === undefined || value === null) return JSON.stringify(null);
  return JSON.stringify(value);
}
// 出库：按 type 还原为预期 JS 类型（前端 users.store 读 value 时用真类型）
function valueFromStore(raw: string | null, type: string): unknown {
  let parsed: unknown;
  try {
    parsed = raw === null ? null : JSON.parse(raw);
  } catch {
    return raw as unknown; // 非 JSON 原样返回
  }
  if (parsed === null && type !== 'null') return null;
  return parsed;
}

export const credentialsAuxRoutes = new Hono<{ Bindings: Env }>()
  // GET /rest/credentials/for-workflow?projectId=personal → { data: [credential, ...] }
  .get('/for-workflow', (c) => c.json({ data: [] }))
  // GET /rest/credentials/for-workflow/:id → 单凭据（空场景直接 404）
  // GET /rest/credentials/types：凭据类型，editor 初始化 fetchCredentialTypes 会拉
  .get('/types', (c) => c.json({ data: [] }));