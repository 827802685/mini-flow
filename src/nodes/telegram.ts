// telegram-nodes: Telegram 频道读取执行器
// 优先抓取 t.me/s/{channel}?embed=1 嵌入页（HTML 结构简单稳定），失败再退常规 /s/ 页。
// embed 页渲染了最近若干条消息，正文在 class="tgme_widget_message_text" 内，无需订阅或 token。
// 若全部渠道都取不到消息，在输出里附带诊断字段 __diagnostic，便于线上排查（不会进入推送正文）。
import type { NodeExecutionContext } from '../types';

type Item = { json: Record<string, any> };
type NodeOutput = Record<string, Item[]>;

// 抓取单个频道：返回 { messages, fetchStatus, ok, note }
async function fetchChannel(channel: string, limit: number): Promise<{ messages: { text: string; date?: string; link?: string }[]; fetchStatus: number; ok: boolean; note?: string }> {
  const slug = String(channel).replace(/^@/, '').replace(/.*t\.me\/(s\/)?/, '');
  if (!/^[A-Za-z0-9_]{3,64}$/.test(slug)) return { messages: [], fetchStatus: 0, ok: false, note: '非法频道名' };
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
  const urlCandidates = [
    `https://t.me/s/${slug}?embed=1&mode=tme`,
    `https://t.me/s/${slug}?embed=1`,
    `https://t.me/s/${slug}`,
  ];
  for (const url of urlCandidates) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': ua, 'accept': 'text/html,application/xhtml+xml,*/*;q=0.8', 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' },
        redirect: 'follow',
      });
      if (!res.ok) { if (url === urlCandidates[urlCandidates.length - 1]) return { messages: [], fetchStatus: res.status, ok: false, note: `fetch ${res.status}` }; continue; }
      const html = await res.text();
      const messages = parseTelegramHtml(html, slug, limit);
      // embed 页即便无解析结果但状态正常也继续尝试下一个 URL（可能返回的是反爬/空壳页）
      if (messages.length) return { messages, fetchStatus: res.status, ok: true };
      if (url === urlCandidates[urlCandidates.length - 1]) return { messages, fetchStatus: res.status, ok: true, note: `已请求但解析为空(htmlLen=${html.length})` };
    } catch (e) {
      if (url === urlCandidates[urlCandidates.length - 1]) return { messages: [], fetchStatus: -1, ok: false, note: e instanceof Error ? e.message : String(e) };
    }
  }
  return { messages: [], fetchStatus: 0, ok: false, note: '全部请求失败' };
}

// 兼容旧版调用（standalone worker / 测试）
export async function fetchChannelMessages(channel: string, limit = 10): Promise<{ text: string; date?: string; link?: string }[]> {
  const r = await fetchChannel(channel, limit);
  return r.messages;
}

export function parseTelegramHtml(html: string, slug: string, limit: number): { text: string; date?: string; link?: string }[] {
  const messages: { text: string; date?: string; link?: string }[] = [];
  if (!html || html.length < 100) return messages;

  // 策略A：按消息容器切块（embed 页与 /s/ 页通用）。
  // 容器 class 形如 `tgme_widget_message ` / `tgme_widget_message_with_...`，不能用 <div 切，
  // 用不带闭合引号的 lookahead 排除 tgme_widget_message_text / _wrap 等。
  const parts = html.split(/(?=<div class="tgme_widget_message(?![a-zA-Z_]))/).slice(1);

  // 策略B：若容器切块没拿到正文，直接全页提取正文节点（逐条取，尽力覆盖）。
  if (parts.length === 0) {
    const texts = html.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/g) ?? [];
    for (const block of texts) {
      if (messages.length >= limit) break;
      const text = extractTextBlock(block);
      if (!text) continue;
      messages.push({ text, link: `https://t.me/s/${slug}` });
    }
    return messages;
  }

  for (const block of parts) {
    if (messages.length >= limit) break;
    const text = extractTextBlock(block);
    if (!text) continue;
    const dm = block.match(/<time[^>]*datetime="([^"]+)"/);
    const post = block.match(/data-post="([^"]+)"/);
    let link = `https://t.me/s/${slug}`;
    if (post && post[1] && post[1].includes('/')) link = `https://t.me/${post[1]}`;
    else {
      const lm = block.match(/<a\s+href="([^"]+)"/);
      if (lm && lm[1].startsWith('/') && !lm[1].includes('/s/')) link = 'https://t.me' + lm[1];
    }
    messages.push({ text, date: dm ? dm[1] : undefined, link });
  }
  return messages;
}

function extractTextBlock(block: string): string {
  // 定位正文起始：正文容器 class 以 tgme_widget_message_text 开头
  const idx = block.indexOf('tgme_widget_message_text');
  if (idx < 0) return '';
  const open = block.indexOf('>', idx);
  if (open < 0) return '';
  // 正文从该 > 之后到匹配的 </div>（嵌套遍历深度，避免内层 </div> 过早闭合）
  let depth = 0;
  let cursor = open + 1;
  const len = block.length;
  let closedAt = -1;
  while (cursor < len) {
    const openTag = block.indexOf('<div', cursor);
    const closeTag = block.indexOf('</div>', cursor);
    if (closeTag < 0) break;
    if (openTag >= 0 && openTag < closeTag) { depth++; cursor = openTag + 4; continue; }
    if (depth === 0) { closedAt = closeTag; break; }
    depth--; cursor = closeTag + 6;
  }
  const raw = closedAt >= 0 ? block.slice(open + 1, closedAt) : block.slice(open + 1);
  return cleanText(raw);
}

function cleanText(s: string): string {
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, '');
  s = s.replace(/\u00a0|&nbsp;/g, ' ');
  s = s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'");
  // 通用解码所有数字字符实体：&#33; → !、&#x21; → !、&#39; → ' 等
  s = s.replace(/&#(?:x([0-9a-fA-F]+)|(\d+));/g, (_, hex, dec) => {
    const cp = hex ? parseInt(hex, 16) : parseInt(dec, 10);
    try { return String.fromCodePoint(cp); } catch { return ''; }
  });
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  s = s.replace(/^[\s>]+/, '').replace(/\s+$/, '');
  return s.trim();
}

// 消息去重键：折叠空白(含换行)+统一大小写，用于识别"同一内容换行方式不同"的重复帖子
export function dedupeKey(t: string): string {
  return t.replace(/\s+/g, ' ').trim().toLowerCase();
}

export const telegramChannelNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters ?? {};
    const rawChannels = p.channels ?? p.channel ?? 'FireflyLeak';
    let list: string[] = [];
    if (Array.isArray(rawChannels)) list = rawChannels.map(String);
    else if (typeof rawChannels === 'string') {
      const t = rawChannels.trim();
      if (t.startsWith('[')) {
        try { const arr = JSON.parse(t); list = Array.isArray(arr) ? arr.map(String) : [t]; }
        catch { list = [t]; }
      } else {
        list = t.split(/[,，\n]/).map((s: string) => s.trim()).filter(Boolean);
      }
    }
    if (!list.length) list = ['FireflyLeak'];
    const limit = Number(p.limit ?? 5) || 5;

    const out: Item[] = [];
    const diag: Record<string, any> = {};
    const seen = new Set<string>(); // 跨频道全局去重：折叠空白后的文本重复则丢弃
    for (const ch of list) {
      const slug = String(ch).replace(/^@/, '').replace(/.*t\.me\/(s\/)?/, '');
      const r = await fetchChannel(ch, limit).catch((e) => ({ messages: [] as any[], fetchStatus: -2, ok: false, note: e instanceof Error ? e.message : String(e) }));
      diag[slug] = { fetchStatus: r.fetchStatus, ok: r.ok, count: r.messages.length, note: r.note };
      for (const m of r.messages) {
        const key = dedupeKey(m.text);
        if (!key || seen.has(key)) continue; // 空文本或重复：丢弃
        seen.add(key);
        out.push({ json: { channel: slug, text: m.text, date: m.date ?? null, link: m.link ?? null } });
      }
    }

    // 全空时附上诊断，帮助线上排查；正常时不携带，避免污染负载
    if (out.length === 0) {
      return { main: [{ json: { __diagnostic: diag } }] };
    }
    return { main: out };
  },
};

// ---- 独立跑一次：给定配置调用（供 standalone worker 复用） ----
export async function gatherChannels(channels: string[], limitPer = 5) {
  const out: Item[] = [];
  for (const ch of channels) {
    const slug = String(ch).replace(/^@/, '').replace(/.*t\.me\/(s\/)?/, '');
    const msgs = await fetchChannelMessages(ch, limitPer);
    for (const m of msgs) out.push({ json: { channel: slug, text: m.text, date: m.date ?? null, link: m.link ?? null } });
  }
  return out;
}