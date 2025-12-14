/**
 * Proxy Node Client
 * Runs on user machines to provide bandwidth to the proxy network
 * 
 * Can be run standalone or embedded in the wallet
 * 
 * @module @jeju/proxy/node
 */

import { EventEmitter } from 'events';
import { Wallet } from 'ethers';
import type {
  RegionCode,
  NodeClientConfig,
  WsMessage,
  AuthSubmitPayload,
  TaskAssignPayload,
  TaskResultPayload,
  HeartbeatResponsePayload,
  ProxyRequest,
  ProxyResponse,
  Address,
} from '../types';
import { WsMessageType } from '../types';

interface NodeStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalBytesServed: number;
  uptime: number;
  currentLoad: number;
  pendingRequests: number;
}

export class ProxyNodeClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private wallet: Wallet;
  private config: NodeClientConfig;
  private connectionId: string | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private pendingTasks: Map<string, NodeJS.Timeout> = new Map();
  private isConnected = false;
  private startTime: number = Date.now();

  // Stats
  private stats: NodeStats = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    totalBytesServed: 0,
    uptime: 0,
    currentLoad: 0,
    pendingRequests: 0,
  };

  constructor(config: NodeClientConfig) {
    super();
    this.config = {
      maxConcurrentRequests: 10,
      heartbeatIntervalMs: 30000,
      ...config,
    };
    this.wallet = new Wallet(config.privateKey);
  }

  /**
   * Get the node's address
   */
  get address(): Address {
    return this.wallet.address as Address;
  }

  /**
   * Connect to the coordinator
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = this.config.coordinatorUrl.replace('http', 'ws');
      
      console.log('[ProxyNode] Connecting to coordinator:', wsUrl);
      this.ws = new WebSocket(wsUrl);

      const connectionTimeout = setTimeout(() => {
        if (!this.isConnected) {
          this.ws?.close();
          reject(new Error('Connection timeout'));
        }
      }, 10000);

      this.ws.onopen = () => {
        console.log('[ProxyNode] WebSocket connected, waiting for auth...');
      };

      this.ws.onmessage = async (event) => {
        const message = JSON.parse(event.data as string) as WsMessage;
        await this.handleMessage(message, resolve, reject, connectionTimeout);
      };

      this.ws.onerror = (error) => {
        console.error('[ProxyNode] WebSocket error:', error);
        this.emit('error', error);
      };

      this.ws.onclose = (event) => {
        clearTimeout(connectionTimeout);
        this.isConnected = false;
        this.connectionId = null;
        this.stopHeartbeat();
        this.emit('disconnected', event.code, event.reason);

        // Attempt reconnect
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
          console.log(`[ProxyNode] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
          setTimeout(() => this.connect().catch(console.error), delay);
        } else {
          console.error('[ProxyNode] Max reconnect attempts reached');
          this.emit('maxReconnectsReached');
        }
      };
    });
  }

  /**
   * Handle incoming WebSocket message
   */
  private async handleMessage(
    message: WsMessage,
    connectResolve?: (value: void) => void,
    connectReject?: (reason: Error) => void,
    connectionTimeout?: NodeJS.Timeout
  ): Promise<void> {
    switch (message.type) {
      case WsMessageType.AUTH_REQUEST:
        await this.handleAuthRequest(message);
        break;

      case WsMessageType.AUTH_RESPONSE:
        if (connectionTimeout) clearTimeout(connectionTimeout);
        
        const authPayload = message.payload as { success: boolean; connectionId?: string; error?: string };
        if (authPayload.success) {
          this.isConnected = true;
          this.connectionId = authPayload.connectionId || null;
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          this.emit('connected', this.connectionId);
          console.log('[ProxyNode] Authenticated successfully, connectionId:', this.connectionId);
          connectResolve?.();
        } else {
          const error = new Error(authPayload.error || 'Authentication failed');
          this.emit('authFailed', error);
          connectReject?.(error);
        }
        break;

      case WsMessageType.TASK_ASSIGN:
        await this.handleTaskAssign(message.payload as TaskAssignPayload);
        break;

      case WsMessageType.HEARTBEAT_REQUEST:
        this.handleHeartbeatRequest();
        break;

      case WsMessageType.ERROR:
        console.error('[ProxyNode] Server error:', message.payload);
        this.emit('serverError', message.payload);
        break;

      default:
        console.warn('[ProxyNode] Unknown message type:', message.type);
    }
  }

  /**
   * Handle auth request from coordinator
   */
  private async handleAuthRequest(message: WsMessage): Promise<void> {
    const { nonce } = message.payload as { nonce: string };

    // Sign authentication message
    const authMessage = `Network Proxy Node Authentication\nAddress: ${this.wallet.address}\nNonce: ${nonce}`;
    const signature = await this.wallet.signMessage(authMessage);

    const authPayload: AuthSubmitPayload = {
      address: this.wallet.address as Address,
      regionCode: this.config.regionCode,
      signature,
      nonce,
      maxConcurrentRequests: this.config.maxConcurrentRequests || 10,
    };

    this.sendMessage({
      type: WsMessageType.AUTH_SUBMIT,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      payload: authPayload,
    });
  }

  /**
   * Handle task assignment from coordinator
   */
  private async handleTaskAssign(payload: TaskAssignPayload): Promise<void> {
    const { taskId, request, deadline } = payload;

    console.log('[ProxyNode] Task assigned:', taskId, request.url);
    this.stats.totalRequests++;
    this.stats.pendingRequests++;
    this.emit('taskReceived', taskId, request);

    // Set task timeout
    const timeout = setTimeout(() => {
      this.stats.pendingRequests = Math.max(0, this.stats.pendingRequests - 1);
      this.stats.failedRequests++;
      this.sendTaskResult(taskId, false, undefined, 'Task timeout');
    }, deadline - Date.now());

    this.pendingTasks.set(taskId, timeout);

    try {
      const response = await this.executeRequest(request);
      clearTimeout(timeout);
      this.pendingTasks.delete(taskId);

      this.stats.pendingRequests = Math.max(0, this.stats.pendingRequests - 1);
      this.stats.successfulRequests++;
      this.stats.totalBytesServed += response.bytesTransferred;

      this.sendTaskResult(taskId, true, response);
      this.emit('taskCompleted', taskId, response);
    } catch (err) {
      clearTimeout(timeout);
      this.pendingTasks.delete(taskId);

      this.stats.pendingRequests = Math.max(0, this.stats.pendingRequests - 1);
      this.stats.failedRequests++;

      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      this.sendTaskResult(taskId, false, undefined, errorMessage);
      this.emit('taskFailed', taskId, errorMessage);
    }
  }

  /**
   * Execute a proxy request
   */
  private async executeRequest(request: ProxyRequest): Promise<ProxyResponse> {
    const startTime = Date.now();

    const fetchOptions: RequestInit = {
      method: request.method,
      headers: request.headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      redirect: request.followRedirects ? 'follow' : 'manual',
    };

    // Add timeout using AbortController
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), request.timeout || 30000);
    fetchOptions.signal = controller.signal;

    try {
      const response = await fetch(request.url, fetchOptions);
      clearTimeout(timeoutId);

      const body = await response.text();
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      const bytesTransferred = new TextEncoder().encode(body).length;

      return {
        requestId: request.requestId,
        sessionId: request.sessionId,
        statusCode: response.status,
        statusText: response.statusText,
        headers,
        body,
        bytesTransferred,
        latencyMs: Date.now() - startTime,
        nodeAddress: this.wallet.address as Address,
      };
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  /**
   * Send task result to coordinator
   */
  private sendTaskResult(
    taskId: string,
    success: boolean,
    response?: ProxyResponse,
    error?: string
  ): void {
    const result: TaskResultPayload = {
      taskId,
      success,
      response,
      error,
    };

    this.sendMessage({
      type: WsMessageType.TASK_RESULT,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      payload: result,
    });
  }

  /**
   * Handle heartbeat request
   */
  private handleHeartbeatRequest(): void {
    this.updateLoad();

    const payload: HeartbeatResponsePayload = {
      currentLoad: this.stats.currentLoad,
      pendingRequests: this.stats.pendingRequests,
      memoryUsage: process.memoryUsage?.().heapUsed || 0,
      uptime: Date.now() - this.startTime,
    };

    this.sendMessage({
      type: WsMessageType.HEARTBEAT_RESPONSE,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      payload,
    });
  }

  /**
   * Start heartbeat interval
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.updateLoad();
      this.emit('heartbeat', this.stats);
    }, this.config.heartbeatIntervalMs);
  }

  /**
   * Stop heartbeat interval
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Update current load calculation
   */
  private updateLoad(): void {
    const maxRequests = this.config.maxConcurrentRequests || 10;
    this.stats.currentLoad = Math.round((this.stats.pendingRequests / maxRequests) * 100);
    this.stats.uptime = Date.now() - this.startTime;
  }

  /**
   * Send message to coordinator
   */
  private sendMessage(message: WsMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Disconnect from coordinator
   */
  disconnect(): void {
    this.maxReconnectAttempts = 0; // Prevent reconnection
    
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.stopHeartbeat();
    
    // Cancel pending tasks
    for (const timeout of this.pendingTasks.values()) {
      clearTimeout(timeout);
    }
    this.pendingTasks.clear();

    this.isConnected = false;
    this.connectionId = null;
  }

  /**
   * Get current stats
   */
  getStats(): NodeStats {
    this.updateLoad();
    return { ...this.stats };
  }

  /**
   * Check if connected
   */
  get connected(): boolean {
    return this.isConnected;
  }

  /**
   * Get region code
   */
  get regionCode(): RegionCode {
    return this.config.regionCode;
  }
}

/**
 * Create and start a proxy node from environment
 */
export async function startProxyNode(): Promise<ProxyNodeClient> {
  const config: NodeClientConfig = {
    coordinatorUrl: process.env.PROXY_COORDINATOR_URL || 'ws://localhost:4021',
    privateKey: process.env.NODE_PRIVATE_KEY || process.env.PRIVATE_KEY || '',
    regionCode: (process.env.NODE_REGION || 'US') as RegionCode,
    maxConcurrentRequests: parseInt(process.env.NODE_MAX_CONCURRENT || '10', 10),
    heartbeatIntervalMs: 30000,
  };

  if (!config.privateKey) {
    console.error('NODE_PRIVATE_KEY or PRIVATE_KEY required');
    process.exit(1);
  }

  const client = new ProxyNodeClient(config);

  client.on('connected', (connectionId) => {
    console.log('[ProxyNode] Connected as', client.address, 'connectionId:', connectionId);
  });

  client.on('disconnected', (code, reason) => {
    console.log('[ProxyNode] Disconnected:', code, reason);
  });

  client.on('taskReceived', (taskId, request) => {
    console.log('[ProxyNode] Task:', taskId, request.url);
  });

  client.on('taskCompleted', (taskId) => {
    console.log('[ProxyNode] Completed:', taskId);
  });

  client.on('taskFailed', (taskId, error) => {
    console.error('[ProxyNode] Failed:', taskId, error);
  });

  await client.connect();
  return client;
}


