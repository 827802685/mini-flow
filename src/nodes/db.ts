// db-nodes: 数据库相关节点执行器
// 1) D1Query：真实的 D1(SQLite) 查询节点 —— 使用 worker 的 env.DB 执行 SQL，
//    支持 {{ $json.x }} 插值绑定参数，无凭据第三方数据库则以字符串回显（不伪造连接）。
// 2) 外部数据库占位：MySQL / Postgres / SQLite 等，在无真实连接时返回指令提示而非伪造数据。
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

// ---- D1 Query：对 worker 的 D1 数据库真实执行 SQL ----
// 参数：query(必填,支持 {{ }} 插值)；无返回数据则回显 status。
export const d1QueryNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters ?? {};
    const item = ctx.inputData?.main?.[0]?.json ?? {};
    const queryTemplate = String(p.query ?? '');
    if (!queryTemplate) return { main: [{ json: { error: '缺少 SQL 查询语句', ok: false } }] };
    const query = interp(queryTemplate, item);
    try {
      const res = await ctx.env.DB.prepare(query).all();
      const rows = (res.results ?? []) as Record<string, unknown>[];
      const hasQuery = /^\s*(select|with|pragma|explain|values)/i.test(query);
      return {
        main: rows.length
          ? rows.map((r) => ({ json: r }))
          : [{ json: hasQuery ? { rows: rows, count: 0 } : { success: true, changes: res.meta?.changes ?? 0, rows: [] } }],
      };
    } catch (e) {
      return {
        main: [{ json: { error: e instanceof Error ? e.message : String(e), query, ok: false } }],
      };
    }
  },
};

// ---- 外部数据库占位：无法在 worker 内建立 DB 长连接时，返回指引。
// ---- 不伪造查询结果，避免"看起来执行成功"的假象。 ----
export const dbPlaceholderNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters ?? {};
    const item = ctx.inputData?.main?.[0]?.json ?? {};
    const op = p.operation ?? p.operate ?? 'query';
    return {
      main: [{
        json: {
          ...item,
          __dbPlaceholder: {
            db: ctx.node.type.replace('n8n-nodes-base.', ''),
            operation: op,
            note: '当前 Worker 环境未配置该外部数据库连接。如需真实查询，请用 D1 Query 节点，或用 HTTP Request 直连数据库 API。',
          },
        },
      }],
    };
  },
};

// ---- D2：通用"执行成功后透传"辅助，供自定义数据库等哑节点复用 ----
export const passthroughWithNote = async (_ctx: NodeExecutionContext, note: string): Promise<NodeOutput> => {
  return { main: [{ json: { __note: note } }] };
};