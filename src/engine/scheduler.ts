// scheduler: 复用主 worker 的唯一 cron(每 15 分钟) 扫描并运行已激活的定时工作流
// 背景: Free 账号 cron 触发器有 5 个上限,已用满; 不再新增 cron。
// 策略: 在既有 cron tick 里扫描 workflows.active=1 且含 scheduleTrigger/cron 触发节点的工作流,
//       按其配置的间隔(分钟)判断是否到点, 到点则 startExecution(mode='cron')。
// 到点判定基于该 workflow 最近一次 cron 运行时间(executions.mode='cron'), 不新增表。
import type { Env } from '../types';
import { parseWorkflowRow, type WorkflowRow } from '../db/schema';
import { startExecution } from './executor';
import { withRetry } from './retry';
import { sendPush } from '../n8n/push';
import { presetById } from '../n8n/templates-presets';

// 从节点列表里解析出"定时间隔(分钟)"。命中 scheduleTrigger(interval 或 minutesInterval)、
// interval 触发器、cron(带表达式) 均视为定时工作流。
function findScheduleInterval(nodes: any[]): number | null {
  for (const n of nodes) {
    if (!n || typeof n.type !== 'string') continue;
    const t = String(n.type);
    const p = n.parameters ?? {};
    const minutes = Number(p.minutesInterval);
    if (t === 'n8n-nodes-base.scheduleTrigger' || /scheduleTrigger/i.test(t)) {
      const rule = String(p.rule ?? '');
      // rule=interval 或直接给了 minutesInterval
      if (rule.toLowerCase().includes('interval') || Number.isFinite(minutes)) {
        if (Number.isFinite(minutes) && minutes > 0) return minutes;
      }
      return null; // cron 表达式触发在工作流内自行判断
    }
    if (/intervalTrigger|node\.interval/i.test(t) || t === 'n8n-nodes-base.interval') {
      if (Number.isFinite(minutes) && minutes > 0) return minutes;
      return 1;
    }
  }
  return null;
}

// D1 datetime('now') 输出形如 "YYYY-MM-DD HH:MM:SS"(UTC, 无时区后缀)
function toEpochMs(s: string | null | undefined): number {
  if (!s) return 0;
  const v = new Date(s.replace(' ', 'T') + 'Z').getTime();
  return Number.isFinite(v) ? v : 0;
}

// 确保 TG 预设工作流存在且已激活(幂等: 仅在完全不存在时创建)
async function ensureTelegramWorkflow(env: Env): Promise<void> {
  const name = 'TG消息翻译推送';
  const row = await withRetry(() =>
    env.DB.prepare("SELECT id FROM workflows WHERE name=?").bind(name).first<{ id: string }>(),
  ).catch(() => undefined);
  if (row) return;
  const preset = presetById(100005);
  if (!preset) return;
  const wf = preset.workflow;
  await withRetry(() =>
    env.DB.prepare(
      "INSERT INTO workflows (id, name, nodes, connections, settings, project_id) VALUES (?,?,?,?,?,?)",
    ).bind(crypto.randomUUID(), wf.name, JSON.stringify(wf.nodes ?? []), JSON.stringify(wf.connections ?? {}), JSON.stringify({ executionOrder: 'v1' }), 'personal').run(),
  ).catch(() => {});
  // 立即置 active=1, 供后续启动
  await withRetry(() =>
    env.DB.prepare("UPDATE workflows SET active=1 WHERE name=?").bind(name).run(),
  ).catch(() => {});
}

// 扫描并启动所有"到点"的定时工作流。返回本次启动条数。
export async function runScheduledWorkflows(env: Env): Promise<number> {
  // 首次运行确保预设就位
  await ensureTelegramWorkflow(env);

  const res = await withRetry(() =>
    env.DB.prepare("SELECT * FROM workflows WHERE active=1").all<WorkflowRow>(),
  ).catch(() => undefined);
  if (!res) return 0;

  const nowMs = Date.now();
  let ran = 0;
  for (const row of res.results ?? []) {
    let nodes: any[] = [];
    try { nodes = JSON.parse(row.nodes ?? '[]'); } catch { continue; }
    const intervalMin = findScheduleInterval(nodes);
    if (!intervalMin || intervalMin <= 0) continue;

    // 取最近一次 cron 触发时间(容错: 读取失败视为从未运行 → 立即到点)
    const last = await withRetry(() =>
      env.DB.prepare("SELECT started_at FROM executions WHERE workflow_id=? AND mode='cron' ORDER BY started_at DESC LIMIT 1")
        .bind(row.id).first<{ started_at: string }>(),
    ).catch(() => undefined);

    let due: boolean;
    if (!last || !last.started_at) {
      due = true; // 首个触发点直接运行
    } else {
      const lastMs = toEpochMs(last.started_at);
      due = nowMs - lastMs >= intervalMin * 60_000;
    }
    if (!due) continue;

    const wf = parseWorkflowRow(row);
    const out = await startExecution(env, wf, {}, 'cron', (e) => void sendPush(env, e)).catch(() => ({ ok: false, executionId: '', error: 'scheduler start failed' }));
    if (out.ok) ran++;
  }
  return ran;
}