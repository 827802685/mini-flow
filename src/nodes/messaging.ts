// messaging-nodes: 企业微信 webhook 发送 + 文本整合
// weComSendNode: POST 到企业微信群机器人 webhook（markdown/text），真实可执行。
// translateNode: 调用翻译 API（OpenAI 兼容 / 免费引擎可选），未配置引擎则回显原文并给提示。
import type { NodeExecutionContext } from '../types';

type Item = { json: Record<string, any> };
type NodeOutput = Record<string, Item[]>;

function escapeMd(s: string): string {
  return String(s).replace(/<\/?h[1-6]/gi, '').replace(/<\/?[a-z][^>]*>/gi, '');
}

// ---- 企业微信群机器人 webhook 发送 (markdown) ----
export const weComSendNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters ?? {};
    const items = ctx.inputData?.main ?? [];
    const webhook = String(p.webhookUrl ?? p.url ?? '');
    const keyMatch = webhook.match(/key=([\w-]+)/);
    if (!keyMatch) return { main: [{ json: { ok: false, error: '缺少有效企业微信 webhook URL(须含 key=)' } }] };
    const endpoint = `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${keyMatch[1]}`;

    // 1) 若直接给了 content，直接发送
    let content = raw(p.content ?? '');
    // 2) 否则把多条输入整合成 markdown 列表
    if (!content && items.length) {
      content = buildDigest(items);
    }
    if (!content) return { main: [{ json: { ok: false, error: '内容为空' } }] };

    const msgtype = String(p.msgtype ?? 'markdown');
    const body = msgtype === 'text'
      ? { msgtype: 'text', text: { content } }
      : { msgtype: 'markdown', markdown: { content } };
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let parsed: any = {}; try { parsed = JSON.parse(text); } catch { /* keep */ }
      return { main: [{ json: { ok: res.status === 200 && parsed.errcode === 0, status: res.status, response: parsed } }] };
    } catch (e) {
      return { main: [{ json: { ok: false, error: e instanceof Error ? e.message : String(e) } }] };
    }
  },
};

// ---- 翻译节点（Google 免费接口 / OpenAI 兼容可配） ----
export const translateNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters ?? {};
    const items = ctx.inputData?.main ?? [];
    const engine = String(p.engine ?? 'google');
    const target = String(p.target ?? 'zh-CN');
    const out: Item[] = [];
    for (const it of items) {
      const j = it.json ?? {};
      const textProp = String(p.textField ?? p.field ?? 'text');
      const src = raw(getPath(j, textProp));
      let translated = '';
      if (!src) { out.push({ json: { ...j, translated: '' } }); continue; }
      if (engine === 'google' || engine === 'auto') {
        // 目标简体中文且原文已是中文：直接使用，避免把中文"翻译"成乱码或触发错误接口
        const looksChinese = /[\u4e00-\u9fff]/.test(src);
        if (target === 'zh-CN' && looksChinese) {
          out.push({ json: { ...j, translated: src, translationTarget: target } }); continue;
        }
        translated = await googleTranslate(src, target);
        if (!translated) {
          // 翻译真正为空或失败：回退原文，保证下游推送非空
          out.push({ json: { ...j, translated: src, translationTarget: target, translatedValid: false } }); continue;
        }
      } else if (engine === 'openai') {
        const apiKey = p.apiKey ?? (await ctx.env.CREDENTIALS.get('openai_api_key').catch(() => null));
        const baseUrl = String(p.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
        if (!apiKey) { out.push({ json: { ...j, translated: '', __translateError: '需 KV openai_api_key 或填写 apiKey' } }); continue; }
        try {
          const res = await fetch(baseUrl + '/chat/completions', {
            method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ model: String(p.model ?? 'gpt-4o-mini'), messages: [
              { role: 'system', content: `Translate the following text to ${target === 'zh-CN' ? 'Simplified Chinese' : target}. Only output the translation.` },
              { role: 'user', content: src },
            ], temperature: 0.2 }),
          });
          const data = (await res.json()) as any;
          translated = data?.choices?.[0]?.message?.content ?? '';
        } catch (e) {
          translated = src; out.push({ json: { ...j, translated, translationTarget: target, translatedValid: false } }); continue;
        }
      } else {
        translated = src; // 未识别引擎：原样返回
      }
      out.push({ json: { ...j, translated, translationTarget: target } });
    }
    return { main: out };
  },
};

function raw(v: unknown): string { return v === undefined || v === null ? '' : String(v); }
function getPath(o: any, path: string): unknown { return String(path).split('.').reduce<any>((a, k) => (a == null ? a : a[k]), o); }

// 取消息显示正文：优先有效译文，否则原文，最后 content/body
function textOf(j: Record<string, any>): string {
  const t = raw(j.translated);
  if (t.trim() !== '') return t;
  return String(raw(j.text ?? j.content ?? j.body ?? ''));
}

// 防御性解码数字实体（抓取节点已解码，这里兜底）
function decodeEntities(s: string): string {
  return s.replace(/&#(?:x([0-9a-fA-F]+)|(\d+));/g, (_, hex, dec) => {
    const cp = hex ? parseInt(hex, 16) : parseInt(dec, 10);
    try { return String.fromCodePoint(cp); } catch { return ''; }
  });
}

// 明显噪音过滤：系统自动消息、机器人报错、纯表情/符号/超短无意义
function isNoiseMessage(t: string): boolean {
  const s = decodeEntities(String(t)).trim();
  if (!s) return true;
  if (/QUERY LENGTH LIMIT/i.test(s) || /MAX ALLOWED QUERY/i.test(s)) return true;
  if (/will be automatically deleted/i.test(s) || /自动删除/i.test(s)) return true;
  // 纯符号/表情组成：剥掉中英文数字后几乎没有剩余
  const letters = s.replace(/[\u4e00-\u9fffA-Za-z0-9]/g, '');
  return letters.length > 0 && s.length < 5;
}

// 把抓取+翻译后的条目整合成按频道分组的 markdown 摘要（去重/去噪/分组/限长）
function buildDigest(items: Item[]): string {
  const PER_CHANNEL = 3;     // 每频道最多条目，避免单频道刷屏
  const MAX_TOTAL = 12;      // 总条数上限
  const MAX_LINE = 500;      // 单条正文长度上限(超出截断)
  const PCT_GUARD = 3400;    // 微信 markdown 字节安全上限

  const valid = items.filter((it) => {
    const j = it.json ?? {};
    const body = textOf(j);
    return body.trim() !== '' && !isNoiseMessage(body);
  });

  // 按频道分组（保持原顺序），每频道限条数
  const groups: Array<{ ch: string; rows: Item[] }> = [];
  const byCh = new Map<string, Item[]>();
  for (const it of valid) {
    const ch = String((it.json ?? {}).channel ?? '');
    if (!byCh.has(ch)) byCh.set(ch, []);
    if (byCh.get(ch)!.length < PER_CHANNEL) byCh.get(ch)!.push(it);
  }
  for (const [ch, rows] of byCh) groups.push({ ch, rows });

  const parts: string[] = [];
  let used = 0;
  for (const g of groups) {
    if (used >= MAX_TOTAL) break;
    const rows = g.rows;
    const lines = rows.map((it) => {
      const j = it.json ?? {};
      const txt = decodeEntities(textOf(j));
      const slim = txt.length > MAX_LINE ? txt.slice(0, MAX_LINE) + '…' : txt;
      return `> ${escapeMd(slim)}`;
    });
    const block = `**【${g.ch || '未命名频道'}】**\n${lines.join('\n')}`;
    parts.push(block);
    used += rows.length;
  }
  if (!parts.length) return '';

  let content = `**频道消息更新 ${new Date().toLocaleString('zh-CN')}**\n\n` + parts.join('\n\n──────────\n\n');
  // 微信 markdown 上限约 4096 字节，超出收缩（优先删尾部频道块，再截断字节）
  if (new TextEncoder().encode(content).length > PCT_GUARD) content = content.slice(0, PCT_GUARD - 50) + '\n…';
  return content;
}

// 多引擎翻译。返回译文；全部失败返回空串（上层回退原文）。
// 优先 Google 免费接口；若其返回 HTML（CF 数据中心出口反爬）则退 MyMemory 免费 JSON API；再失败返回空。
async function googleTranslate(src: string, target: string): Promise<string> {
  const lang = target === 'zh-CN' || target === 'zh_CN' || target === 'zh' ? 'zh-CN' : target;
  // 1) Google gtx
  try {
    const u = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(lang)}&dt=t&q=${encodeURIComponent(src.slice(0, 4700))}`;
    const res = await fetch(u, { headers: { 'accept': 'application/json,text/*', 'user-agent': 'Mozilla/5.0' } });
    if (res.ok) {
      const rawText = await res.text();
      // 仅当返回的是 JSON 才采纳（CF 出口可能拿到 HTML 验证页）
      if (rawText.trimStart().startsWith('[') || rawText.trimStart().startsWith('{')) {
        try {
          const data = JSON.parse(rawText);
          const segs = Array.isArray(data?.[0]) ? (data[0] as any[]).filter(Array.isArray).map((s: any[]) => s[0]).filter((v: any) => typeof v === 'string') : [];
          const t = segs.join('').trim();
          if (t) return t;
        } catch { /* fall through */ }
      }
    }
  } catch { /* fall through */ }

  // 2) MyMemory 免费 API（返回纯 JSON，无需 key）
  try {
    const pair = `${lang === 'zh-CN' ? 'zh-CN' : 'auto'}|${lang}`;
    const u = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(src.slice(0, 4800))}&langpair=${encodeURIComponent('en|' + (lang === 'zh-CN' ? 'zh-CN' : lang))}`;
    const res = await fetch(u, { headers: { 'accept': 'application/json' } });
    if (res.ok) {
      const rawText = await res.text();
      try {
        const data = JSON.parse(rawText);
        const t = (data?.responseData?.translatedText ?? '').trim();
        if (t) return t;
      } catch { /* fall through */ }
    }
  } catch { /* fall through */ }

  return '';
}