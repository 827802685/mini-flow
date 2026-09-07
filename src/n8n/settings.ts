// users, settings：前端初始化必调
import { Hono } from 'hono';
import type { Env } from '../types';

export const userRoutes = new Hono<{ Bindings: Env }>()
  .get('/me', (c) => c.json({ data: {
    id: 'owner', email: 'admin@localhost', firstName: 'Admin', lastName: '',
    role: 'owner', isOwner: true, isPending: false,
  } }))
  .get('/', (c) => c.json({ data: [] }));

export const settingsRoutes = new Hono<{ Bindings: Env }>()
  .get('/', (c) => c.json({ data: {
    // 端到端闭环最小值：让 editor-ui 能进入编辑器并加载
    logo: { iconType: 'file' },
    oauthCallbackUrls: { oauth2: ['http://localhost:8765/rest/oauth2-credential/callback'], oauth1: ['http://localhost:8765/rest/oauth1-credential/callback'] },
    versionCli: '1.0.0',
    timezone: 'UTC',
    executionMode: 'queue', // 异步执行
    backendBaseUrl: '/rest',
    ssoMetadata: undefined,
    license: { active: true, planName: 'mini-flow', quota: 0, usage: 0, userQuota: 1, entitlements: { functions: 'trigger' } },
    features: { executionTimeout: { dangling: 0, last: 0 }, advancedTools: [], variables: false, aiAssist: false, projects: false, projectRole: '' },
    defaultUserIsOwner: true,
    userManagement: { showSetupOnFirstLoad: false, isInstanceOwner: true, isUserManagementEnabled: true },
    banner: undefined,
    usage: 0,
    telemetry: { enabled: false },
    endpoint: { publicApi: '/api/v1', metrics: '/metrics' },
    planName: 'mini-flow',
    allowedModules: {},
    authenticationMethod: 'email',
    instance: { host: 'http://localhost:8765', baseUrl: 'http://localhost:8765', previewMode: false },
    templatesHost: 'https://api.n8n.io/api/',
    sentry: { dsn: undefined },
    deployment: { type: 'cloud', dedicated: false },
    auth: { defaultMethod: 'email', epoch: '2026-01-01', isLdapEnabled: false, oauth: { google: { configured: false }, github: { configured: false } }, sso: { saml: { configured: false }, ldap: { configured: false } } },
    queuedExecutionTimeout: undefined,
    socket: { enabled: false },
    templateData: undefined,
  } }))
  .get('/sso', (c) => c.json({ data: { configured: false }, action: 'GET' }))
  .get('/license', (c) => c.json({ data: { active: true, planName: 'mini-flow' } }))
  .get('/logo', (c) => c.json({ data: { logo: null } }));