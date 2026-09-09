// ai-nodes: AI 相关节点执行器
// Worker 无凭据中心，采用 KV(CREDENTIALS) 存键；未配置则回显说明，不伪造 AI 结果。
// openaiChatNode: 通过 HTTP 呼叫 OpenAI 兼容 /chat/completions（可用 OpenAI / DeepSeek / 本地 vLLM）。
// Embeddings / LLM 等其它 AI 节点作为透传占位，回执提示词。
import type { NodeExecutionContext } from '../types';

type Item = { json: Record<string, any> };
type NodeOutput = Record<string, Item[]>;

function interp(tpl: string, item: Record<string, any>): string {
  return tpl.replace(/\{\{\s*\$?json\.([\w.]+)\s*\}\}|{{\s*([\w.]+)\s*}}/g, (_m, a, b) => {
    const p = ((a ?? b) as string).split('.');
    const v: unknown = p.reduce((acc: any, k: string) => (acc == null ? acc : acc[k]), item);
    return v === undefined || v === null ? '' : String(v);
  });
}

// ---- OpenAI 兼容 Chat 节点 ----
// 参数：system/prompt(+ 可选 json.messages 均值)、model、baseUrl、apiKeyParam。
// 若 KV 中存有 openai_api_key 则用之，否则回显提示。
export const openaiChatNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters ?? {};
    const item = ctx.inputData?.main?.[0]?.json ?? {};
    const apiKey = p.apiKey ?? (await ctx.env.CREDENTIALS.get('openai_api_key').catch(() => null));
    if (!apiKey) {
      return { main: [{ json: { ...item, __aiMissingKey: '请在 KV(CREDENTIALS) 设置 openai_api_key，或在节点参数中填写 API Key' } }] };
    }
    const baseUrl = String(p.baseUrl ?? 'https://api.openai.com/v1');
    const model = String(p.model ?? 'gpt-4o-mini');
    const system = p.system && typeof p.system === 'string' ? interp(p.system, item) : 'You are a helpful assistant.';
    const prompt = String(p.prompt ?? '');
    const userContent = prompt.includes('{{') ? interp(prompt, item) : prompt;
    const url = baseUrl.replace(/\/+$/, '') + '/chat/completions';
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: userContent },
          ],
          temperature: Number(p.temperature ?? 0.7),
          max_tokens: Number(p.maxTokens ?? 1024),
        }),
      });
      const text = await res.text();
      let parsed: any = {}; try { parsed = JSON.parse(text); } catch { /* keep raw */ }
      const content = parsed?.choices?.[0]?.message?.content ?? null;
      return {
        main: [{ json: { ...item, ai: { model, content, rawStatus: res.status } } }],
      };
    } catch (e) {
      return { main: [{ json: { ...item, __aiError: e instanceof Error ? e.message : String(e) } }] };
    }
  },
};

// ---- 通用 AI 占位：Embeddings / Hugging Face / LangChain 等（无 AVAI 凭据时回执） ----
export const aiPlaceholderNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const item = ctx.inputData?.main?.[0]?.json ?? {};
    return {
      main: [{ json: { ...item, __aiPlaceholder: `当前环境未启用 ${ctx.node.type.replace('n8n-nodes-base.', '')} 节点（需第三方 AI 凭据/模型）。` } }],
    };
  },
};