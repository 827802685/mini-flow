# frontend/ — n8n editor-ui 复用接入说明

本目录用于承载被复用的 n8n 官方前端（editor-ui）构建产物，以及接入配置。

## 原则（见 DECISIONS.md §2.1）

- **不改前端源码**。n8n editor-ui 是 Vue3 SPA，通过编译期环境变量 `VUE_APP_URL_BASE_API` 指向我们的后端。
- 后端不渲染页面，只：托管 dist 静态资源 + 提供 `/rest/*` + `/push` SPA fallback 路由。

## 接入步骤

1. 构建 n8n editor-ui：
   ```bash
   # 在 n8n monorepo 中构建前端（官方支持前后端分离）
   cd packages/editor-ui
   VUE_APP_URL_BASE_API=https://<你的worker域名>/rest npm run build   # 把 REST 基址指向我们
   ```
   产物在 `dist/`。

2. 把 `dist/*` 拷贝到本目录：
   ```bash
   cp -r packages/editor-ui/dist/* ./frontend/dist/
   ```

3. 后端 `src/index.ts` 的 `fetchAsset()` 改为从 `frontend/dist` 读取静态资源（当前为占位，返回 null 走 SPA 占位提示）。

4. 部署：
   ```bash
   npm run deploy
   ```

## Worker 前端需满足的 n8n 端点（已在后端实现）

`/rest/settings`、`/rest/login`、`/rest/users/me`、`/rest/node-types`、`/rest/workflows`(+`/:id/run`)、`/rest/executions`(+`/:id`)，以及 `/push`（SSE，经 Durable Object 转发执行进度）。

## 说明

- 单用户最小实现（owner/admin@localhost）。
- OAuth2/多用户/AI 等 n8n 高级能力暂走 DO SSE 适配或标记为可选，骨架阶段不阻塞闭环。