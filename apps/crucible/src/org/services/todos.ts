/**
 * Todo Service - Manages todos with IPFS storage.
 */

import type { Todo, TodoPriority, TodoStatus, OrgState } from '../types';
import type { OrgStorage } from './storage';

export interface CreateTodoParams {
  title: string;
  description?: string;
  priority?: TodoPriority;
  dueDate?: number;
  assigneeAgentId?: string;
  assigneeName?: string;
  tags?: string[];
  createdBy: string;
}

export interface UpdateTodoParams {
  title?: string;
  description?: string;
  priority?: TodoPriority;
  status?: TodoStatus;
  dueDate?: number | null;
  assigneeAgentId?: string;
  assigneeName?: string;
  tags?: string[];
}

export interface ListTodosParams {
  status?: TodoStatus;
  priority?: TodoPriority;
  assigneeAgentId?: string;
  tags?: string[];
  limit?: number;
}

export interface TodoStats {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  cancelled: number;
  overdue: number;
}

const PRIORITY_ORDER: Record<TodoPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

export class TodoService {
  constructor(private storage: OrgStorage) {}

  async create(state: OrgState, params: CreateTodoParams): Promise<{ todo: Todo; state: OrgState; cid: string }> {
    const todo: Todo = {
      id: crypto.randomUUID(),
      title: params.title,
      description: params.description,
      priority: params.priority ?? 'medium',
      status: 'pending',
      dueDate: params.dueDate,
      assigneeAgentId: params.assigneeAgentId,
      assigneeName: params.assigneeName,
      tags: params.tags ?? [],
      createdBy: params.createdBy,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const result = await this.storage.addTodo(state, todo);
    return { todo, ...result };
  }

  async update(state: OrgState, todoId: string, params: UpdateTodoParams): Promise<{ todo: Todo; state: OrgState; cid: string }> {
    if (!state.todos.find(t => t.id === todoId)) throw new Error(`Todo not found: ${todoId}`);

    const updates: Partial<Todo> = {};
    if (params.title !== undefined) updates.title = params.title;
    if (params.description !== undefined) updates.description = params.description;
    if (params.priority !== undefined) updates.priority = params.priority;
    if (params.status !== undefined) updates.status = params.status;
    if (params.dueDate !== undefined) updates.dueDate = params.dueDate ?? undefined;
    if (params.assigneeAgentId !== undefined) updates.assigneeAgentId = params.assigneeAgentId;
    if (params.assigneeName !== undefined) updates.assigneeName = params.assigneeName;
    if (params.tags !== undefined) updates.tags = params.tags;

    const result = await this.storage.updateTodo(state, todoId, updates);
    return { todo: result.state.todos.find(t => t.id === todoId)!, ...result };
  }

  async complete(state: OrgState, todoId: string): Promise<{ todo: Todo; state: OrgState; cid: string }> {
    const result = await this.storage.completeTodo(state, todoId);
    return { todo: result.state.todos.find(t => t.id === todoId)!, ...result };
  }

  list(state: OrgState, params: ListTodosParams = {}): { todos: Todo[]; total: number } {
    let todos = [...state.todos];

    if (params.status) todos = todos.filter(t => t.status === params.status);
    if (params.priority) todos = todos.filter(t => t.priority === params.priority);
    if (params.assigneeAgentId) todos = todos.filter(t => t.assigneeAgentId === params.assigneeAgentId);
    if (params.tags?.length) todos = todos.filter(t => params.tags!.some(tag => t.tags.includes(tag)));

    todos.sort((a, b) => {
      const pd = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (pd !== 0) return pd;
      if (a.dueDate && b.dueDate) return a.dueDate - b.dueDate;
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return b.createdAt - a.createdAt;
    });

    const total = todos.length;
    if (params.limit) todos = todos.slice(0, params.limit);
    return { todos, total };
  }

  getStats(state: OrgState): TodoStats {
    const now = Date.now();
    const todos = state.todos;
    return {
      total: todos.length,
      pending: todos.filter(t => t.status === 'pending').length,
      inProgress: todos.filter(t => t.status === 'in_progress').length,
      completed: todos.filter(t => t.status === 'completed').length,
      cancelled: todos.filter(t => t.status === 'cancelled').length,
      overdue: todos.filter(t => t.status !== 'completed' && t.status !== 'cancelled' && t.dueDate && t.dueDate < now).length,
    };
  }
}

export function createTodoService(storage: OrgStorage): TodoService {
  return new TodoService(storage);
}
