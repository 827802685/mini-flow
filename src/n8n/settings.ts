// users, settings：前端初始化必调
import { Hono } from 'hono';
import type { Env } from '../types';
import { isAuthed, owner } from './auth';

export const userRoutes = new Hono<{ Bindings: Env }>()
  .get('/me', (c) => {
    // 未登录 → 401，editor-ui 据此导向登录页
    if (!isAuthed(c)) return c.json({ code: 401, message: 'Unauthorized', data: undefined }, 401);
    return c.json({ data: owner() });
  })
  .get('/', (c) => c.json({ data: [] }));

// n8n 用户列表：/rest/users（复数）返回 { data: { count, items } }，侧边栏/成员列表据此读取
export const userListRoutes = new Hono<{ Bindings: Env }>()
  .get('/', (c) => c.json({ data: { count: 0, items: [] } }))
  .get('/:id', (c) => c.json({ data: null, code: 404, message: 'User not found' }, 404));

// /rest/module-settings：settings.store.getModuleSettings 直接 GET，返回模块级开关配置。
// quick-connect.options 为空数组，避免 useQuickConnect 读 moduleSettings['quick-connect'] 崩溃。
export const moduleSettingsRoutes = new Hono<{ Bindings: Env }>()
  .get('/', (c) => c.json({ data: {
    'quick-connect': { enabled: false, options: [] },
    'external-secrets': { enabled: false, forProjects: false, multipleConnections: false },
    mcp: { enabled: false, mcpAccessEnabled: false },
    'chat-hub': { providers: {} },
  } }));

export const settingsRoutes = new Hono<{ Bindings: Env }>()
  .get('/', (c) => {
    // 依据真实请求判定协议/源，避免安全 cookie 检查在本地 http 下误拦
    const url = new URL(c.req.url);
    const fwdProto = c.req.header('x-forwarded-proto');
    const proto = fwdProto || url.protocol.replace(':', '');
    const secure = proto === 'https'; // 生产 https → true；本地 http → false
    const origin = `${proto}://${url.host}`;
    const cb = (p: string) => `${origin}/rest/${p}`;
    return c.json({ data: {
      // 端到端闭环最小值：让 editor-ui 能进入编辑器并加载
      instanceId: 'mini-flow-instance',
      logo: { iconType: 'file' },
      oauthCallbackUrls: { oauth2: [cb('oauth2-credential/callback')], oauth1: [cb('oauth1-credential/callback')] },
      versionCli: '1.0.0',
      timezone: 'UTC',
      executionMode: 'queue', // 异步执行
      backendBaseUrl: '/rest',
      ssoMetadata: undefined,
      license: { active: true, planName: 'mini-flow', quota: 0, usage: 0, userQuota: 1, entitlements: { functions: 'trigger' } },
      features: { executionTimeout: { dangling: 0, last: 0 }, advancedTools: [], variables: false, aiAssist: false, projects: false, projectRole: '' },
      defaultUserIsOwner: true,
      userManagement: { showSetupOnFirstLoad: false, isInstanceOwner: true, isUserManagementEnabled: true },
      authCookie: { secure, cookieName: 'n8n-auth' },
      security: { blockFileAccessToN8nFiles: false },
      enterprise: {
        projects: { enabled: true, projectsEnabled: false, personal: true, team: { limit: -1 } },
        sharing: { enabled: true },
        advancedPermissions: { enabled: false },
        variables: { enabled: false },
        ldap: { enabled: false },
        saml: { enabled: false },
        logStreaming: { enabled: false },
      },
      banner: undefined,
      usage: 0,
      telemetry: { enabled: false },
      endpoint: { publicApi: '/api/v1', metrics: '/metrics' },
      planName: 'mini-flow',
      allowedModules: {},
      authenticationMethod: 'email',
      defaultLocale: 'en',
      locale: 'en',
      instance: { host: origin, baseUrl: origin, previewMode: false },
      urlBaseWebhook: `${origin}/webhook`,
      urlBaseEditor: origin,
      endpointForm: `${origin}/form`,
      endpointWebhook: `${origin}/webhook`,
      endpointWebhookTest: `${origin}/webhook-test`,
      binaryDataMode: 'default',
      n8nMetadata: {},
      concurrency: { productionLimit: 1, queueMode: false },
      maxExecutionTimeout: 3600,
      templatesHost: 'https://api.n8n.io/api/',
      sso: {
        saml: { loginEnabled: false, loginLabel: 'Sign in with SAML' },
        ldap: { loginEnabled: false, loginLabel: '' },
        oidc: { loginEnabled: false, loginUrl: '', providerName: '' },
      },
      sentry: { dsn: undefined },
      // 本部署为自托管型：type 用 'default'（非 'cloud'），
      // 使 isCloudDeployment=false，跳过 cloud store 初始化，消除
      // "Error checking for cloud plan data / Error fetching user cloud account" 告警。
      deployment: { type: 'default', dedicated: false },
      auth: { defaultMethod: 'email', epoch: '2026-01-01', isLdapEnabled: false, oauth: { google: { configured: false }, github: { configured: false } }, sso: { saml: { configured: false }, ldap: { configured: false } } },
      queuedExecutionTimeout: undefined,
      socket: { enabled: false },
      templateData: undefined,
      // 版本检查：versions.store 直接读取 settings.versionNotifications 并赋给 ref
      versionNotifications: { enabled: false, endpoint: '', infoUrl: '', whatsNewEndpoint: '' },
      // 埋点：users.store.login 后 init hook 读取 settings.posthog.enabled
      posthog: { enabled: false, proxy: '', autocapture: false, disableSessionRecording: true, debug: false },
      // 底部横幅：banners.store 读取 dynamicBanners.enabled/endpoint 与 banners.dismissed
      dynamicBanners: { enabled: false, endpoint: '' },
      banners: { dismissed: [] },
    } });
  })
  .get('/sso', (c) => c.json({ data: { configured: false }, action: 'GET' }))
  .get('/license', (c) => c.json({ data: { active: true, planName: 'mini-flow' } }))
  .get('/logo', (c) => c.json({ data: { logo: null } }));