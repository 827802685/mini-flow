// webhook / schedule 触发器节点执行器（透传型）
import type { NodeExecutionContext } from '../types';

// Webhook：由外部请求注入数据，这里直接透传输入
export const webhookNode = {
  async execute(ctx: NodeExecutionContext) {
    // ctx.inputData 由 dag 组装：若没有上游输出则 ctx.inputData.main = [ { json: p.input } ]
    return ctx.inputData?.main && ctx.inputData.main.length ? ctx.inputData : { main: [{ json: { triggeredAt: new Date().toISOString() } }] };
  },
};

// Manual Trigger（手动触发）：透传输入
// buildInputFor 会把 p.input 打包为 main=[{json:p.input}]，这里原样下放即可。
export const manualTriggerNode = {
  async execute(ctx: NodeExecutionContext) {
    return ctx.inputData?.main && ctx.inputData.main.length ? ctx.inputData : { main: [{ json: { triggeredAt: new Date().toISOString() } }] };
  },
};

// Schedule/Cron：由 cron 触发，透传空输入（保证可编排）
export const scheduleNode = {
  async execute(ctx: NodeExecutionContext) {
    return { main: [{ json: { triggeredAt: new Date().toISOString() } }] };
  },
};