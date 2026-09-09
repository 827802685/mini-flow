// plugins: 插件子系统统一入口
// import 本模块即会注册所有内置插件(builtin)，随后可读取完整节点目录与执行器。
import './builtin'; // 副作用：注册 n8n-nodes-base 内置插件

export * from './types';
export * from './registry';