/**
 * Shared type definitions for the ElizaOS Game Application
 */

// Import types from core
import type { KnowledgeItem } from '@elizaos/core';

// Common interfaces
export interface BaseMessage {
  id: string;
  content: string;
  timestamp: Date | string;
  metadata: Record<string, unknown>;
}

export interface TauriEvent<T = Record<string, unknown>> {
  payload: T;
}

export interface TauriWindow {
  __TAURI_INTERNALS__?: {
    invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
    listen: (event: string, callback: (event: TauriEvent) => void) => Promise<() => void>;
  };
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// WebSocket message types
export interface WebSocketMessage {
  type: string;
  data?: Record<string, unknown>;
  message?: {
    id?: string;
    content?: string;
    text?: string;
    userId?: string;
    author?: string;
    name?: string;
    timestamp?: string | Date;
    metadata?: Record<string, unknown>;
  };
}

// Configuration types
export interface ConfigurationValue {
  key: string;
  value: string | number | boolean;
  type: 'string' | 'number' | 'boolean' | 'url' | 'api_key';
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  sanitizedValue?: string | number | boolean;
}

// Agent and Runtime types
export interface AgentConfiguration {
  name: string;
  settings: Record<string, ConfigurationValue>;
  plugins: string[];
  capabilities: Record<string, boolean>;
}

export interface RuntimeSettings {
  [key: string]: string | number | boolean | Record<string, unknown>;
}

// Error types
export interface AppError extends Error {
  code?: string;
  details?: Record<string, unknown>;
}

// Log entry types
export interface LogEntry {
  timestamp: string | Date;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

// HTTP Request/Response types
export interface HttpRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: string | FormData | Record<string, unknown>;
  timeout?: number;
}

export interface HttpResponse<T = unknown> {
  ok: boolean;
  status: number;
  statusText: string;
  data?: T;
  error?: string;
}

// Provider and Model types
export interface ModelProvider {
  name: string;
  displayName: string;
  status: 'available' | 'not_configured' | 'error';
  message: string;
  models?: string[];
}

export interface ModelInfo {
  name: string;
  description: string;
  provider: string;
  capabilities: string[];
}

// Memory and Knowledge types - Extended from @elizaos/core
export interface MemoryEntry {
  id: string;
  type: 'knowledge' | 'conversation' | 'goal' | 'user' | 'relationship';
  content: string | Record<string, unknown>;
  createdAt: Date | string;
  updatedAt?: Date | string;
  importance?: number;
  entityId?: string;
  agentId?: string;
  userId?: string;
  metadata: Record<string, unknown>;
}

// Re-export unified knowledge types from core
export type {
  KnowledgeItem,
  DocumentMetadata,
  IKnowledgeService,
  KnowledgeScope,
  DirectoryItem,
} from '@elizaos/core';

// Goal and Todo types
export interface Goal {
  id: string;
  name: string;
  description: string;
  isCompleted: boolean;
  createdAt: string | Date;
  metadata?: Record<string, unknown>;
}

export interface Todo {
  id: string;
  name: string;
  title?: string;
  description?: string;
  type: 'daily' | 'one-off' | 'aspirational';
  isCompleted: boolean;
  priority?: number;
  createdAt: string | Date;
  dueDate?: string | Date;
  metadata?: Record<string, unknown>;
}

// Capability and Status types
export interface CapabilityStatus {
  enabled: boolean;
  status: 'active' | 'inactive' | 'error';
  error?: string;
  lastUsed?: string | Date;
  metadata: Record<string, unknown>;
}

export interface AgentStatus {
  name: string;
  status: 'online' | 'offline' | 'thinking';
  lastThought?: string;
  lastAction?: string;
  currentGoal?: string;
  uptime?: number;
  metadata: Record<string, unknown>;
}

// File and Upload types
export interface FileUpload {
  name: string;
  type: string;
  size: number;
  content: string | ArrayBuffer;
  lastModified?: number;
}

// Use unified knowledge item type for knowledge files
export type KnowledgeFile = KnowledgeItem;

// Backup types
export interface BackupInfo {
  id: string;
  timestamp: string | Date;
  backup_type: 'manual' | 'automatic' | 'shutdown';
  size_bytes: number;
  components: BackupComponent[];
  metadata: BackupMetadata;
}

export interface BackupComponent {
  name: string;
  component_type: string;
  size_bytes: number;
}

export interface BackupMetadata {
  agent_name: string;
  eliza_version: string;
  notes?: string;
  [key: string]: unknown;
}

export interface RestoreOptions {
  restore_database: boolean;
  restore_agent_state: boolean;
  restore_knowledge: boolean;
  restore_logs: boolean;
  force: boolean;
}

// Container and System types
export interface ContainerInfo {
  name: string;
  status: 'running' | 'stopped' | 'error';
  uptime?: number;
  logs: LogEntry[];
}

export interface SystemInfo {
  platform: string;
  arch: string;
  version: string;
  memory: {
    total: number;
    available: number;
    used: number;
  };
}

// Event callback types
export type EventCallback<T = Record<string, unknown>> = (data: T) => void;
export type UnsubscribeFunction = () => void;

// API Response types for Tauri
export interface TauriApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface HealthCheckResponse {
  status: 'healthy' | 'unhealthy';
  database: boolean;
  services: Record<string, boolean>;
}

export interface ValidationResponse {
  valid: boolean;
  errors: string[];
}

export interface TestConfigurationResponse {
  success: boolean;
  results: Record<string, unknown>;
}

export interface AutonomyStatusResponse {
  enabled: boolean;
  running: boolean;
  interval: number;
}

export interface CapabilityStatusResponse {
  enabled: boolean;
  service_available: boolean;
}

export interface AgentInfoResponse {
  id: string;
  name: string;
  version: string;
}

export interface DatabaseStatsResponse {
  connections: number;
  queries: number;
  uptime: number;
}

export interface PluginRoutesResponse {
  routes: Array<{
    name: string;
    path: string;
    display_name?: string;
  }>;
}

export interface TabContentResponse {
  content: string;
}

export interface OllamaModelStatus {
  models_ready: boolean;
  missing_models: string[];
  downloading: string | null;
  progress: number | null;
}

// Additional response types for TauriService
export interface TauriMemoryResponse {
  success: boolean;
  data?: {
    memories?: MemoryEntry[];
    goals?: Goal[];
    todos?: Todo[];
    files?: KnowledgeFile[];
    plugins?: Record<string, unknown>[];
    logs?: LogEntry[];
    tables?: string[];
    routes?: Array<{ name: string; path: string; display_name?: string }>;
    content?: string;
    [key: string]: unknown;
  };
  memories?: MemoryEntry[];
}

export interface TauriStringResponse {
  success: boolean;
  data?: string;
}

export interface TauriSettingsResponse {
  success: boolean;
  data?: Record<string, unknown>;
}
