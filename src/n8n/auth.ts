// auth: 登录 / owner 初始化 / 会话令牌校验
// 安全设计：
//   1) 登录必须校验密码（env.ADMIN_PASSWORD，生产用 Workers Secret），不存在用户 → 统一 401，不泄露账号枚举。
//   2) 会话令牌为服务端可验证的 HMAC-SHA256 签名令牌（token = base64url(email).expiry.hexSig），
//      签名密钥来自 env.SESSION_SECRET（生产用 Workers Secret），并带 30 天过期。
//   3) 常量时间比较校验签名，Cookie 置 HttpOnly + SameSite=Lax（HTTPS 下追加 Secure）。
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';

const OWNER_EMAIL = 'admin@example.com';
export const COOKIE_NAME = 'n8n-auth';

// 开发期回退值（仅本地 wrangler dev 用）。生产环境必须通过
// `wrangler secret put SESSION_SECRET` / `ADMIN_PASSWORD` 覆盖，否则存在默认密码风险。
const DEV_FALLBACK_SECRET = 'mini-flow-dev-signing-secret-must-not-use-in-prod';
const DEV_FALLBACK_PWD = 'mini-flow-demo-password';
const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000; // 30 天

// --- HMAC-SHA256 签名（WebCrypto，async） ---
async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const b64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function secretOf(env: Env): string {
  return (env && env.SESSION_SECRET) || DEV_FALLBACK_SECRET;
}
function pwdOf(env: Env): string {
  return (env && env.ADMIN_PASSWORD) || DEV_FALLBACK_PWD;
}

async function signToken(email: string, secret: string): Promise<string> {
  const exp = Date.now() + TOKEN_TTL_MS;
  const payload = `${b64url(email)}.${exp}`;
  return `${payload}.${await hmacHex(secret, payload)}`;
}

// 常量时间校验令牌签名与过期
async function verifyToken(token: string, secret: string): Promise<boolean> {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [_, expiryStr, sig] = parts;
  const exp = Number(expiryStr);
  if (!Number.isFinite(exp)) return false;
  if (Date.now() > exp) return false; // 已过期
  const payload = parts.slice(0, 2).join('.');
  const calc = await hmacHex(secret, payload);
  if (calc.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < calc.length; i++) if (calc.charCodeAt(i) !== sig.charCodeAt(i)) diff++;
  return diff === 0;
}

// 常量时间口令比较
function constantTimeEqual(aStr: string, bStr: string): boolean {
  const a = new TextEncoder().encode(aStr);
  const b = new TextEncoder().encode(bStr);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// 会话判定：请求 Cookie 里带合法签名会话令牌且未过期才算已登录
export async function isAuthed(c: Context<{ Bindings: Env }>): Promise<boolean> {
  const h = c.req.header('cookie') ?? '';
  const m = new RegExp(`(?:^|;)\\s*${COOKIE_NAME}=([^;]+)`).exec(h);
  if (!m) return false;
  return verifyToken(decodeURIComponent(m[1]), secretOf(c.env));
}

// 全局权限（单用户=owner）。前端 currentUser.scopes / workflow.scopes
// 据此判定 workflowPermissions.update 等，缺失会让节点编辑操作置灰。
export const OWNER_SCOPES: string[] = [
  'global:owner',
  'user:read', 'user:update', 'user:invite', 'user:list', 'user:delete',
  'workflow:create', 'workflow:read', 'workflow:update', 'workflow:delete',
  'workflow:list', 'workflow:move', 'workflow:execute', 'workflow:share', 'workflow:activate',
  'credential:create', 'credential:read', 'credential:update', 'credential:delete', 'credential:list', 'credential:share',
  'project:create', 'project:read', 'project:update', 'project:delete', 'project:list',
  'folder:create', 'folder:read', 'folder:update', 'folder:delete',
  'insights:list', 'auditLogs:manage',
  'variables:create', 'variables:read', 'variables:update', 'variables:delete',
  'variable:create', 'variable:read', 'variable:update', 'variable:delete', 'variable:share', 'variable:list',
];

export function owner() {
  return {
    id: 'owner', email: OWNER_EMAIL, firstName: 'Admin', lastName: '',
    role: 'owner', isOwner: true, isPending: false,
    globalScopes: OWNER_SCOPES,
    scopes: OWNER_SCOPES,
    features: {
      usersCreate: true, usersRead: true, usersUpdate: true,
      smtp: {}, users: {},
    },
  };
}

// 密码校验：恒等该实例唯一 owner 邮箱且口令匹配。
// 邮箱不存在/口令错误统一返回 false → 登录统一 401，避免账号枚举。
async function checkLogin(env: Env, email: unknown, password: unknown): Promise<boolean> {
  if (typeof email !== 'string' || typeof password !== 'string') return false;
  if (email.trim().toLowerCase() !== OWNER_EMAIL.toLowerCase()) return false;
  if (password.length === 0 || password.length > 1024) return false;
  return constantTimeEqual(pwdOf(env), password);
}

export const authRoutes = new Hono<{ Bindings: Env }>()
  // 首次 setup（可选）：n8n 首启初始化 owner；本单用户实现直接返回现有 owner。
  .post('/owner/setup', async (c) => {
    return c.json({ data: { user: owner() } });
  })
  // 当前 owner：editor-ui 启动时 GET /rest/owner 读取实例 owner 信息。
  .get('/owner', async (c) => {
    if (!(await isAuthed(c))) return c.json({ code: 401, message: 'Unauthorized', data: undefined }, 401);
    return c.json({ data: owner() });
  })
  // 登录：校验密码 → 签发签名令牌写入 HttpOnly Cookie
  .post('/login', async (c) => {
    const body = await c.req.json<{ email?: string; password?: string }>().catch(() => ({} as { email?: string; password?: string }));
    if (!(await checkLogin(c.env, body?.email, body?.password))) {
      return c.json({ code: 401, message: 'Invalid email or password', data: undefined }, 401);
    }
    const token = await signToken(OWNER_EMAIL, secretOf(c.env));
    const secure = c.req.url.startsWith('https:') ? '; Secure' : '';
    return c.json({ data: owner() }, 200, {
      'Set-Cookie': `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(TOKEN_TTL_MS / 1000)}${secure}`,
    });
  })
  // 登录态探测：editor-ui 启动时 GET /rest/login 判断是否已登录。
  .get('/login', async (c) => {
    if (!(await isAuthed(c))) return c.json({ code: 401, message: 'Unauthorized', data: undefined }, 401);
    return c.json({ data: owner() });
  })
  // 注销：清空会话 Cookie
  .post('/logout', async (c) => {
    return c.json({ data: { loggedOut: true } }, 200, {
      'Set-Cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    });
  });