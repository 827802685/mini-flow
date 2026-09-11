// 核心类型定义

// n8n 节点定义（存 D1 的原生格式）
export interface N8nNode {
  parameters: Record<string, any>;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  id?: string;
  disabled?: boolean;
  credentials?: Record<string, { id?: string; name: string }>;
}

// n8n connections 形态: { [fromNode]: { main: Array<Array<{ node: string }>> } }
export type N8nConnections = Record<
  string,
  { main?: Array<Array<{ node: string }>> }
>;

// 内部连接的扁平表示（便于 DAG 计算）
export interface FlatConnection {
  from: string; // 节点 name
  to: string; // 节点 name
  branch?: string; // 条件分支 true/false（来自 n8n index 语义，可按需）
}

// n8n workflow 文档结构
export interface N8nWorkflow {
  id?: string;
  name: string;
  nodes: N8nNode[];
  connections: N8nConnections;
  settings?: Record<string, any>;
  active?: boolean;
}

// 执行结果（运行时每节点输出，供前端展示）
export interface RunExecutionResult {
  executionId: string;
  lastNodeExecuted?: string;
  data: Record<string, Array<{ json: Record<string, any> }>>;
  error?: { message: string };
}

// 节点执行上下文
export interface NodeExecutionContext {
  workflow: N8nWorkflow;
  executionId: string;
  inputData: Record<string, Array<{ json: Record<string, any> }>>;
  node: N8nNode;
  env: Env;
  log: (event: PushEvent) => void;
}

// 节点执行器接口
export interface NodeExecutor {
  execute(ctx: NodeExecutionContext): Promise<Record<string, Array<{ json: Record<string, any> }>>>;
}

// 受限求值结果
export interface EvalContext {
  json?: Record<string, any>; // 当前输入项
  env?: Record<string, any>;
  $now?: string;
}

// Push 事件（Durable Object 门面 / Runtime 向后端推送）
export type PushEvent =
  | { type: 'executionStarted'; executionId: string }
  | { type: 'executionWaiting'; executionId: string }
  | { type: 'nodeExecuteBefore'; executionId: string; nodeName: string }
  | { type: 'nodeExecuteAfter'; executionId: string; nodeName: string }
  // P1-4 可观测：节点执行抛错 → 前端据此将该节点标红（不再静默 success）
  | { type: 'nodeExecuteError'; executionId: string; nodeName: string; error: string }
  | { type: 'executionFinished'; executionId: string; data: RunExecutionResult }
  | { type: 'executionFailed'; executionId: string; error: string };

// Worker 环境绑定
export interface Env {
  DB: D1Database;
  CREDENTIALS: KVNamespace;
  FLOW_ENGINE: Workflow;
  PUSH: DurableObjectNamespace;
  ASSETS?: Fetcher; // Workers Static Assets（托管 n8n editor-ui dist）
  SESSION_SECRET?: string; // 会话令牌签名密钥（生产用 Workers Secret）
  ADMIN_PASSWORD?: string; // 登录密码（生产用 Workers Secret）
}

// Durable Object SSE 门面接口（供客户端调用）
export interface PushConnectionDO {
  subscribe(): Promise<Response>;
  close(): Promise<void>;
}

// 恢复相关
export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  factor?: number; // 指数退避基数
}

export interface Checkpoint {
  workflowId: string;
  executionId: string;
  completedNodes: string[]; // 已完成的节点名（按执行顺序）
  currentNode: string | null; // 正在执行的节点
  cursor?: Record<string, number>; // 分支游标（多出边时用）
  data?: Record<string, any>; // 已产生的中间输出
  updatedAt: string;
}

// 标准 JSON 响应形态（n8n REST 契约返回值包裹层）
export interface N8nRestResponse {
  code?: number;
  data: unknown;
  message?: string;
}