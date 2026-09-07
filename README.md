# mini-flow

把 n8n 的可视化工作流编排 + 节点执行能力，原生化搬迁到 Cloudflare Workers 的轻量引擎，并内置"防丢失与中断恢复"（检查点、幂等重试、死信队列、防重叠锁）。

> 权威决策见 `DECISIONS.md`（前端复用 n8n editor-ui、Workers 复刻 n8n REST、DO SSE 门面、Workflows 断点续跑）。

## 目录

- `frontend/` — 复用的 n8n editor-ui 接入说明
- `src/n8n/` — n8n REST 契约适配层（settings/auth/workflows/executions）
- `src/engine/` — 韧性核心：checkpoint / retry / lock / dead-letter / dag / evaluator
- `src/runtime/` — Workflows 执行底座 + Durable Object SSE 门面
- `src/nodes/` — 内置节点执行器（受限求值器替代 new Function）

## 快速开始

```bash
npm install
# 1) 建 D1
npx wrangler d1 create mini-flow-db            # 把 database_id 填进 wrangler.jsonc
npx wrangler d1 execute mini-flow-db --file=schema.sql
# 2) 本地
npm run dev
# 3) 类型检查
npm run type-check
```

## 环境变量/绑定

- `DB` D1、`CREDENTIALS` KV、`FLOW_ENGINE` Workflows、`PUSH` Durable Object、cron `*/15 * * * *`。

## 状态

Phase 1 骨架：结构与契约可运行（含 SSE 门面、14 个 n8n 端点、韧性四机制）。接入 n8n editor-ui dist 后即可得到可视化界面。