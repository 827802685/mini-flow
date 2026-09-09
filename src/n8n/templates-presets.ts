// templates-presets: 内置预设模板库存
// 当 n8n 模板市场(api.n8n.io)不可达时，前端模板页仍能展示一批离线预设，
// 且每项都带可导入的完整 workflow（nodes + connections），点击即能用。
// 结构尽量贴合 n8n 模板 API：categories / search 返回 {categories, count, templates: [...]}，
// 单模板返回 { workflow: { name, nodes, connections, id … } }。

export interface PresetTemplate {
  id: number;
  name: string;
  description: string;
  categories: string[];
  icon: string;
  workflow: {
    name: string;
    nodes: any[];
    connections: Record<string, any>;
    active?: boolean;
  };
}

// 构造连接线的工具：把一串节点名连成 main 主链
function chain(names: string[]): Record<string, any> {
  const conn: Record<string, any> = {};
  for (let i = 0; i < names.length - 1; i++) {
    conn[names[i]] = { main: [[{ node: names[i + 1] }]] };
  }
  return conn;
}

function trigNode(name: string, type: string, position: [number, number], parameters: any = {}) {
  return { parameters, id: 'n' + Math.random().toString(16).slice(2), name, type, typeVersion: 1, position };
}

export const PRESET_TEMPLATES: PresetTemplate[] = [
  {
    id: 100001, name: 'Webhook → HTTP 转发（入门）', description: '通过 Webhook 收到请求后调用外部 HTTP 接口，最基础的数据管线。', categories: ['串接'], icon: 'fa:globe',
    workflow: {
      name: 'Webhook 转发入站', active: false,
      nodes: [
        trigNode('Webhook', 'n8n-nodes-base.webhook', [0, 0], { httpMethod: 'POST', path: 'inbound' }),
        trigNode('HTTP Request', 'n8n-nodes-base.httpRequest', [240, 0], { method: 'POST', url: 'https://httpbin.org/post', jsonBody: '={{ $json }}' }),
        trigNode('Output', 'n8n-nodes-base.outputNode', [480, 0], {}),
      ],
      connections: chain(['Webhook', 'HTTP Request', 'Output']),
    },
  },
  {
    id: 100002, name: '定时 → 数据取回 → 字段处理', description: '每 5 分钟调用一次接口，把响应写入字段并交给后续处理。', categories: ['定时', '串接'], icon: 'fa:clock',
    workflow: {
      name: '定时抓取加工', active: false,
      nodes: [
        trigNode('定时 Cron', 'n8n-nodes-base.scheduleTrigger', [0, 0], { rule: 'interval', minutesInterval: 5 }),
        trigNode('HTTP Request', 'n8n-nodes-base.httpRequest', [260, 0], { method: 'GET', url: 'https://httpbin.org/anything' }),
        trigNode('Edit Fields', 'n8n-nodes-base.editFields', [520, 0], { fields: [{ name: 'fetchedAt', value: '' }] }),
        trigNode('Output', 'n8n-nodes-base.outputNode', [780, 0], {}),
      ],
      connections: chain(['定时 Cron', 'HTTP Request', 'Edit Fields', 'Output']),
    },
  },
  {
    id: 100003, name: 'IF 分支：数据分流', description: '演示用 IF 按字段值分流到两条输出支路。', categories: ['流控'], icon: 'fa:code-branch',
    workflow: {
      name: '条件分流', active: false,
      nodes: [
        trigNode('Manual Trigger', 'n8n-nodes-base.manualTrigger', [0, 0], {}),
        trigNode('IF', 'n8n-nodes-base.if', [240, 0], { conditionSt: '={{ json.score > 50 }}' }),
        trigNode('Output(通过)', 'n8n-nodes-base.outputNode', [480, 0], {}),
      ],
      connections: {
        'Manual Trigger': { main: [[{ node: 'IF' }]] },
        'IF': { main: [[{ node: 'Output(通过)' }], []] },
      },
    },
  },
  {
    id: 100004, name: '数据清洗：去重 + 排序 + 聚合', description: '过滤器→去重→排序→分组聚合，演示数据转换类节点组合。', categories: ['数据'], icon: 'fa:table',
    workflow: {
      name: '数据清洗流水线', active: false,
      nodes: [
        trigNode('Manual Trigger', 'n8n-nodes-base.manualTrigger', [0, 0], {}),
        trigNode('Remove Duplicates', 'n8n-nodes-base.removeDuplicates', [240, 0], {}),
        trigNode('Sort', 'n8n-nodes-base.sort', [480, 0], { rules: { rules: [{ field: 'amount', type: 'descending' }] } }),
        trigNode('Aggregate', 'n8n-nodes-base.aggregate', [720, 0], { fields: [{ field: 'dept', grouping: 1 }, { subFields: [{ field: 'amount', aggregation: 'sum' }] }] }),
        trigNode('Output', 'n8n-nodes-base.outputNode', [960, 0], {}),
      ],
      connections: chain(['Manual Trigger', 'Remove Duplicates', 'Sort', 'Aggregate', 'Output']),
    },
  },
];

// 已存在的顶层"workflow"预设：按 id 快速取一个可导入工作流
export function presetById(id: number): PresetTemplate | undefined {
  return PRESET_TEMPLATES.find((t) => t.id === id);
}

export function presetsToTemplatesResult(templates: PresetTemplate[], category?: string) {
  const cats = Array.from(new Set(templates.flatMap((t) => t.categories)));
  return {
    categories: ['全部', ...cats],
    count: templates.length,
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      categories: t.categories,
      icon: t.icon,
      workflow: t.workflow,
    })),
    category,
  };
}