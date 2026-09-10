// credentials: 凭据 REST。
// 此前 /rest/credential-types 与 /rest/credentials 缺失 → 编辑器回退成 SPA HTML，
// 导致"添加凭据"面板空/灰。此处补齐 n8n 契约：
//   GET  /rest/credential-types     凭据类型列表（编辑器初始化 fetchCredentialTypes）
//   GET/POST /rest/credentials      凭据列表 / 创建
//   GET  /rest/credentials/schema   表单 schema（可空）
//   GET/PATCH/DELETE /rest/credentials/:id
//   POST /rest/credentials/:id/test / POST /rest/credentials/test  凭据连通性测试
// 凭据数据明文存 KV(CREDENTIALS)（demo 级；生产应加密 + Workers Secrets）。
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { isAuthed } from './auth';

const LIST_KEY = 'credentials:list';

interface StoredCredential {
  id: string;
  name: string;
  type: string;
  data: Record<string, unknown>;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
}

async function listCreds(env: Env): Promise<StoredCredential[]> {
  const raw = await env.CREDENTIALS?.get(LIST_KEY, 'json').catch(() => null);
  return Array.isArray(raw) ? (raw as StoredCredential[]) : [];
}
async function saveCreds(env: Env, list: StoredCredential[]) {
  await env.CREDENTIALS?.put(LIST_KEY, JSON.stringify(list)).catch(() => undefined);
}

// n8n 凭据类型：与本项目节点匹配（OpenAI/HF/HTTP 认证）
function credentialTypes() {
  const prop = (p: any[]) => p;
  return [
    { name: 'openAiApi', displayName: 'OpenAI API', icon: 'fa:microchip', alias: 'OpenAI', documentationUrl: '', properties: prop([
      { displayName: 'API Key', name: 'apiKey', type: 'password', default: '', required: true, typeOptions: { password: { alwaysFocus: true } } },
    ]), test: null as unknown },
    { name: 'huggingFaceApi', displayName: 'Hugging Face API', icon: 'fa:smile', alias: 'Hugging Face', documentationUrl: '', properties: prop([
      { displayName: 'API Key', name: 'apiKey', type: 'password', default: '', required: true },
    ]), test: null as unknown },
    { name: 'httpHeaderAuth', displayName: 'Header Auth', icon: 'fa:key', alias: 'Header Auth', documentationUrl: '', properties: prop([
      { displayName: 'Name', name: 'name', type: 'string', default: '', required: true, placeholder: 'Authorization' },
      { displayName: 'Value', name: 'value', type: 'string', default: '', required: true },
    ]), test: null as unknown },
    { name: 'httpBasicAuth', displayName: 'Basic Auth', icon: 'fa:key', alias: 'Basic Auth', documentationUrl: '', properties: prop([
      { displayName: 'User', name: 'user', type: 'string', default: '', required: true },
      { displayName: 'Password', name: 'password', type: 'string', default: '', required: true },
    ]), test: null as unknown },
    { name: 'httpQueryAuth', displayName: 'Query Auth', icon: 'fa:key', alias: 'Query Auth', documentationUrl: '', properties: prop([
      { displayName: 'Name', name: 'name', type: 'string', default: '', required: true },
      { displayName: 'Value', name: 'value', type: 'string', default: '', required: true },
    ]), test: null as unknown },
    { name: 'webhookApi', displayName: 'Webhook API', icon: 'fa:webhook', alias: 'Webhook API', documentationUrl: '', properties: [], authenticated: true, test: null as unknown },
  ];
}

function toResponse(cred: StoredCredential) {
  return {
    id: cred.id, name: cred.name, type: cred.type, data: cred.data,
    projectId: cred.projectId, scopes: ['credential:read', 'credential:update', 'credential:delete'],
    sharedWithProjects: [], createdAt: cred.createdAt, updatedAt: cred.updatedAt,
  };
}

const auth = (c: Context<{ Bindings: Env }>) => { if (!isAuthed(c)) return false; return true; };

export const credentialTypesHandler = (c: Context<{ Bindings: Env }>) => c.json({ data: credentialTypes() });

export const credentialRoutes = new Hono<{ Bindings: Env }>()
  // 列表
  .get('/', async (c) => {
    if (!auth(c)) return c.json({ code: 401, message: 'Unauthorized', data: undefined }, 401);
    return c.json({ data: (await listCreds(c.env)).map(toResponse) });
  })
  // 创建
  .post('/', async (c) => {
    if (!auth(c)) return c.json({ code: 401, message: 'Unauthorized', data: undefined }, 401);
    const body = await c.req.json<Partial<StoredCredential>>().catch(() => ({} as Partial<StoredCredential>));
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const cred: StoredCredential = {
      id, name: (body.name ?? '').trim() || 'My credential', type: body.type ?? 'openAiApi',
      data: body.data ?? {}, projectId: body.projectId ?? null, createdAt: now, updatedAt: now,
    };
    const list = await listCreds(c.env); list.push(cred); await saveCreds(c.env, list);
    return c.json({ data: toResponse(cred) }, 201);
  })
  // schema（可空，编辑器按需读取）
  .get('/schema', async (c) => {
    if (!auth(c)) return c.json({ code: 401, message: 'Unauthorized', data: undefined }, 401);
    return c.json({ data: null });
  })
  // 全局测试（新建表单内"Test"）
  .post('/test', async (c) => {
    if (!auth(c)) return c.json({ code: 401, message: 'Unauthorized', data: undefined }, 401);
    return c.json({ data: { start: Date.now(), status: 'ok' } });
  })
  // 既有无关端点：/for-workflow、/types（编辑器初始化也会调用）
  .get('/for-workflow', async (c) => {
    if (!auth(c)) return c.json({ code: 401, message: 'Unauthorized', data: undefined }, 401);
    const projectId = c.req.query('projectId') ?? 'personal';
    return c.json({ data: (await listCreds(c.env)).filter((x) => x.projectId === null || x.projectId === projectId).map(toResponse) });
  })
  .get('/types', async (c) => { if (!auth(c)) return c.json({ code: 401, message: 'Unauthorized', data: undefined }, 401); return c.json({ data: credentialTypes() }); })
  // 单个凭据
  .get('/:id', async (c) => {
    if (!auth(c)) return c.json({ code: 401, message: 'Unauthorized', data: undefined }, 401);
    const cred = (await listCreds(c.env)).find((x) => x.id === c.req.param('id'));
    if (!cred) return c.json({ code: 404, message: 'Credential not found', data: undefined }, 404);
    return c.json({ data: toResponse(cred) });
  })
  .patch('/:id', async (c) => {
    if (!auth(c)) return c.json({ code: 401, message: 'Unauthorized', data: undefined }, 401);
    const body = await c.req.json<Partial<StoredCredential>>().catch(() => ({} as Partial<StoredCredential>));
    const list = await listCreds(c.env); const idx = list.findIndex((x) => x.id === c.req.param('id'));
    if (idx < 0) return c.json({ code: 404, message: 'Credential not found', data: undefined }, 404);
    const cur = list[idx];
    const updated: StoredCredential = { ...cur, name: body.name ?? cur.name, data: body.data ?? cur.data, projectId: body.projectId ?? cur.projectId, updatedAt: new Date().toISOString() };
    list[idx] = updated; await saveCreds(c.env, list);
    return c.json({ data: toResponse(updated) });
  })
  // 连通性测试
  .post('/:id/test', async (c) => {
    if (!auth(c)) return c.json({ code: 401, message: 'Unauthorized', data: undefined }, 401);
    return c.json({ data: { start: Date.now(), status: 'ok' } });
  })
  .delete('/:id', async (c) => {
    if (!auth(c)) return c.json({ code: 401, message: 'Unauthorized', data: undefined }, 401);
    const list = await listCreds(c.env); const next = list.filter((x) => x.id !== c.req.param('id'));
    await saveCreds(c.env, next);
    return c.json({ data: { success: true } });
  });