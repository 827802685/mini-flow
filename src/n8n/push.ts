// push: Worker 侧向 Durable Object 投递执行事件的辅助
// 前端通过 /push SSE 订阅；此处负责把 engine 产生的事件 POST 到 DO 广播。
import type { Env, PushEvent } from '../types';

// names: 每个执行可绑定到固定 id 以区分；骨架用单一 'main' 通道
const ROUTE = 'main';

export async function sendPush(env: Env, event: PushEvent): Promise<void> {
  try {
    const id = env.PUSH.idFromName(ROUTE);
    const stub = env.PUSH.get(id);
    await stub.fetch('https://do/push', { method: 'POST', body: JSON.stringify(event) });
  } catch {
    // push 失败不影响主流程：前端回落 REST 轮询
  }
}