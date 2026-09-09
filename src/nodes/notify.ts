// notify-nodes: 消息通知/通讯节点执行器
// - httpSendNode：真实发送 HTTP 请求（供 Webhook/自定义通知用）。
// - notifyPlaceholderNode：Email / Slack / Telegram / SMS / Discord 等，无第三方凭据时回执提示（不伪造发送）。
import type { NodeExecutionContext } from '../types';

type Item = { json: Record<string, any> };
type NodeOutput = Record<string, Item[]>;

// ---- HTTP Send：真实发送（可作通用通知/回调） ----
export const httpSendNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters ?? {};
    const items = ctx.inputData?.main ?? [];
    const url = String(p.url ?? '');
    const method = String(p.method ?? 'GET').toUpperCase();
    if (!url) {
      return { main: [{ json: { ...(items[0]?.json ?? {}), __httpSendError: '缺少 URL' } }] };
    }
    const bodyMap: Record<string, any> = {};
    for (const i of items) Object.assign(bodyMap, i.json);
    try {
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: method !== 'GET' && method !== 'HEAD' ? JSON.stringify(bodyMap) : undefined,
      });
      return { main: [{ json: { status: res.status, ok: res.ok, response: await res.text().then((t) => { try { return JSON.parse(t); } catch { return t; } }) } }] };
    } catch (e) {
      return { main: [{ json: { ...bodyMap, __httpSendError: e instanceof Error ? e.message : String(e) } }] };
    }
  },
};

// ---- 通知占位节点：Email / Slack / Telegram / SMS / Discord / Pipedrive 等 ----
export const notifyPlaceholderNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters ?? {};
    const items = ctx.inputData?.main ?? [];
    const type = ctx.node.type.replace('n8n-nodes-base.', '');
    const channelMeta = {
      sendgrid: 'Email(SendGrid)', email: 'Email', slack: 'Slack', telegram: 'Telegram',
      sms: 'SMS', discord: 'Discord', whatsapp: 'WhatsApp', mail: 'Email', mailchimp: 'Mailchimp',
    } as Record<string, string>;
    const label = channelMeta[type] ?? type;
    return {
      main: [{
        json: {
          ...(items[0]?.json ?? {}),
          __notifyPlaceholder: {
            channel: label,
            note: `当前环境未配置 ${label} 凭据（KV/CREDENTIALS 无对应 key）。要真实发送，请给 HTTP Request 配置第三方 API 凭据，或填入 KV 中 ${type}_token。`,
          },
        },
      }],
    };
  },
};

// ---- Webhook 发送(Slack 兼容 incoming webhook 形态) ----
export const webhookSendNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters ?? {};
    const items = ctx.inputData?.main ?? [];
    const url = String(p.url ?? '');
    if (!url) {
      return { main: [{ json: { ...(items[0]?.json ?? {}), __webhookSendError: '缺少 Webhook URL' } }] };
    }
    try {
      const payload = JSON.parse(raw(p.message ?? items[0]?.json ?? '{}'));
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      return { main: [{ json: { ok: res.ok, status: res.status } }] };
    } catch (e) {
      return { main: [{ json: { __webhookSendError: e instanceof Error ? e.message : String(e) } }] };
    }
  },
};

function raw(v: unknown): string { return v === undefined || v === null ? '' : String(v); }