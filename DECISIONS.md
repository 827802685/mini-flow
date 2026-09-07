# mini-flow — 已确认决策记录 (DECISIONS)

> 本文档固化本项目从需求到骨架的所有已确认方案，作为后续开发（尤其上下文被压缩后的续作）的权威依据。
> 最后更新：2026-09-07

## 1. 项目本质

把 n8n 的"可视化工作流编排 + 节点执行"能力原生化搬迁到 Cloudflare Workers，构建轻量引擎 **mini-flow**，并附带"防丢失与中断恢复"能力。

## 2. 核心架构决策（已拍板）

### 2.1 前端：直接复用 n8n editor-ui（不改代码）
- n8n editor-ui 是 Vue3 + Vite 的 SPA，通过编译期环境变量 `VUE_APP_URL_BASE_API` 把 REST 调用打到任意后端基址。
- 前端 **100% 复用**，不对其源码做魔改；只做静态资源托管到 CF（Workers / Assets）。
- 后端不渲染页面，只提供 `/rest/*` API + 静态资源 + SPA fallback 路由。

### 2.2 后端：在 Workers 上复刻 n8n REST 契约 + Push 协议
- 数据契约 = **n8n 原生 workflow JSON**（不是自研格式）。D1 存的就是 n8n 结构。
- `nodeTypes` 端点返回我们内置节点的注册元数据（外观照 n8n 模型定义）。
- 最小可运行闭环必选端点（约 14 个）：
  - `GET /rest/settings`, `POST /rest/login`, `GET /rest/users/me`
  - `GET /rest/node-types`, `GET /rest/node-types/:type`, `GET /rest/node-types/:type/json-schema`
  - `GET/POST /rest/workflows`, `GET/PATCH/DELETE /rest/workflows/:id`
  - `POST /rest/workflows/:id/run`
  - `GET /rest/executions`, `GET /rest/executions/:id`
  - Push 通道（SSE/WebSocket）上报执行进度
- 可选后续：settings/logo、license、favorites、credentials CRUD、dynamic-node-parameters、templates、projects、roles、executions retry/stop、workflows activate/deactivate 等。

### 2.3 执行进度：Durable Object 做 SSE 门面
- n8n 前端靠 Push（SSE/WebSocket）获取执行状态，非 REST 轮询。Workers 原生不支持 WebSocket / 长连接 SSE。
- 方案：用 **Cloudflare Durable Object** 作为 Push 协议门面，对外暴露 SSE 端点，把执行状态事件转发给前端；同时 `GET /rest/executions/:id` 作为结果兜底。

### 2.4 执行底座：Cloudflare Workflows 做断点续跑，D1 做控制面
- 把用户 DAG 编译成 Workflows 的 step 序列，用 `step.idempotent` 获得持久化 + 自动重试 + 平台级中断恢复。
- D1 承担：workflow 定义、execution 元数据、节点执行日志、锁、DLQ。
- 自研引擎 `engine/executor` 是业务调度入口，加载 D1 定义 → 上锁 → 编译 DAG → 提交 Workflows 执行。

### 2.5 韧性四大机制（来自设计文档，均为 P0）
- **节点级检查点 Checkpoint**：每节点执行成功后原子写 D1。
- **幂等重试 withRetry**：指数退避，所有外部/DB 调用必经。
- **死信队列 DLQ**：重试耗尽投 D1 死信表，cron 扫描自动重试/人工介入。
- **防重叠乐观锁**：Cron 触发先抢锁，失败即跳过。

### 2.6 Code/Function 节点：受限求值器，禁止 `new Function`
- Cloudflare Workers 由 CSP 硬性禁用 `eval()` 和 `new Function`。n8n 的 Function 节点任意 JS 在 Workers 不可用。
- 替代：`engine/evaluator.ts` 受限表达式求值器 + 预注册函数库，覆盖字段转换/条件/计算高频场景。

## 3. 项目结构（最终版）

```
mini-flow/
├── wrangler.jsonc            # Worker + D1 + KV + Workflows + Durable Object + cron
├── package.json / tsconfig.json
├── schema.sql                # D1 完整 Schema（含恢复扩展表 + DLQ + 索引）
├── DECISIONS.md              # 本文件
├── frontend/                 # n8n editor-ui 静态 dist（复用，接入说明见 README）
└── src/
    ├── index.ts              # Hono 装配 + 静态托管 fallback + cron 入口
    ├── types.ts              # 核心类型 + Env 绑定
    ├── db/schema.ts          # 表结构与索引定义（对应 schema.sql）
    ├── engine/               # 韧性核心
    │   ├── evaluator.ts      # 受限表达式求值器（替代 Code 节点的 new Function）
    │   ├── retry.ts          # withRetry 指数退避
    │   ├── checkpoint.ts     # 检查点读写与恢复
    │   ├── lock.ts           # 乐观锁 + 超时清理
    │   ├── dead-letter.ts    # DLQ 写入/扫描/重试
    │   ├── dag.ts            # n8n workflow JSON → 步骤序列（含条件分支）
    │   └── executor.ts       # 业务调度主入口：锁→检查点→提交 Workflows
    ├── runtime/
    │   ├── flow-engine.ts    # extends WorkflowEntrypoint：step 执行
    │   └── push.ts           # Durable Object：SSE Push 门面
    ├── nodes/                # 节点执行实现（按 engine 消费）
    │   ├── index.ts          # 节点注册表
    │   ├── http-request.ts / set.ts / if-condition.ts / webhook.ts
    └── n8n/                  # n8n REST 契约适配层
        ├── router.ts         # /rest/* 路由聚合
        ├── settings.ts / auth.ts / users.ts
        ├── node-types.ts     # nodeTypes 元数据
        ├── workflows.ts      # workflows CRUD
        ├── executions.ts     # executions 列表/详情 + run
        └── push.ts           # 与 runtime/push 对接，订阅执行事件
```

## 4. 数据契约：n8n workflow JSON 形态

D1 `workflows.nodes` 列存储 n8n 结构化数组，典型节点对象：
```json
{
  "parameters": {},
  "name": "Webhook",
  "type": "n8n-nodes-base.webhook",
  "typeVersion": 1,
  "position": [240, 300]
}
```
`connections` 为 n8n 的 `{ [nodeName]: { main: [ [...targetNodeNames] ] } }` 形态。

## 5. 待办 / 未决（骨架阶段可后补）
- frontend/ 需用户提供 n8n editor-ui 的已构建 dist（或用 n8n 官方 Docker/构建流程产出）。
- cron 目前单一 `*/15 * * * *`，执行 DLQ 扫描 + 锁清理。
- 认证为单用户最小实现（login 返回 n8n-auth cookie），多用户/项目/角色属可选。