// plugins/registry: 插件节点注册中心
// 所有节点通过"插件"注册进系统：既进入编辑器节点面板(/rest/node-types)，也可在执行时分派。
// 内置节点以插件形式注册（isCommunity=false），第三方/社区节点可动态 registerPlugin 扩展。
import type { NodePlugin, PluginNodeType } from './types';
import type { MiniNodeType } from '../n8n/node-types';
import type { NodeExecutor } from '../types';

let plugins: NodePlugin[] = [];

export function registerPlugin(p: NodePlugin): void {
  // 幂等：同 id 已注册则覆盖，避免重复 init 产生重复项
  const idx = plugins.findIndex((x) => x.id === p.id);
  if (idx >= 0) plugins[idx] = p;
  else plugins.push(p);
}

export function listPlugins(): Array<{ id: string; label: string; description: string; isCommunity: boolean; nodeCount: number }> {
  return plugins.map((p) => ({
    id: p.id,
    label: p.label,
    description: p.description,
    isCommunity: !!p.isCommunity,
    nodeCount: p.nodes.length,
  }));
}

// 全部节点的元数据（编辑器节点面板用），去掉 executor 字段以保证 JSON 干净
export function allNodeTypeDefs(): MiniNodeType[] {
  return plugins.flatMap((p) => p.nodes.map((n) => stripExecutor(n)));
}

// 单个节点执行器解析：优先命中"自带 executor 的插件节点"，否则返回 null（由内置 registry 兜底）
export function resolvePluginExecutor(nodeType: string): NodeExecutor | null {
  for (const p of plugins) {
    const n = p.nodes.find((x) => x.type === nodeType && x.executor);
    if (n?.executor) return n.executor;
  }
  return null;
}

// 按 type 精确查找节点定义
export function findNodeDef(type: string): PluginNodeType | undefined {
  for (const p of plugins) {
    const n = p.nodes.find((x) => x.type === type);
    if (n) return n;
  }
  return undefined;
}

export function resetPlugins(): void {
  plugins = [];
}

function stripExecutor(n: PluginNodeType): MiniNodeType {
  const { executor: _executor, ...meta } = n;
  return meta;
}