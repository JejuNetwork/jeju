/**
 * Org MCP Server - MCP server exposing org tools for AI agents.
 */

import { z } from 'zod';
import type { OrgState, OrgConfig, MCPContext } from './types';
import { createOrgStorage } from './services/storage';
import { createTodoService } from './services/todos';
import { createCheckinService } from './services/checkins';

const config: OrgConfig = {
  rpcUrl: process.env.RPC_URL ?? 'http://127.0.0.1:8545',
  contracts: {
    roomRegistry: (process.env.ROOM_REGISTRY_ADDRESS ?? '0x0') as `0x${string}`,
    identityRegistry: (process.env.IDENTITY_REGISTRY_ADDRESS ?? '0x0') as `0x${string}`,
  },
  services: {
    storageApi: process.env.STORAGE_API_URL ?? 'http://127.0.0.1:3100',
    ipfsGateway: process.env.IPFS_GATEWAY ?? 'http://127.0.0.1:3100',
    crucibleApi: process.env.CRUCIBLE_API_URL ?? 'http://127.0.0.1:4020',
  },
  network: (process.env.NETWORK as 'localnet' | 'testnet' | 'mainnet') ?? 'localnet',
};

const storage = createOrgStorage({
  apiUrl: config.services.storageApi,
  ipfsGateway: config.services.ipfsGateway,
});

const todoService = createTodoService(storage);
const checkinService = createCheckinService(storage);

const stateCache = new Map<string, OrgState>();

async function getState(orgId: string): Promise<OrgState> {
  let state = stateCache.get(orgId);
  if (!state) {
    state = storage.createInitialState(orgId);
    stateCache.set(orgId, state);
  }
  return state;
}

const CreateTodoSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  dueDate: z.number().optional(),
  assigneeAgentId: z.string().optional(),
  assigneeName: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const UpdateTodoSchema = z.object({
  todoId: z.string().uuid(),
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  dueDate: z.number().optional().nullable(),
  tags: z.array(z.string()).optional(),
});

const ListTodosSchema = z.object({
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  limit: z.number().int().min(1).max(100).optional().default(20),
});

const CreateCheckinScheduleSchema = z.object({
  roomId: z.string(),
  name: z.string().min(1).max(200),
  checkinType: z.enum(['standup', 'sprint', 'mental_health', 'project_status', 'retrospective']).optional(),
  frequency: z.enum(['daily', 'weekdays', 'weekly', 'bi_weekly', 'monthly']).optional(),
  timeUtc: z.string().regex(/^\d{2}:\d{2}$/),
  questions: z.array(z.string()).optional(),
});

const RecordCheckinResponseSchema = z.object({
  scheduleId: z.string().uuid(),
  responderAgentId: z.string(),
  responderName: z.string().optional(),
  answers: z.record(z.string(), z.string()),
});

const GenerateReportSchema = z.object({
  scheduleId: z.string().uuid(),
  start: z.number(),
  end: z.number(),
});

async function handleCreateTodo(params: z.infer<typeof CreateTodoSchema>, context: MCPContext) {
  const state = await getState(context.orgId);
  const { todo, state: newState } = await todoService.create(state, {
    ...params,
    createdBy: context.agentId ?? 'mcp',
  });
  stateCache.set(context.orgId, newState);
  return { success: true, todo };
}

async function handleUpdateTodo(params: z.infer<typeof UpdateTodoSchema>, context: MCPContext) {
  const state = await getState(context.orgId);
  const { todo, state: newState } = await todoService.update(state, params.todoId, params);
  stateCache.set(context.orgId, newState);
  return { success: true, todo };
}

async function handleListTodos(params: z.infer<typeof ListTodosSchema>, context: MCPContext) {
  const state = await getState(context.orgId);
  const { todos, total } = todoService.list(state, params);
  return { success: true, todos, total };
}

async function handleCompleteTodo(params: { todoId: string }, context: MCPContext) {
  const state = await getState(context.orgId);
  const { todo, state: newState } = await todoService.complete(state, params.todoId);
  stateCache.set(context.orgId, newState);
  return { success: true, todo };
}

async function handleGetTodoStats(_params: Record<string, never>, context: MCPContext) {
  const state = await getState(context.orgId);
  const stats = todoService.getStats(state);
  return { success: true, stats };
}

async function handleCreateCheckinSchedule(params: z.infer<typeof CreateCheckinScheduleSchema>, context: MCPContext) {
  const state = await getState(context.orgId);
  const { schedule, state: newState } = await checkinService.createSchedule(state, {
    ...params,
    createdBy: context.agentId ?? 'mcp',
  });
  stateCache.set(context.orgId, newState);
  return { success: true, schedule };
}

async function handleListCheckinSchedules(params: { roomId?: string }, context: MCPContext) {
  const state = await getState(context.orgId);
  const schedules = checkinService.listSchedules(state, params.roomId);
  return { success: true, schedules };
}

async function handleRecordCheckinResponse(params: z.infer<typeof RecordCheckinResponseSchema>, context: MCPContext) {
  const state = await getState(context.orgId);
  const { response, state: newState } = await checkinService.recordResponse(state, params);
  stateCache.set(context.orgId, newState);
  return { success: true, response };
}

async function handleGenerateReport(params: z.infer<typeof GenerateReportSchema>, context: MCPContext) {
  const state = await getState(context.orgId);
  const report = checkinService.generateReport(state, params.scheduleId, {
    start: params.start,
    end: params.end,
  });
  return { success: true, report };
}

export const orgMcpServer = {
  name: 'org-tools',
  version: '1.0.0',
  description: 'Decentralized organization management tools for todos, check-ins, and team coordination',

  tools: [
    { name: 'create_todo', description: 'Create a new todo item', inputSchema: CreateTodoSchema, handler: handleCreateTodo },
    { name: 'update_todo', description: 'Update an existing todo', inputSchema: UpdateTodoSchema, handler: handleUpdateTodo },
    { name: 'list_todos', description: 'List todos with filters', inputSchema: ListTodosSchema, handler: handleListTodos },
    { name: 'complete_todo', description: 'Mark a todo as completed', inputSchema: z.object({ todoId: z.string().uuid() }), handler: handleCompleteTodo },
    { name: 'get_todo_stats', description: 'Get todo statistics', inputSchema: z.object({}), handler: handleGetTodoStats },
    { name: 'create_checkin_schedule', description: 'Create a check-in schedule', inputSchema: CreateCheckinScheduleSchema, handler: handleCreateCheckinSchedule },
    { name: 'list_checkin_schedules', description: 'List check-in schedules', inputSchema: z.object({ roomId: z.string().optional() }), handler: handleListCheckinSchedules },
    { name: 'record_checkin_response', description: 'Record a check-in response', inputSchema: RecordCheckinResponseSchema, handler: handleRecordCheckinResponse },
    { name: 'generate_report', description: 'Generate a check-in report', inputSchema: GenerateReportSchema, handler: handleGenerateReport },
  ],
};

export default orgMcpServer;
