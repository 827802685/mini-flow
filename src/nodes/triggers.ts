// trigger-nodes: 补充触发器节点
// cronNode: 解析标准 cron 表达式，判断"当前分钟是否命中"（cron 触发运行时用）。
// formTriggerNode: 表单触发器 —— 由外部 POST 注入数据，透传输入。
// scheduleIntervalNode: 间隔触发（透传，实际由 cron 调度调用）。
import type { NodeExecutionContext } from '../types';

type Item = { json: Record<string, any> };
type NodeOutput = Record<string, Item[]>;

// ---- Cron：判断给定时刻(分钟级)是否命中 cron 表达式 ----
// 支持 * / 数字，5 段：分 时 日 月 周
export function cronMatches(cron: string, date: Date = new Date()): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [min, hour, dom, mon, dow] = parts;
  const ok = (spec: string, value: number): boolean => {
    if (spec === '*') return true;
    return spec.split(',').some((s) => {
      if (s.includes('/')) {
        const [base, stepS] = s.split('/');
        const step = parseInt(stepS, 10);
        const start = base === '*' ? 0 : parseInt(base, 10);
        return value >= start && (value - start) % step === 0;
      }
      return parseInt(s, 10) === value;
    });
  };
  return ok(min, date.getMinutes())
    && ok(hour, date.getHours())
    && ok(dom, date.getDate())
    && ok(mon, date.getMonth() + 1)
    && ok(dow, date.getDay());
}

export const cronNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    const p = ctx.node.parameters ?? {};
    const expr = String(p.cronExpression ?? p.expression ?? '0 * * * *');
    const hit = cronMatches(expr);
    return {
      main: hit
        ? [{ json: { triggeredAt: new Date().toISOString(), cron: expr, matched: true } }]
        : [],
    };
  },
};

// ---- Form Trigger：透传输入（由外部请求注入） ----
export const formTriggerNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    if (ctx.inputData?.main?.length) return ctx.inputData;
    return { main: [{ json: { triggeredAt: new Date().toISOString(), source: 'form' } }] };
  },
};

// ---- Interval 间隔触发：透传 ----
export const intervalNode = {
  async execute(_ctx: NodeExecutionContext): Promise<NodeOutput> {
    return { main: [{ json: { triggeredAt: new Date().toISOString(), source: 'interval' } }] };
  },
};

// ---- Scheduled / 仅展示：透传 ----
export const scheduleTriggerPassthroughNode = {
  async execute(ctx: NodeExecutionContext): Promise<NodeOutput> {
    if (ctx.inputData?.main?.length) return ctx.inputData;
    return { main: [{ json: { triggeredAt: new Date().toISOString() } }] };
  },
};