/**
 * Org Management Agent
 * 
 * Decentralized organization management using CQL database and DEX cache
 */

import { CQLClient } from '@jejunetwork/db';
import type { OrgTodo, OrgCheckinSchedule, OrgCheckinResponse, OrgTeamMember } from '../types';
import { createLogger, type Logger } from '../sdk/logger';

interface TodoRow {
  id: string;
  org_id: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  assignee_agent_id: string | null;
  created_by: string;
  due_date: number | null;
  tags: string;
  created_at: number;
  updated_at: number;
}

export interface OrgAgentConfig {
  agentId: bigint;
  orgId: string;
  cqlClient: CQLClient;
  cqlDatabaseId: string;
  dexCacheUrl?: string;
  logger?: Logger;
}

export class OrgAgent {
  private config: OrgAgentConfig;
  private log: Logger;
  private cqlClient: CQLClient;

  constructor(config: OrgAgentConfig) {
    this.config = config;
    this.log = config.logger ?? createLogger(`OrgAgent:${config.orgId}`);
    this.cqlClient = config.cqlClient;
  }

  async initialize(): Promise<void> {
    this.log.info('Initializing org agent', { orgId: this.config.orgId, agentId: this.config.agentId.toString() });
    
    // Ensure database schema exists
    await this.ensureSchema();
    this.log.info('Org agent initialized');
  }

  private async ensureSchema(): Promise<void> {
    const schema = `
      CREATE TABLE IF NOT EXISTS org_todos (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        priority TEXT NOT NULL,
        status TEXT NOT NULL,
        assignee_agent_id TEXT,
        created_by TEXT NOT NULL,
        due_date INTEGER,
        tags TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS org_checkin_schedules (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        room_id TEXT,
        name TEXT NOT NULL,
        checkin_type TEXT NOT NULL,
        frequency TEXT NOT NULL,
        time_utc TEXT NOT NULL,
        questions TEXT,
        active INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS org_checkin_responses (
        id TEXT PRIMARY KEY,
        schedule_id TEXT NOT NULL,
        responder_agent_id TEXT NOT NULL,
        answers TEXT NOT NULL,
        submitted_at INTEGER NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS org_team_members (
        agent_id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        role TEXT NOT NULL,
        joined_at INTEGER NOT NULL,
        last_active_at INTEGER NOT NULL,
        todos_completed INTEGER DEFAULT 0,
        checkins_completed INTEGER DEFAULT 0,
        contributions INTEGER DEFAULT 0
      );
      
      CREATE INDEX IF NOT EXISTS idx_todos_org_id ON org_todos(org_id);
      CREATE INDEX IF NOT EXISTS idx_todos_status ON org_todos(status);
      CREATE INDEX IF NOT EXISTS idx_todos_assignee ON org_todos(assignee_agent_id);
      CREATE INDEX IF NOT EXISTS idx_checkins_org_id ON org_checkin_schedules(org_id);
      CREATE INDEX IF NOT EXISTS idx_responses_schedule ON org_checkin_responses(schedule_id);
      CREATE INDEX IF NOT EXISTS idx_members_org_id ON org_team_members(org_id);
    `;

    await this.cqlClient.exec(schema, [], this.config.cqlDatabaseId);
  }

  async createTodo(params: {
    title: string;
    description?: string;
    priority?: 'low' | 'medium' | 'high';
    assigneeAgentId?: string;
    dueDate?: number;
    tags?: string[];
    createdBy: string;
  }): Promise<OrgTodo> {
    const todo: OrgTodo = {
      id: crypto.randomUUID(),
      orgId: this.config.orgId,
      title: params.title,
      description: params.description,
      priority: params.priority ?? 'medium',
      status: 'pending',
      assigneeAgentId: params.assigneeAgentId,
      createdBy: params.createdBy,
      dueDate: params.dueDate,
      tags: params.tags ?? [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await this.cqlClient.exec(
      `INSERT INTO org_todos (id, org_id, title, description, priority, status, assignee_agent_id, created_by, due_date, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        todo.id,
        todo.orgId,
        todo.title,
        todo.description ?? null,
        todo.priority,
        todo.status,
        todo.assigneeAgentId ?? null,
        todo.createdBy,
        todo.dueDate ?? null,
        JSON.stringify(todo.tags),
        todo.createdAt,
        todo.updatedAt,
      ],
      this.config.cqlDatabaseId
    );

    this.log.info('Todo created', { todoId: todo.id, orgId: this.config.orgId });
    return todo;
  }

  async listTodos(params: {
    status?: 'pending' | 'in_progress' | 'completed' | 'cancelled';
    priority?: 'low' | 'medium' | 'high';
    assigneeAgentId?: string;
    limit?: number;
  } = {}): Promise<{ todos: OrgTodo[]; total: number }> {
    const conditions: string[] = ['org_id = ?'];
    const queryParams: unknown[] = [this.config.orgId];

    if (params.status) {
      conditions.push('status = ?');
      queryParams.push(params.status);
    }
    if (params.priority) {
      conditions.push('priority = ?');
      queryParams.push(params.priority);
    }
    if (params.assigneeAgentId) {
      conditions.push('assignee_agent_id = ?');
      queryParams.push(params.assigneeAgentId);
    }

    const whereClause = conditions.join(' AND ');
    const limitClause = params.limit ? ` LIMIT ${params.limit}` : '';

    const [result, countResult] = await Promise.all([
      this.cqlClient.query<TodoRow>(
        `SELECT * FROM org_todos WHERE ${whereClause} ORDER BY created_at DESC${limitClause}`,
        queryParams,
        this.config.cqlDatabaseId
      ),
      this.cqlClient.query<{ count: number }>(
        `SELECT COUNT(*) as count FROM org_todos WHERE ${whereClause}`,
        queryParams,
        this.config.cqlDatabaseId
      ),
    ]);

    return {
      todos: result.rows.map(row => this.mapTodoRow(row)),
      total: countResult.rows[0]?.count ?? 0,
    };
  }

  private mapTodoRow(row: TodoRow): OrgTodo {
    let tags: string[] = [];
    try {
      tags = JSON.parse(row.tags || '[]') as string[];
    } catch {
      this.log.warn('Failed to parse tags JSON', { todoId: row.id, tags: row.tags });
      tags = [];
    }

    return {
      id: row.id,
      orgId: row.org_id,
      title: row.title,
      description: row.description ?? undefined,
      priority: row.priority as 'low' | 'medium' | 'high',
      status: row.status as 'pending' | 'in_progress' | 'completed' | 'cancelled',
      assigneeAgentId: row.assignee_agent_id ?? undefined,
      createdBy: row.created_by,
      dueDate: row.due_date ?? undefined,
      tags,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async updateTodo(todoId: string, updates: {
    title?: string;
    description?: string;
    priority?: 'low' | 'medium' | 'high';
    status?: 'pending' | 'in_progress' | 'completed' | 'cancelled';
    assigneeAgentId?: string;
    dueDate?: number | null;
    tags?: string[];
  }): Promise<OrgTodo> {
    const fields: Array<[string, unknown]> = [
      ['title', updates.title],
      ['description', updates.description],
      ['priority', updates.priority],
      ['status', updates.status],
      ['assignee_agent_id', updates.assigneeAgentId],
      ['due_date', updates.dueDate],
      ['tags', updates.tags !== undefined ? JSON.stringify(updates.tags) : undefined],
    ];

    const setClauses: string[] = [];
    const values: unknown[] = [];

    for (const [field, value] of fields) {
      if (value !== undefined) {
        setClauses.push(`${field} = ?`);
        values.push(value);
      }
    }

    if (setClauses.length === 0) {
      throw new Error('No updates provided');
    }

    setClauses.push('updated_at = ?');
    values.push(Date.now(), todoId, this.config.orgId);

    await this.cqlClient.exec(
      `UPDATE org_todos SET ${setClauses.join(', ')} WHERE id = ? AND org_id = ?`,
      values,
      this.config.cqlDatabaseId
    );

    const result = await this.cqlClient.query<TodoRow>(
      'SELECT * FROM org_todos WHERE id = ? AND org_id = ?',
      [todoId, this.config.orgId],
      this.config.cqlDatabaseId
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error(`Todo not found: ${todoId}`);
    }

    return this.mapTodoRow(row);
  }

  async createCheckinSchedule(params: {
    roomId?: string;
    name: string;
    checkinType: 'standup' | 'retrospective' | 'checkin';
    frequency: 'daily' | 'weekdays' | 'weekly' | 'monthly';
    timeUtc: string;
    questions: string[];
  }): Promise<OrgCheckinSchedule> {
    const schedule: OrgCheckinSchedule = {
      id: crypto.randomUUID(),
      orgId: this.config.orgId,
      roomId: params.roomId,
      name: params.name,
      checkinType: params.checkinType,
      frequency: params.frequency,
      timeUtc: params.timeUtc,
      questions: params.questions,
      active: true,
      createdAt: Date.now(),
    };

    await this.cqlClient.exec(
      `INSERT INTO org_checkin_schedules (id, org_id, room_id, name, checkin_type, frequency, time_utc, questions, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        schedule.id,
        schedule.orgId,
        schedule.roomId ?? null,
        schedule.name,
        schedule.checkinType,
        schedule.frequency,
        schedule.timeUtc,
        JSON.stringify(schedule.questions),
        schedule.active ? 1 : 0,
        schedule.createdAt,
      ],
      this.config.cqlDatabaseId
    );

    this.log.info('Checkin schedule created', { scheduleId: schedule.id });
    return schedule;
  }

  async recordCheckinResponse(params: {
    scheduleId: string;
    responderAgentId: string;
    answers: Record<string, string>;
  }): Promise<OrgCheckinResponse> {
    const response: OrgCheckinResponse = {
      id: crypto.randomUUID(),
      scheduleId: params.scheduleId,
      responderAgentId: params.responderAgentId,
      answers: params.answers,
      submittedAt: Date.now(),
    };

    await this.cqlClient.exec(
      `INSERT INTO org_checkin_responses (id, schedule_id, responder_agent_id, answers, submitted_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        response.id,
        response.scheduleId,
        response.responderAgentId,
        JSON.stringify(response.answers),
        response.submittedAt,
      ],
      this.config.cqlDatabaseId
    );

    // Update team member stats
    await this.cqlClient.exec(
      `UPDATE org_team_members 
       SET checkins_completed = checkins_completed + 1, last_active_at = ?
       WHERE agent_id = ? AND org_id = ?`,
      [Date.now(), params.responderAgentId, this.config.orgId],
      this.config.cqlDatabaseId
    );

    this.log.info('Checkin response recorded', { responseId: response.id });
    return response;
  }

  async getTeamMembers(): Promise<OrgTeamMember[]> {
    const result = await this.cqlClient.query<{
      agent_id: string;
      org_id: string;
      role: string;
      joined_at: number;
      last_active_at: number;
      todos_completed: number;
      checkins_completed: number;
      contributions: number;
    }>(
      'SELECT * FROM org_team_members WHERE org_id = ? ORDER BY last_active_at DESC',
      [this.config.orgId],
      this.config.cqlDatabaseId
    );

    return result.rows.map(row => ({
      agentId: row.agent_id,
      orgId: row.org_id,
      role: row.role,
      joinedAt: row.joined_at,
      lastActiveAt: row.last_active_at,
      stats: {
        todosCompleted: row.todos_completed,
        checkinsCompleted: row.checkins_completed,
        contributions: row.contributions,
      },
    }));
  }

  async addTeamMember(agentId: string, role: string): Promise<void> {
    await this.cqlClient.exec(
      `INSERT OR REPLACE INTO org_team_members (agent_id, org_id, role, joined_at, last_active_at, todos_completed, checkins_completed, contributions)
       VALUES (?, ?, ?, ?, ?, 0, 0, 0)`,
      [agentId, this.config.orgId, role, Date.now(), Date.now()],
      this.config.cqlDatabaseId
    );

    this.log.info('Team member added', { agentId, orgId: this.config.orgId });
  }
}

