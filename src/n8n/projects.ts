// projects: n8n 项目（Projects）相关 REST
// mini-flow 单用户：始终返回一个 “Personal” 个人项目。
import { Hono } from 'hono';
import type { Env } from '../types';

const PERSONAL_PROJECT = {
  id: 'personal',
  name: 'Personal',
  type: 'personal',
  icon: null as string | null,
  description: '',
  relations: [],
  scopes: [
    'project:read', 'project:update', 'project:delete',
    'workflow:create', 'workflow:read', 'workflow:update', 'workflow:delete',
    'workflow:list', 'workflow:move', 'workflow:execute',
    'workflow:share', 'workflow:move', 'workflow:activate',
    'credential:create', 'credential:read', 'credential:update', 'credential:delete', 'credential:list',
    'folder:create', 'folder:read', 'folder:update', 'folder:delete',
  ],
};

export const projectRoutes = new Hono<{ Bindings: Env }>()
  // 全部项目
  .get('/', (c) => c.json({ data: [PERSONAL_PROJECT] }))
  // 我成员的项目
  .get('/my-projects', (c) => c.json({ data: [PERSONAL_PROJECT] }))
  // 个人项目
  .get('/personal', (c) => c.json({ data: PERSONAL_PROJECT }))
  // 项目计数：n8n 前端按 {personal, team, public} 读取
  .get('/count', (c) => c.json({ data: { personal: 1, team: 0, public: 0 } }))
  // 单个项目
  .get('/:id', (c) => c.json({ data: PERSONAL_PROJECT }));