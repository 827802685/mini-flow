// scripts/gen-nodes-json.ts
// 从插件节点注册中心生成前端静态目录 types/nodes.json 与 types/node-versions.json。
// n8n editor-ui 用 /types/nodes.json 构建画布的节点注册表：
//   节点图标(icon)、defaults.name/color、编辑面板 NDV 的 properties 都来自它。
// 只要该文件与 builtin.ts 不同步，自定义节点(telegram/weCom/translate…)就会显示成
// "?" 图标并且无法打开参数编辑面板。本脚本保证两处同源。
//
// 注意：n8n 约定 INodeTypeDescription.name === 完整 type（如 n8n-nodes-base.httpRequest），
// 前端 nodeTypes store 按 name 建索引、getNodeType(node.type) 查询。def() 已强制 name=type。
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allNodeTypeDefs } from '../src/plugins';

const __dirname = dirname(fileURLToPath(import.meta.url));
const typesDir = resolve(__dirname, '../frontend/dist/types');
const outFile = resolve(__dirname, '../frontend/dist/types/nodes.json');
const versionsFile = resolve(__dirname, '../frontend/dist/types/node-versions.json');

const defs = allNodeTypeDefs();
const json = JSON.stringify(defs, null, 2);

mkdirSync(typesDir, { recursive: true });
writeFileSync(outFile, json + '\n', 'utf8');

// node-versions.json：{ <type>: [version,...] }，供 DataWorker 后台解析节点版本。
const versions: Record<string, number[]> = {};
for (const d of defs) {
  const vs = (Array.isArray(d.version) ? d.version : [d.version]).map(Number);
  versions[d.type] = vs.length ? vs : [d.typeVersion ?? 1];
}
writeFileSync(versionsFile, JSON.stringify(versions, null, 2) + '\n', 'utf8');

console.log(`[gen-nodes-json] wrote ${defs.length} node definitions -> ${outFile}`);
console.log(`[gen-nodes-json] wrote ${Object.keys(versions).length} node versions -> ${versionsFile}`);