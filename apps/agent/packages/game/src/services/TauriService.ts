/**
 * TauriService - Comprehensive Tauri IPC service
 * Replaces all WebSocket/API client usage with native Tauri IPC
 */

// Type-only imports to avoid runtime issues with optional dependencies
type DialogSaveOptions = {
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
};

type DialogOpenOptions = {
  multiple?: boolean;
  filters?: Array<{ name: string; extensions: string[] }>;
};

type TauriDialogAPI = {
  save: (options?: DialogSaveOptions) => Promise<string | null>;
  open: (options?: DialogOpenOptions) => Promise<string | string[] | null>;
};

import { v4 as uuidv4 } from 'uuid';
import {
  TauriEvent,
  UnsubscribeFunction,
  ValidationResponse,
  TestConfigurationResponse,
  OllamaModelStatus as SharedOllamaModelStatus,
  TauriMemoryResponse,
  TauriSettingsResponse,
  KnowledgeItem,
  HealthCheckResponse,
} from '../types/shared';
import {
  extractMemoriesFromResponse,
  extractLogsFromResponse,
  convertToRecordArray,
} from '../types/tauri-utils';

export interface TauriMessage {
  id: string;
  content: string;
  type: 'user' | 'agent' | 'system' | 'error';
  authorId: string;
  authorName: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface TauriGoal {
  id: string;
  text: string;
  completed: boolean;
  createdAt: string;
}

export interface TauriTodo {
  id: string;
  title: string;
  description?: string;
  completed: boolean;
  dueDate?: string;
  priority?: 'low' | 'medium' | 'high';
  createdAt: string;
}

export interface TauriAgentStatus {
  name: string;
  status: 'online' | 'offline' | 'thinking';
  lastThought?: string;
  lastAction?: string;
  currentGoal?: string;
}

// Use unified knowledge item type instead of local interface
export type TauriKnowledgeFile = KnowledgeItem;

export interface StartupStatus {
  phase: string;
  message: string;
  progress?: number;
  isComplete?: boolean;
  error?: string;
}

export interface ContainerStatus {
  containerRunning: boolean;
  agentHealthy: boolean;
  ollamaHealthy: boolean;
  logs: string[];
}

export interface ContainerLog {
  timestamp: Date;
  service: string;
  message: string;
  level?: 'info' | 'warn' | 'error';
}

export interface CapabilityStatus {
  enabled: boolean;
  status?: 'active' | 'inactive' | 'error';
  error?: string;
  lastUsed?: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryQuery {
  type?: 'knowledge' | 'conversation' | 'goal' | 'user' | 'relationship';
  limit?: number;
  offset?: number;
  orderBy?: 'createdAt' | 'importance';
  orderDirection?: 'asc' | 'desc';
}

export interface MemoryResult {
  id: string;
  type: string;
  content: string;
  createdAt: Date;
  importance?: number;
  metadata?: Record<string, unknown>;
}

export type OllamaModelStatus = SharedOllamaModelStatus;

export interface ModelDownloadProgress {
  model: string;
  progress: number;
  status: 'downloading' | 'completed' | 'failed';
  error?: string;
}

// Define Tauri function types
type TauriInvokeFunction = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
type TauriListenFunction = <T = Record<string, unknown>>(
  event: string,
  callback: (event: TauriEvent<T>) => void
) => Promise<UnsubscribeFunction>;

// WebSocket event payload interfaces
interface WebSocketEventData {
  type: string;
  data?: {
    type?: string;
    message?: {
      id?: string;
      content?: string;
      text?: string;
      userId?: string;
      author?: string;
      name?: string;
      timestamp?: string;
      metadata?: Record<string, unknown>;
    };
  };
}

interface RealtimeUpdateData {
  type: string;
  data?: TauriMessage;
}

interface WebSocketErrorData {
  message?: string;
  error?: string;
  timestamp?: string;
  [key: string]: unknown;
}

class TauriServiceClass {
  private tauriInvoke: TauriInvokeFunction | null = null;
  private tauriListen: TauriListenFunction | null = null;
  private isTauri: boolean = false;
  private messageListeners: Set<(message: TauriMessage) => void> = new Set();
  private statusListeners: Set<(status: StartupStatus) => void> = new Set();
  private containerLogListeners: Set<(log: ContainerLog) => void> = new Set();
  private unlistenFns: Array<() => void> = [];
  private userId: string;
  private agentId: string = '2fbc0c27-50f4-09f2-9fe4-9dd27d76d46f';
  private isInitialized = false;
  private processedMessageIds: Set<string> = new Set();
  private recentMessages: Array<{ content: string; type: string; timestamp: number }> = [];

  constructor() {
    this.userId = localStorage.getItem('game-user-id') || uuidv4();
    localStorage.setItem('game-user-id', this.userId);

    // Try to initialize Tauri immediately
    this.checkAndInitializeTauri();
  }

  private async tryImportDialog(): Promise<{
    save: TauriDialogAPI['save'];
    open: TauriDialogAPI['open'];
  } | null> {
    
      // Use standard Tauri dialog plugin imports
      const { save, open } = await import('@tauri-apps/plugin-dialog');
      return { save, open };
    } catch {
      // Plugin not available (running in browser environment)
      return null;
    }
  }

  private async checkAndInitializeTauri(): Promise<void> {
    try {
      // Try to import Tauri v2 APIs
      const { invoke } = await import('@tauri-apps/api/core');
      const { listen } = await import('@tauri-apps/api/event');

      // If imports succeed, we're in Tauri environment
      this.tauriInvoke = invoke;
      this.tauriListen = listen;
      this.isTauri = true;

      // Set up event listeners
      await this.setupEventListeners();
      this.isInitialized = true;
    } catch (_error) {
      // Import failed - not in Tauri environment
      this.isTauri = false;
      this.isInitialized = false;
    }
  }

  public async initialize(): Promise<void> {
    // This method is now called by components to ensure initialization
    if (this.isInitialized) return;

    // Try again in case it failed initially
    await this.checkAndInitializeTauri();
  }

  private async setupEventListeners(): Promise<void> {
    // Helper function to emit message with deduplication
    const emitMessage = (message: TauriMessage, source: string) => {
      // Ensure message has an ID
      if (!message.id) {
        message.id = uuidv4();
      }

      // Check if we've already processed this message by ID
      if (this.processedMessageIds.has(message.id)) {
        console.debug(
          `[TauriService] Skipping duplicate message by ID from ${source}:`,
          message.id
        );
        return;
      }

      // Check for duplicate content within a 2-second window
      const now = Date.now();
      const messageTimestamp =
        message.timestamp instanceof Date
          ? message.timestamp.getTime()
          : new Date(message.timestamp).getTime();

      // Check if we've seen this exact message content very recently (within 2 seconds)
      const isDuplicate = this.recentMessages.some(
        (recent) =>
          recent.content === message.content &&
          recent.type === message.type &&
          Math.abs(recent.timestamp - messageTimestamp) < 2000
      );

      if (isDuplicate) {
        console.debug(
          `[TauriService] Skipping duplicate message by content from ${source}:`,
          message.content.substring(0, 50)
        );
        return;
      }

      // Add to processed set and recent messages
      this.processedMessageIds.add(message.id);
      this.recentMessages.push({
        content: message.content,
        type: message.type,
        timestamp: messageTimestamp,
      });

      // Clean up old entries
      if (this.processedMessageIds.size > 1000) {
        const idsArray = Array.from(this.processedMessageIds);
        const toRemove = idsArray.slice(0, idsArray.length - 1000);
        toRemove.forEach((id) => this.processedMessageIds.delete(id));
      }

      // Clean up recent messages older than 5 seconds
      this.recentMessages = this.recentMessages.filter((msg) => now - msg.timestamp < 5000);

      console.debug(`[TauriService] Emitting message from ${source}:`, {
        id: message.id,
        type: message.type,
        content: `${message.content.substring(0, 50)}...`,
      });

      this.messageListeners.forEach((listener) => listener(message));
    };

    // Listen for incoming messages from the agent
    if (!this.tauriListen) throw new Error('Tauri listen not available');
    const unlistenMessage = await this.tauriListen<TauriMessage>('agent-message', (event) => {
      const message = event.payload;
      // Ensure type is set to 'agent' for agent messages
      message.type = 'agent';
      emitMessage(message, 'agent-message');
    });
    this.unlistenFns.push(unlistenMessage);

    // Listen for startup status updates
    if (!this.tauriListen) throw new Error('Tauri listen not available');
    const unlistenStatus = await this.tauriListen<StartupStatus>('startup-status', (event) => {
      const status = event.payload;
      this.statusListeners.forEach((listener) => listener(status));
    });
    this.unlistenFns.push(unlistenStatus);

    // Listen for WebSocket events
    if (!this.tauriListen) throw new Error('Tauri listen not available');
    const unlistenWsEvent = await this.tauriListen<WebSocketEventData>(
      'websocket-event',
      (event) => {
        if (event.payload.type === 'message') {
          const data = event.payload.data;

          if (data?.type === 'agent-message' && data.message) {
            const messageData = data.message;
            const message: TauriMessage = {
              id: messageData.id || uuidv4(),
              content: messageData.content || messageData.text || '',
              type: 'agent',
              authorId: messageData.userId || messageData.author || this.agentId,
              authorName: messageData.name || 'Agent',
              timestamp: messageData.timestamp ? new Date(messageData.timestamp) : new Date(),
              metadata: messageData.metadata || {},
            };
            emitMessage(message, 'websocket-event');
          }
        }
      }
    );
    this.unlistenFns.push(unlistenWsEvent);

    // Listen for real-time updates from the Rust WebSocket manager
    if (!this.tauriListen) throw new Error('Tauri listen not available');
    const unlistenRealtimeUpdate = await this.tauriListen<RealtimeUpdateData>(
      'realtime-update',
      (event) => {
        // Handle different types of realtime updates
        if (event.payload.type === 'message') {
          const message = event.payload.data as TauriMessage;
          // If type isn't set and it's from the agent, set it to 'agent'
          if (!message.type && message.authorId === this.agentId) {
            message.type = 'agent';
          }
          emitMessage(message, 'realtime-update');
        }
      }
    );
    this.unlistenFns.push(unlistenRealtimeUpdate);

    // Listen for WebSocket errors
    if (!this.tauriListen) throw new Error('Tauri listen not available');
    const unlistenWsError = await this.tauriListen<WebSocketErrorData>(
      'websocket-error',
      (event) => {
        // Create an error message to display in the chat
        const errorMessage: TauriMessage = {
          id: uuidv4(),
          content: event.payload.message || event.payload.error || 'WebSocket error occurred',
          type: 'error',
          authorId: 'system',
          authorName: 'System',
          timestamp: event.payload.timestamp ? new Date(event.payload.timestamp) : new Date(),
          metadata: event.payload,
        };

        // Only emit error messages that aren't related to user messages
        // (to avoid duplicating user messages as errors)
        if (!errorMessage.content.includes('Failed to process message')) {
          this.messageListeners.forEach((listener) => listener(errorMessage));
        }
      }
    );
    this.unlistenFns.push(unlistenWsError);

    // Listen for container logs
    if (!this.tauriListen) throw new Error('Tauri listen not available');
    const unlistenContainerLog = await this.tauriListen<ContainerLog>('container-log', (event) => {
      const log = event.payload;
      this.containerLogListeners.forEach((listener) => listener(log));
    });
    this.unlistenFns.push(unlistenContainerLog);
  }

  private async ensureInitializedAndInvoke(
    command: string,
    args?: Record<string, unknown>
  ): Promise<unknown> {
    // Ensure we're initialized before trying to invoke
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.tauriInvoke) {
      throw new Error(
        'Tauri is not available. Please ensure you are running this application through Tauri.'
      );
    }

    return this.tauriInvoke(command, args);
  }

  public isRunningInTauri(): boolean {
    return this.isTauri;
  }

  public getInitializationStatus(): { isTauri: boolean; isInitialized: boolean } {
    return {
      isTauri: this.isTauri,
      isInitialized: this.isInitialized,
    };
  }

  public async ensureInitialized(): Promise<boolean> {
    if (this.isInitialized) return true;

    // Try to detect and initialize again
    await this.checkAndInitializeTauri();

    // Wait a bit for initialization
    await new Promise((resolve) => setTimeout(resolve, 200));

    return this.isInitialized;
  }

  public getUserId(): string {
    return this.userId;
  }

  public getAgentId(): string {
    return this.agentId;
  }

  // Event subscription methods
  public onMessage(listener: (message: TauriMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  public onStatusUpdate(listener: (status: StartupStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  public onContainerLog(listener: (log: ContainerLog) => void): () => void {
    this.containerLogListeners.add(listener);
    return () => this.containerLogListeners.delete(listener);
  }

  // Clean up event listeners
  public destroy(): void {
    this.unlistenFns.forEach((fn) => fn());
    this.unlistenFns = [];
    this.messageListeners.clear();
    this.statusListeners.clear();
    this.containerLogListeners.clear();
  }

  // WebSocket management
  public async connectWebSocket(url: string = 'ws://localhost:7777'): Promise<void> {
    await this.ensureInitializedAndInvoke('connect_websocket', { url });
  }

  public async disconnectWebSocket(): Promise<void> {
    await this.ensureInitializedAndInvoke('disconnect_websocket');
  }

  public async joinChannel(channelId: string): Promise<void> {
    await this.ensureInitializedAndInvoke('websocket_join_channel', { channel_id: channelId });
  }

  public async isWebSocketConnected(): Promise<boolean> {
    const response = await this.ensureInitializedAndInvoke('is_websocket_connected');
    return Boolean(response);
  }

  // Message handling
  public async sendMessage(content: string): Promise<string> {
    const response = await this.ensureInitializedAndInvoke('send_message_to_agent', {
      message: content,
    });

    // Create user message for immediate UI feedback
    const userMessage: TauriMessage = {
      id: uuidv4(),
      content,
      type: 'user',
      authorId: this.userId,
      authorName: 'User',
      timestamp: new Date(),
      metadata: {},
    };

    // Notify listeners of the user message
    this.messageListeners.forEach((listener) => listener(userMessage));

    return String(response || '');
  }

  // Capability management
  public async getCapabilities(): Promise<Record<string, unknown>> {
    const response = await this.ensureInitializedAndInvoke('get_capabilities');
    return (response as Record<string, unknown>) || {};
  }

  public async updateCapability(capability: string, enabled: boolean): Promise<void> {
    await this.ensureInitializedAndInvoke('update_capability', { capability, enabled });
  }

  // Settings management
  public async getSettings(): Promise<Record<string, unknown>> {
    const response = await this.ensureInitializedAndInvoke('get_settings');
    return (response as Record<string, unknown>) || {};
  }

  public async updateSettings(settings: Partial<any>): Promise<void> {
    await this.ensureInitializedAndInvoke('update_settings', { settings });
  }

  // Health check
  public async checkAgentHealth(): Promise<HealthCheckResponse> {
    try {
      const response = (await this.ensureInitializedAndInvoke(
        'health_check'
      )) as HealthCheckResponse;
      return response;
    } catch (error) {
      console.warn('[TauriService] Health check failed:', error);
      return {
        status: 'unhealthy',
        database: false,
        services: {},
      };
    }
  }

  // Container management
  public async getContainerStatus(): Promise<ContainerStatus[]> {
    const response = (await this.ensureInitializedAndInvoke(
      'get_container_status'
    )) as ContainerStatus[];
    return response;
  }

  public async restartContainer(name: string): Promise<void> {
    await this.ensureInitializedAndInvoke('restart_container', { name });
  }

  // Server operations
  public async checkServerStatus(): Promise<boolean> {
    const status = await this.ensureInitializedAndInvoke('check_server_status');
    return status === 'running';
  }

  public async startServer(): Promise<void> {
    await this.ensureInitializedAndInvoke('start_server');
  }

  public async stopServer(): Promise<void> {
    await this.ensureInitializedAndInvoke('stop_server');
  }

  // Data fetching methods

  public async fetchGoals(): Promise<TauriGoal[]> {
    const response = (await this.ensureInitializedAndInvoke('fetch_goals')) as Record<
      string,
      unknown
    >;
    if (response?.success && response?.data) {
      const data = response.data as Record<string, unknown>;
      return (data.goals as TauriGoal[]) || [];
    }
    return [];
  }

  public async fetchTodos(): Promise<TauriTodo[]> {
    const response = (await this.ensureInitializedAndInvoke('fetch_todos')) as Record<
      string,
      unknown
    >;
    if (response?.success && response?.data) {
      const data = response.data as Record<string, unknown>;
      return (data.todos as TauriTodo[]) || [];
    }
    return [];
  }

  public async createGoal(
    name: string,
    description: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.ensureInitializedAndInvoke('create_goal', {
      name,
      description,
      metadata: metadata || {},
    });
  }

  public async createTodo(
    name: string,
    description?: string,
    priority?: number,
    todoType?: string
  ): Promise<void> {
    await this.ensureInitializedAndInvoke('create_todo', {
      name,
      description,
      priority: priority || 1,
      todo_type: todoType || 'one-off',
    });
  }

  public async fetchKnowledgeFiles(): Promise<TauriKnowledgeFile[]> {
    const response = (await this.ensureInitializedAndInvoke(
      'fetch_knowledge_files'
    )) as TauriMemoryResponse;
    if (response?.success && response?.data) {
      return (response.data.files as TauriKnowledgeFile[]) || [];
    }
    return [];
  }

  public async uploadKnowledgeFile(file: File): Promise<void> {
    // Convert file to base64 for transport through Tauri IPC
    const reader = new FileReader();
    const base64Promise = new Promise<string>((resolve) => {
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
    });
    reader.readAsDataURL(file);

    const base64Content = await base64Promise;

    await this.ensureInitializedAndInvoke('upload_knowledge_file', {
      fileName: file.name,
      content: base64Content,
      mimeType: file.type,
    });
  }

  public async deleteKnowledgeFile(fileId: string): Promise<void> {
    await this.ensureInitializedAndInvoke('delete_knowledge_file', { fileId });
  }

  public async fetchMemories(limit: number = 50): Promise<TauriMessage[]> {
    const response = await this.ensureInitializedAndInvoke('fetch_memories', {
      params: { count: limit },
    });

    // Handle different response formats
    let memories = response;

    // If response is wrapped in an object (e.g., { memories: [...] } or { data: [...] })
    if (response && typeof response === 'object' && !Array.isArray(response)) {
      const responseObj = response as Record<string, unknown>;
      memories = responseObj.memories || responseObj.data || [];
    }

    // Ensure memories is an array
    if (!Array.isArray(memories)) {
      console.warn(
        '[TauriService] fetchMemories: Expected array but got:',
        typeof memories,
        memories
      );
      return [];
    }

    // Convert memories to TauriMessage format
    return memories.map((memory: Record<string, unknown>) => ({
      id: String(memory.id || uuidv4()),
      content: String((memory.content as Record<string, unknown>)?.text || memory.content || ''),
      type: (memory.userId === this.userId ? 'user' : 'agent') as
        | 'user'
        | 'agent'
        | 'system'
        | 'error',
      authorId: String(memory.userId || memory.authorId || 'unknown'),
      authorName: memory.userId === this.userId ? 'User' : 'Agent',
      timestamp: memory.timestamp
        ? new Date(Number(memory.timestamp))
        : new Date(Number(memory.createdAt) || Date.now()),
      metadata: (memory.metadata as Record<string, unknown>) || {},
    }));
  }

  public async fetchMemoriesFromRoom(roomId: string, limit: number = 50): Promise<TauriMessage[]> {
    const response = await this.ensureInitializedAndInvoke('fetch_memories', {
      params: { roomId, count: limit },
    });

    // Handle different response formats using type-safe extraction
    let memories: Record<string, unknown>[] = [];

    // Extract memories using type-safe utility function
    const memoryEntries = extractMemoriesFromResponse(response);
    if (memoryEntries.length > 0) {
      memories = convertToRecordArray(memoryEntries);
    } else if (Array.isArray(response)) {
      // Direct array response
      memories = response;
    } else {
      // Unexpected format
      console.warn(
        '[TauriService] fetchMemoriesFromRoom: Unexpected response format:',
        typeof response,
        response
      );
      return [];
    }

    // Convert memories to TauriMessage format
    return memories.map((memory: Record<string, unknown>) => ({
      id: String(memory.id || uuidv4()),
      content: String((memory.content as Record<string, unknown>)?.text || memory.content || ''),
      type: (memory.userId === this.userId ? 'user' : 'agent') as
        | 'user'
        | 'agent'
        | 'system'
        | 'error',
      authorId: String(memory.userId || memory.authorId || 'unknown'),
      authorName: memory.userId === this.userId ? 'User' : 'Agent',
      timestamp: memory.timestamp
        ? new Date(Number(memory.timestamp))
        : new Date(Number(memory.createdAt) || Date.now()),
      metadata: (memory.metadata as Record<string, unknown>) || {},
    }));
  }

  public async fetchPlugins(): Promise<Record<string, unknown>[]> {
    const response = (await this.ensureInitializedAndInvoke(
      'fetch_plugins'
    )) as TauriMemoryResponse;
    if (response?.success && response?.data) {
      return (response.data.plugins as Record<string, unknown>[]) || [];
    }
    return [];
  }

  public async updatePluginConfig(
    pluginId: string,
    config: Record<string, unknown>
  ): Promise<void> {
    await this.ensureInitializedAndInvoke('update_plugin_config', { pluginId, config });
  }

  public async togglePlugin(pluginId: string, enabled: boolean): Promise<void> {
    await this.ensureInitializedAndInvoke('toggle_plugin', { pluginId, enabled });
  }

  // Additional plugin configuration methods
  public async fetchPluginConfigs(): Promise<Record<string, unknown>> {
    const response = (await this.ensureInitializedAndInvoke(
      'fetch_plugin_configs'
    )) as TauriSettingsResponse;
    if (response?.success && response?.data) {
      return response.data;
    }
    return { plugins: [] };
  }

  // Configuration operations
  public async validateConfiguration(): Promise<ValidationResponse> {
    const response = (await this.ensureInitializedAndInvoke(
      'validate_configuration'
    )) as ValidationResponse;
    return response;
  }

  public async testConfiguration(): Promise<TestConfigurationResponse> {
    const response = (await this.ensureInitializedAndInvoke(
      'test_configuration'
    )) as TestConfigurationResponse;
    return response;
  }

  public async saveConfiguration(config: Record<string, unknown>): Promise<void> {
    await this.ensureInitializedAndInvoke('save_configuration', { config });
  }

  public async loadConfiguration(): Promise<Record<string, unknown>> {
    const response = await this.ensureInitializedAndInvoke('load_configuration');
    return (response as Record<string, unknown>) || {};
  }

  // Dynamic Configuration Management
  public async getAgentConfiguration(): Promise<Record<string, unknown>> {
    const response = await this.ensureInitializedAndInvoke('get_agent_configuration');
    return (response as Record<string, unknown>) || {};
  }

  public async updateAgentConfiguration(
    updates: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const response = await this.ensureInitializedAndInvoke('update_agent_configuration', {
      config_updates: updates,
    });
    return (response as Record<string, unknown>) || {};
  }

  public async getAvailableProviders(): Promise<Record<string, unknown>> {
    const response = await this.ensureInitializedAndInvoke('get_available_providers');
    return (response as Record<string, unknown>) || {};
  }

  // Backup and Restore Operations
  public async createBackup(backupType: string, notes?: string): Promise<Record<string, unknown>> {
    const response = await this.ensureInitializedAndInvoke('create_backup', {
      backup_type: backupType,
      notes,
    });
    return (response as Record<string, unknown>) || {};
  }

  public async restoreBackup(backupId: string, options: Record<string, unknown>): Promise<void> {
    await this.ensureInitializedAndInvoke('restore_backup', {
      backup_id: backupId,
      options,
    });
  }

  public async listBackups(): Promise<Record<string, unknown>[]> {
    const response = await this.ensureInitializedAndInvoke('list_backups');
    return (response as Record<string, unknown>[]) || [];
  }

  public async deleteBackup(backupId: string): Promise<void> {
    await this.ensureInitializedAndInvoke('delete_backup', { backup_id: backupId });
  }

  public async getBackupConfig(): Promise<Record<string, unknown>> {
    const response = await this.ensureInitializedAndInvoke('get_backup_config');
    return (response as Record<string, unknown>) || {};
  }

  public async updateBackupConfig(config: Record<string, unknown>): Promise<void> {
    await this.ensureInitializedAndInvoke('update_backup_config', { config });
  }

  public async exportBackup(backupId: string): Promise<string> {
    const dialog = await this.tryImportDialog();

    if (dialog) {
      try {
        const exportPath = await dialog.save({
          defaultPath: `eliza-backup-${new Date().toISOString().split('T')[0]}.zip`,
          filters: [{ name: 'Backup Files', extensions: ['zip'] }],
        });

        if (!exportPath) {
          throw new Error('Export cancelled');
        }

        const response = await this.ensureInitializedAndInvoke('export_backup', {
          backup_id: backupId,
          export_path: exportPath,
        });
        return String(response || exportPath);
      
    }

    // Fallback if Tauri dialog is not available
    console.warn('[TauriService] Dialog plugin not available, using fallback path');
    const response = await this.ensureInitializedAndInvoke('export_backup', {
      backup_id: backupId,
      export_path: `/tmp/eliza-backup-${backupId}.zip`,
    });
    return String(response || '');
  }

  public async importBackup(importPath: string): Promise<Record<string, unknown>> {
    const response = await this.ensureInitializedAndInvoke('import_backup', {
      import_path: importPath,
    });
    return (response as Record<string, unknown>) || {};
  }

  public async selectFile(options?: {
    filters?: Array<{ name: string; extensions: string[] }>;
  }): Promise<string | null> {
    const dialog = await this.tryImportDialog();

    if (dialog) {
      
        const selected = await dialog.open({
          multiple: false,
          filters: options?.filters || [],
        });

        return selected as string | null;
      
    }

    // Fallback if Tauri dialog is not available
    console.warn('[TauriService] Dialog plugin not available');
    return null;
  }

  public async restartApplication(): Promise<void> {
    // For now, just reload the window
    window.location.reload();
  }

  // Autonomy management
  public async toggleAutonomy(enabled: boolean): Promise<void> {
    await this.ensureInitializedAndInvoke('toggle_autonomy', { enabled });
  }

  public async getAutonomyStatus(): Promise<{ enabled: boolean; interval: number }> {
    const response = await this.ensureInitializedAndInvoke('get_autonomy_status');
    return (
      (response as { enabled: boolean; interval: number }) || { enabled: false, interval: 5000 }
    );
  }

  // Alias for compatibility with GameInterface
  public async fetchAutonomyStatus(): Promise<Record<string, unknown>> {
    const response = (await this.ensureInitializedAndInvoke(
      'fetch_autonomy_status'
    )) as TauriSettingsResponse;
    if (response?.success && response?.data) {
      return response.data;
    }
    return { enabled: false, running: false, interval: 5000 };
  }

  // Shell/browser capability management
  public async toggleCapability(capability: string): Promise<void> {
    await this.ensureInitializedAndInvoke('toggle_capability', { capability });
  }

  public async getCapabilityStatus(
    capability: string
  ): Promise<{ enabled: boolean; service_available: boolean }> {
    const response = await this.ensureInitializedAndInvoke('get_capability_status', { capability });
    return (
      (response as { enabled: boolean; service_available: boolean }) || {
        enabled: false,
        service_available: false,
      }
    );
  }

  // Vision settings management
  public async getVisionSettings(): Promise<Record<string, unknown>> {
    const response = await this.ensureInitializedAndInvoke('get_vision_settings');
    return (response as Record<string, unknown>) || {};
  }

  public async updateVisionSettings(settings: Record<string, unknown>): Promise<void> {
    await this.ensureInitializedAndInvoke('update_vision_settings', { settings });
  }

  public async updateAgentSetting(key: string, value: unknown): Promise<void> {
    await this.ensureInitializedAndInvoke('update_agent_setting', { key, value });
  }

  public async getAgentSettings(): Promise<Record<string, unknown>> {
    const response = await this.ensureInitializedAndInvoke('get_agent_settings');
    return (response as Record<string, unknown>) || {};
  }

  public async refreshVisionService(): Promise<void> {
    await this.ensureInitializedAndInvoke('refresh_vision_service');
  }

  // Agent management
  public async resetAgent(): Promise<void> {
    await this.ensureInitializedAndInvoke('reset_agent');
  }

  public async fetchLogs(logType?: string, limit?: number): Promise<Record<string, unknown>[]> {
    const response = await this.ensureInitializedAndInvoke('fetch_logs', {
      log_type: logType,
      limit: limit || 100,
    });

    // Use type-safe log extraction
    const logEntries = extractLogsFromResponse(response);
    return convertToRecordArray(logEntries);
  }

  public async getAgentInfo(): Promise<{ id: string; name: string; version: string }> {
    const response = await this.ensureInitializedAndInvoke('get_agent_info');
    return (
      (response as { id: string; name: string; version: string }) || {
        id: '',
        name: '',
        version: '',
      }
    );
  }

  // Database operations
  public async fetchDatabaseTables(): Promise<string[]> {
    const response = (await this.ensureInitializedAndInvoke(
      'fetch_db_tables'
    )) as TauriMemoryResponse;
    if (response?.success && response?.data) {
      return (response.data.tables as string[]) || [];
    }
    return [];
  }

  public async fetchDatabaseTableData(
    table: string,
    page: number = 1,
    limit: number = 50
  ): Promise<Record<string, unknown>> {
    const response = (await this.ensureInitializedAndInvoke('fetch_db_table_data', {
      table,
      page,
      limit,
    })) as TauriSettingsResponse;
    if (response?.success && response?.data) {
      return response.data;
    }
    return { data: [], total: 0, page: 1, limit };
  }

  public async fetchDatabaseStats(): Promise<Record<string, unknown>> {
    const response = (await this.ensureInitializedAndInvoke(
      'fetch_db_stats'
    )) as TauriSettingsResponse;
    if (response?.success && response?.data) {
      return response.data;
    }
    return { connections: 0, queries: 0, uptime: 0 };
  }

  // Frontend helper methods for API proxy
  public async proxyApiRequest(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const response = await this.ensureInitializedAndInvoke('proxy_api_request', {
      method,
      path,
      body,
    });
    return (response as Record<string, unknown>) || {};
  }

  // Plugin HTTP routes
  public async fetchPluginRoutes(): Promise<
    Array<{ name: string; path: string; display_name?: string }>
  > {
    const response = (await this.ensureInitializedAndInvoke(
      'fetch_plugin_routes'
    )) as TauriMemoryResponse;
    if (response?.success && response?.data) {
      return (
        (response.data.routes as Array<{ name: string; path: string; display_name?: string }>) || []
      );
    }
    return [];
  }

  public async fetchTabContent(route: string): Promise<string> {
    const response = (await this.ensureInitializedAndInvoke('fetch_tab_content', {
      route,
    })) as TauriMemoryResponse;
    if (response?.success && response?.data) {
      return String(response.data.content || '');
    }
    return '';
  }

  /**
   * Check if Ollama models are loaded and ready
   */
  async checkOllamaModels(): Promise<OllamaModelStatus> {
    try {
      if (!this.tauriInvoke) throw new Error('Tauri invoke not available');
      const response = await this.tauriInvoke('check_ollama_models');
      return response as OllamaModelStatus;
    } catch (error) {
      console.error('Failed to check Ollama models:', error);
      throw error;
    }
  }

  /**
   * Pull missing Ollama models
   */
  async pullMissingModels(): Promise<void> {
    try {
      if (!this.tauriInvoke) throw new Error('Tauri invoke not available');
      await this.tauriInvoke('pull_missing_models');
    } catch (error) {
      console.error('Failed to pull missing models:', error);
      throw error;
    }
  }

  /**
   * Listen for model download progress
   */
  async onModelDownloadProgress(
    callback: (progress: ModelDownloadProgress) => void
  ): Promise<() => void> {
    if (!this.tauriListen) throw new Error('Tauri listen not available');
    return await this.tauriListen<ModelDownloadProgress>('model-download-progress', (event) => {
      callback(event.payload);
    });
  }

  /**
   * Listen for model download completion
   */
  async onModelDownloadComplete(
    callback: (result: { success: boolean; error?: string }) => void
  ): Promise<() => void> {
    if (!this.tauriListen) throw new Error('Tauri listen not available');
    return await this.tauriListen<{ success: boolean; error?: string }>(
      'model-download-complete',
      (event) => {
        callback(event.payload);
      }
    );
  }

  /**
   * Gracefully shut down the application
   */
  async shutdownApplication(): Promise<void> {
    if (!this.isTauri || !this.tauriInvoke) {
      throw new Error('Not in Tauri environment');
    }

    try {
      console.log('[TauriService] Initiating application shutdown...');
      await this.tauriInvoke('shutdown_application');
    } catch (error) {
      console.error('[TauriService] Failed to shutdown application:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const TauriService = new TauriServiceClass();
export default TauriService;
