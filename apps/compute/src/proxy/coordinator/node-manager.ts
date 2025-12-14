/**
 * Node Manager - Tracks connected proxy nodes via WebSocket
 * @module @jeju/proxy/coordinator/node-manager
 */

import { EventEmitter } from 'events';
import type { ServerWebSocket } from 'bun';
import { Contract, JsonRpcProvider, Wallet, verifyMessage } from 'ethers';
import type {
  Address,
  ConnectedNode,
  RegionCode,
  WsMessage,
  AuthSubmitPayload,
  HeartbeatResponsePayload,
  StatusUpdatePayload,
  TaskAssignPayload,
  TaskResultPayload,
} from '../types';
import { WsMessageType, hashRegion, regionFromHash } from '../types';

const PROXY_REGISTRY_ABI = [
  'function isActive(address) view returns (bool)',
  'function getNode(address) view returns (tuple(address owner, bytes32 regionCode, string endpoint, uint256 stake, uint256 registeredAt, uint256 totalBytesServed, uint256 totalSessions, uint256 successfulSessions, bool active))',
];

interface NodeConnection {
  ws: ServerWebSocket<{ connectionId: string }>;
  node: ConnectedNode;
  pendingTasks: Map<string, { resolve: (result: TaskResultPayload) => void; reject: (err: Error) => void; timeout: NodeJS.Timeout }>;
}

interface NodeManagerConfig {
  rpcUrl: string;
  registryAddress: Address;
  heartbeatIntervalMs: number;
  connectionTimeoutMs: number;
  maxConcurrentRequestsPerNode: number;
}

export class NodeManager extends EventEmitter {
  private connections: Map<string, NodeConnection> = new Map(); // connectionId -> connection
  private nodeToConnection: Map<Address, string> = new Map(); // node address -> connectionId
  private regionNodes: Map<RegionCode, Set<string>> = new Map(); // region -> connectionIds
  private provider: JsonRpcProvider;
  private registry: Contract;
  private config: NodeManagerConfig;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(config: NodeManagerConfig) {
    super();
    this.config = config;
    this.provider = new JsonRpcProvider(config.rpcUrl);
    this.registry = new Contract(config.registryAddress, PROXY_REGISTRY_ABI, this.provider);
  }

  /**
   * Start the node manager
   */
  start(): void {
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeats();
    }, this.config.heartbeatIntervalMs);

    console.log('[NodeManager] Started with heartbeat interval:', this.config.heartbeatIntervalMs, 'ms');
  }

  /**
   * Stop the node manager
   */
  stop(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Close all connections
    for (const conn of this.connections.values()) {
      conn.ws.close(1000, 'Server shutting down');
    }
    this.connections.clear();
    this.nodeToConnection.clear();
    this.regionNodes.clear();
  }

  /**
   * Handle new WebSocket connection
   */
  async handleConnection(ws: ServerWebSocket<{ connectionId: string }>): Promise<void> {
    const connectionId = crypto.randomUUID();
    ws.data = { connectionId };

    // Send auth request
    this.sendMessage(ws, {
      type: WsMessageType.AUTH_REQUEST,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      payload: {
        nonce: crypto.randomUUID(),
        message: 'Sign this message to authenticate as a network proxy node',
      },
    });

    // Set timeout for auth
    setTimeout(() => {
      if (!this.connections.has(connectionId)) {
        ws.close(4001, 'Authentication timeout');
      }
    }, this.config.connectionTimeoutMs);
  }

  /**
   * Handle incoming WebSocket message
   */
  async handleMessage(ws: ServerWebSocket<{ connectionId: string }>, data: string): Promise<void> {
    const message = JSON.parse(data) as WsMessage;
    const connectionId = ws.data?.connectionId;

    switch (message.type) {
      case WsMessageType.AUTH_SUBMIT:
        await this.handleAuthSubmit(ws, message.payload as AuthSubmitPayload);
        break;

      case WsMessageType.TASK_RESULT:
        if (connectionId) {
          this.handleTaskResult(connectionId, message.payload as TaskResultPayload);
        }
        break;

      case WsMessageType.HEARTBEAT_RESPONSE:
        if (connectionId) {
          this.handleHeartbeatResponse(connectionId, message.payload as HeartbeatResponsePayload);
        }
        break;

      case WsMessageType.STATUS_UPDATE:
        if (connectionId) {
          this.handleStatusUpdate(connectionId, message.payload as StatusUpdatePayload);
        }
        break;

      default:
        console.warn('[NodeManager] Unknown message type:', message.type);
    }
  }

  /**
   * Handle node disconnection
   */
  handleDisconnect(ws: ServerWebSocket<{ connectionId: string }>): void {
    const connectionId = ws.data?.connectionId;
    if (!connectionId) return;

    const conn = this.connections.get(connectionId);
    if (!conn) return;

    // Clean up region mapping
    const region = conn.node.regionCode;
    const regionSet = this.regionNodes.get(region);
    if (regionSet) {
      regionSet.delete(connectionId);
      if (regionSet.size === 0) {
        this.regionNodes.delete(region);
      }
    }

    // Clean up pending tasks
    for (const [taskId, task] of conn.pendingTasks) {
      clearTimeout(task.timeout);
      task.reject(new Error('Node disconnected'));
    }

    // Remove from maps
    this.nodeToConnection.delete(conn.node.address);
    this.connections.delete(connectionId);

    this.emit('nodeDisconnected', conn.node);
    console.log('[NodeManager] Node disconnected:', conn.node.address, 'region:', region);
  }

  /**
   * Handle auth submission from node
   */
  private async handleAuthSubmit(
    ws: ServerWebSocket<{ connectionId: string }>,
    payload: AuthSubmitPayload
  ): Promise<void> {
    const connectionId = ws.data?.connectionId;
    if (!connectionId) {
      ws.close(4002, 'No connection ID');
      return;
    }

    // Verify signature
    const message = `Network Proxy Node Authentication\nAddress: ${payload.address}\nNonce: ${payload.nonce}`;
    let recoveredAddress: string;
    try {
      recoveredAddress = verifyMessage(message, payload.signature);
    } catch {
      this.sendMessage(ws, {
        type: WsMessageType.AUTH_RESPONSE,
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        payload: { success: false, error: 'Invalid signature' },
      });
      ws.close(4003, 'Invalid signature');
      return;
    }

    if (recoveredAddress.toLowerCase() !== payload.address.toLowerCase()) {
      this.sendMessage(ws, {
        type: WsMessageType.AUTH_RESPONSE,
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        payload: { success: false, error: 'Signature mismatch' },
      });
      ws.close(4003, 'Signature mismatch');
      return;
    }

    // Check if node is registered and active on-chain
    let isActive: boolean;
    try {
      isActive = await this.registry.isActive(payload.address);
    } catch {
      isActive = false;
    }

    if (!isActive) {
      this.sendMessage(ws, {
        type: WsMessageType.AUTH_RESPONSE,
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        payload: { success: false, error: 'Node not registered or inactive on-chain' },
      });
      ws.close(4004, 'Node not registered');
      return;
    }

    // Get node info from chain
    const nodeInfo = await this.registry.getNode(payload.address);
    const regionHash = nodeInfo.regionCode as `0x${string}`;
    const region = regionFromHash(regionHash) || payload.regionCode;

    // Check if already connected
    const existingConnId = this.nodeToConnection.get(payload.address as Address);
    if (existingConnId) {
      const existingConn = this.connections.get(existingConnId);
      if (existingConn) {
        existingConn.ws.close(4005, 'New connection from same node');
        this.handleDisconnect(existingConn.ws);
      }
    }

    // Create connected node
    const connectedNode: ConnectedNode = {
      address: payload.address as Address,
      regionCode: region,
      regionHash,
      endpoint: nodeInfo.endpoint,
      stake: BigInt(nodeInfo.stake.toString()),
      registeredAt: Number(nodeInfo.registeredAt),
      totalBytesServed: BigInt(nodeInfo.totalBytesServed.toString()),
      totalSessions: Number(nodeInfo.totalSessions),
      successfulSessions: Number(nodeInfo.successfulSessions),
      active: true,
      connectionId,
      connectedAt: Date.now(),
      lastHeartbeat: Date.now(),
      currentLoad: 0,
      pendingRequests: 0,
      maxConcurrentRequests: payload.maxConcurrentRequests || this.config.maxConcurrentRequestsPerNode,
    };

    // Store connection
    const connection: NodeConnection = {
      ws,
      node: connectedNode,
      pendingTasks: new Map(),
    };

    this.connections.set(connectionId, connection);
    this.nodeToConnection.set(payload.address as Address, connectionId);

    // Add to region map
    let regionSet = this.regionNodes.get(region);
    if (!regionSet) {
      regionSet = new Set();
      this.regionNodes.set(region, regionSet);
    }
    regionSet.add(connectionId);

    // Send success response
    this.sendMessage(ws, {
      type: WsMessageType.AUTH_RESPONSE,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      payload: { success: true, connectionId },
    });

    this.emit('nodeConnected', connectedNode);
    console.log('[NodeManager] Node authenticated:', payload.address, 'region:', region);
  }

  /**
   * Handle task result from node
   */
  private handleTaskResult(connectionId: string, payload: TaskResultPayload): void {
    const conn = this.connections.get(connectionId);
    if (!conn) return;

    const task = conn.pendingTasks.get(payload.taskId);
    if (!task) {
      console.warn('[NodeManager] Task result for unknown task:', payload.taskId);
      return;
    }

    clearTimeout(task.timeout);
    conn.pendingTasks.delete(payload.taskId);
    conn.node.pendingRequests = Math.max(0, conn.node.pendingRequests - 1);

    task.resolve(payload);
  }

  /**
   * Handle heartbeat response
   */
  private handleHeartbeatResponse(connectionId: string, payload: HeartbeatResponsePayload): void {
    const conn = this.connections.get(connectionId);
    if (!conn) return;

    conn.node.lastHeartbeat = Date.now();
    conn.node.currentLoad = payload.currentLoad;
    conn.node.pendingRequests = payload.pendingRequests;
  }

  /**
   * Handle status update from node
   */
  private handleStatusUpdate(connectionId: string, payload: StatusUpdatePayload): void {
    const conn = this.connections.get(connectionId);
    if (!conn) return;

    conn.node.currentLoad = payload.currentLoad;
    conn.node.pendingRequests = payload.pendingRequests;

    if (!payload.available && conn.node.active) {
      // Node is temporarily unavailable
      conn.node.active = false;
      this.emit('nodeUnavailable', conn.node);
    } else if (payload.available && !conn.node.active) {
      conn.node.active = true;
      this.emit('nodeAvailable', conn.node);
    }
  }

  /**
   * Send heartbeats to all connected nodes
   */
  private sendHeartbeats(): void {
    const now = Date.now();
    const staleThreshold = this.config.heartbeatIntervalMs * 3;

    for (const [connectionId, conn] of this.connections) {
      // Check if node is stale
      if (now - conn.node.lastHeartbeat > staleThreshold) {
        console.warn('[NodeManager] Node stale, disconnecting:', conn.node.address);
        conn.ws.close(4006, 'Heartbeat timeout');
        this.handleDisconnect(conn.ws);
        continue;
      }

      // Send heartbeat request
      this.sendMessage(conn.ws, {
        type: WsMessageType.HEARTBEAT_REQUEST,
        id: crypto.randomUUID(),
        timestamp: now,
        payload: {},
      });
    }
  }

  /**
   * Get available node for region
   */
  getAvailableNode(regionCode: RegionCode): ConnectedNode | null {
    const regionSet = this.regionNodes.get(regionCode);
    if (!regionSet || regionSet.size === 0) return null;

    // Find least loaded available node
    let bestNode: ConnectedNode | null = null;
    let bestLoad = Infinity;

    for (const connectionId of regionSet) {
      const conn = this.connections.get(connectionId);
      if (!conn || !conn.node.active) continue;

      // Skip if at capacity
      if (conn.node.pendingRequests >= conn.node.maxConcurrentRequests) continue;

      const effectiveLoad = conn.node.currentLoad + (conn.node.pendingRequests * 10);
      if (effectiveLoad < bestLoad) {
        bestLoad = effectiveLoad;
        bestNode = conn.node;
      }
    }

    return bestNode;
  }

  /**
   * Get any available node
   */
  getAnyAvailableNode(): ConnectedNode | null {
    let bestNode: ConnectedNode | null = null;
    let bestLoad = Infinity;

    for (const conn of this.connections.values()) {
      if (!conn.node.active) continue;
      if (conn.node.pendingRequests >= conn.node.maxConcurrentRequests) continue;

      const effectiveLoad = conn.node.currentLoad + (conn.node.pendingRequests * 10);
      if (effectiveLoad < bestLoad) {
        bestLoad = effectiveLoad;
        bestNode = conn.node;
      }
    }

    return bestNode;
  }

  /**
   * Assign task to node and wait for result
   */
  async assignTask(
    nodeAddress: Address,
    taskPayload: TaskAssignPayload,
    timeoutMs: number
  ): Promise<TaskResultPayload> {
    const connectionId = this.nodeToConnection.get(nodeAddress);
    if (!connectionId) {
      throw new Error(`Node not connected: ${nodeAddress}`);
    }

    const conn = this.connections.get(connectionId);
    if (!conn) {
      throw new Error(`Connection not found: ${connectionId}`);
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        conn.pendingTasks.delete(taskPayload.taskId);
        conn.node.pendingRequests = Math.max(0, conn.node.pendingRequests - 1);
        reject(new Error('Task timeout'));
      }, timeoutMs);

      conn.pendingTasks.set(taskPayload.taskId, { resolve, reject, timeout });
      conn.node.pendingRequests++;

      this.sendMessage(conn.ws, {
        type: WsMessageType.TASK_ASSIGN,
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        payload: taskPayload,
      });
    });
  }

  /**
   * Get connected nodes count
   */
  getConnectedCount(): number {
    return this.connections.size;
  }

  /**
   * Get nodes by region count
   */
  getRegionCounts(): Record<RegionCode, number> {
    const counts: Record<string, number> = {};
    for (const [region, nodes] of this.regionNodes) {
      counts[region] = nodes.size;
    }
    return counts as Record<RegionCode, number>;
  }

  /**
   * Get all connected nodes
   */
  getConnectedNodes(): ConnectedNode[] {
    return Array.from(this.connections.values()).map((c) => c.node);
  }

  /**
   * Get available regions
   */
  getAvailableRegions(): RegionCode[] {
    const regions: RegionCode[] = [];
    for (const [region, nodes] of this.regionNodes) {
      if (nodes.size > 0) {
        // Check if at least one node is available
        for (const connectionId of nodes) {
          const conn = this.connections.get(connectionId);
          if (conn?.node.active) {
            regions.push(region);
            break;
          }
        }
      }
    }
    return regions;
  }

  private sendMessage(ws: ServerWebSocket<{ connectionId: string }>, message: WsMessage): void {
    ws.send(JSON.stringify(message));
  }
}

