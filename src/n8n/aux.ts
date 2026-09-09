// aux: 编辑器初始化还需要的辅助 REST（roles / variables / credentials）
// 均返回前端所期望的 JSON（空集合，避免 read-only 场景误判/崩溃）。
import { Hono } from 'hono';
import type { Env } from '../types';

export const rolesRoutes = new Hono<{ Bindings: Env }>()
  // GET /rest/roles?withUsageCount=true → { data: { roles, count } }
  .get('/', (c) => c.json({ data: { roles: [], count: 0 } }))
  // GET /rest/roles/:slug?withUsageCount=true
  .get('/:slug', (c) => c.json({ data: null, code: 404, message: 'Role not found' }, 404));

export const variablesRoutes = new Hono<{ Bindings: Env }>()
  // GET /rest/variables → 前端 users.store 直接对 data 调 .filter()，必须是数组
  .get('/', (c) => c.json({ data: [] }))
  .post('/', async (c) => c.json({ data: null, code: 403, message: 'Creating variables is not supported on mini-flow' }, 403));

export const credentialsAuxRoutes = new Hono<{ Bindings: Env }>()
  // GET /rest/credentials/for-workflow?projectId=personal → { data: [credential, ...] }
  .get('/for-workflow', (c) => c.json({ data: [] }))
  // GET /rest/credentials/for-workflow/:id → 单凭据（空场景直接 404）
  // GET /rest/credentials/types：凭据类型，editor 初始化 fetchCredentialTypes 会拉
  .get('/types', (c) => c.json({ data: [] }));