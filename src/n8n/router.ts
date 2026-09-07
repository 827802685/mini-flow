// n8n REST 适配层 —— /rest/* 路由聚合
// 前端 editor-ui 通过 VUE_APP_URL_BASE_API 指向这里。
import { Hono } from 'hono';
import type { Env } from '../types';
import { authRoutes } from './auth';
import { settingsRoutes, userRoutes } from './settings';
import { nodeTypeRoutes } from './node-types';
import { workflowRoutes } from './workflows';
import { executionRoutes } from './executions';
import { dlqRoutes } from './dead-letter';

export const restApi = new Hono<{ Bindings: Env }>()
  .route('/settings', settingsRoutes)
  .route('/', authRoutes)      // login / owner/setup（挂根即可，路径内再判）
  .route('/users', userRoutes)
  .route('/node-types', nodeTypeRoutes)
  .route('/workflows', workflowRoutes)
  .route('/executions', executionRoutes)
  .route('/dead-letter', dlqRoutes);

// n8n 返回统一包裹 { data, ... }，错误用 HTTP 状态 + { code, message }
export function wrap(data: unknown) {
  return { data };
}

export function error(status: number, message: string, code = status) {
  return { status, json: { code, message } };
}