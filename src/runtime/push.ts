// push: Durable Object —— n8n 前端 Push 协议门面
// n8n 前端通过 SSE/WebSocket 获取执行进度。Workers 不支持原生 WebSocket 长连接，
// 此 DO 用 SSE(EventSource) 端点对外提供实时事件；N8N Push 客户端连不上 WebSocket 时
// 回落 REST /rest/executions/:id 轮询（由 executions 路由兜底）。
import { DurableObject } from 'cloudflare:workers';
import type { Env, PushEvent } from '../types';

interface Subscriber {
  controller: ReadableStreamDefaultController<Uint8Array>;
  queue: PushEvent[];
}

export class PushConnection extends DurableObject<Env> {
  private subscribers = new Map<string, Subscriber>();

  // HTTP 端点：GET /push 建立 SSE 流；由 Worker 路由转发至本 DO（经 get idFromName）
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/push')) {
      return this.openSse();
    }
    // POST 事件投递（Worker 内部调用 runtime 用）
    if (request.method === 'POST') {
      const body = (await request.json()) as PushEvent;
      this.broadcast(body);
      return new Response('ok');
    }
    return new Response('not found', { status: 404 });
  }

  private async openSse(): Promise<Response> {
    const id = crypto.randomUUID();
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.subscribers.set(id, { controller, queue: [] });
        // 初始握手：字符集冒号注释保持连接
        controller.enqueue(encoder.encode(': connected\n\n'));
        // 放行排队中的事件
        const sub = this.subscribers.get(id)!;
        sub.controller.enqueue(encoder.encode('event: connected\ndata: {}\n\n'));
        sub.queue.forEach((e) => this.writeEvent(encoder, sub, e));
        sub.queue.length = 0;
      },
      cancel: () => {
        this.subscribers.delete(id);
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  private writeEvent(encoder: TextEncoder, sub: Subscriber, e: PushEvent) {
    try {
      sub.controller.enqueue(encoder.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
    } catch {
      // 客户端断开，忽略
    }
  }

  // Durable Object 内部：Worker 侧调用 push(event)
  async push(event: PushEvent): Promise<void> {
    this.broadcast(event);
  }

  private broadcast(event: PushEvent) {
    const encoder = new TextEncoder();
    for (const sub of this.subscribers.values()) {
      // 尚未 start 完成时排队
      this.writeEvent(encoder, sub, event);
    }
  }

  async close(): Promise<void> {
    const encoder = new TextEncoder();
    for (const sub of this.subscribers.values()) {
      sub.controller.enqueue(encoder.encode('event: disconnected\ndata: {}\n\n'));
      sub.controller.close();
    }
    this.subscribers.clear();
  }
}