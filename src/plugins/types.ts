// plugins/types: 插件化节点系统类型定义
// 目标：把"节点元数据(编辑器面板渲染)"与"执行逻辑"打包成可插拔的插件单元。
// - MiniNodeType 来自 node-types.ts（n8n 前端面板渲染所需字段）。
// - PluginNodeType 在元数据基础上附加可选的 execute 实现（如无则按内置 registry 兜底/透传）。
import type { MiniNodeType } from '../n8n/node-types';
import type { NodeExecutor } from '../types';

export interface PluginNodeType extends MiniNodeType {
  // 节点自带的执行逻辑；缺省时由运行时按 type 匹配内置 registry 或透传。
  executor?: NodeExecutor;
}

export interface NodePlugin {
  // 插件唯一 id，如 "n8n-nodes-base" / "n8n-nodes.community.puppeteer"
  id: string;
  label: string;
  description: string;
  // 是否社区插件（编辑器分类 <community>）；内置为 false
  isCommunity?: boolean;
  // 该插件贡献的节点集合
  nodes: PluginNodeType[];
}