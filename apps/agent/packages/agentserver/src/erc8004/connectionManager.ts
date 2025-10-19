/**
 * Service Connection Manager
 * Manages WebSocket connections to ERC-8004 services
 */

import type { Service, ServiceConnection, AgentCard } from './types';
import type { ERC8004RegistryClient } from './registry';

export class ServiceConnectionManager {
  private connections: Map<bigint, ServiceConnection> = new Map();
  private registryClient: ERC8004RegistryClient;

  constructor(registryClient: ERC8004RegistryClient) {
    this.registryClient = registryClient;
  }

  async connect(serviceId: bigint): Promise<ServiceConnection> {
    // Check if already connected
    const existing = this.connections.get(serviceId);
    if (existing?.connected) {
      return existing;
    }

    // Get service details
    const service = await this.registryClient.getService(serviceId);
    if (!service) {
      throw new Error(`Service ${serviceId} not found`);
    }

    // Fetch agent card to get connection details
    const agentCard = await this.registryClient.fetchAgentCard(service.url);
    if (!agentCard) {
      throw new Error(`Failed to fetch agent card for service ${serviceId}`);
    }

    // Create WebSocket connection if available
    let websocket: WebSocket | undefined;
    if (agentCard.endpoints.websocket) {
      websocket = new WebSocket(agentCard.endpoints.websocket);
      
      await new Promise<void>((resolve, reject) => {
        websocket!.onopen = () => resolve();
        websocket!.onerror = (error) => reject(error);
        
        // Timeout after 5 seconds
        setTimeout(() => reject(new Error('Connection timeout')), 5000);
      });
    }

    const connection: ServiceConnection = {
      serviceId,
      service,
      websocket,
      connected: true,
      connectedAt: new Date()
    };

    this.connections.set(serviceId, connection);
    console.log(`[ServiceConnection] Connected to ${service.name} (${serviceId})`);

    return connection;
  }

  async disconnect(serviceId: bigint): Promise<void> {
    const connection = this.connections.get(serviceId);
    if (!connection) return;

    if (connection.websocket) {
      connection.websocket.close();
    }

    connection.connected = false;
    this.connections.delete(serviceId);
    
    console.log(`[ServiceConnection] Disconnected from service ${serviceId}`);
  }

  async sendMessage(serviceId: bigint, message: string): Promise<Response | null> {
    const connection = this.connections.get(serviceId);
    if (!connection?.connected) {
      throw new Error(`Not connected to service ${serviceId}`);
    }

    // Send via WebSocket if available
    if (connection.websocket && connection.websocket.readyState === WebSocket.OPEN) {
      connection.websocket.send(JSON.stringify({
        type: 'message',
        content: message,
        timestamp: Date.now()
      }));
      
      return new Promise((resolve) => {
        const handler = (event: MessageEvent) => {
          connection.websocket!.removeEventListener('message', handler);
          resolve(new Response(event.data));
        };
        connection.websocket!.addEventListener('message', handler);
      });
    }

    // Fallback to REST if available
    const agentCard = await this.registryClient.fetchAgentCard(connection.service.url);
    if (agentCard?.endpoints.rest) {
      const response = await fetch(`${agentCard.endpoints.rest}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
      });
      return response;
    }

    throw new Error('No available communication method');
  }

  getConnection(serviceId: bigint): ServiceConnection | undefined {
    return this.connections.get(serviceId);
  }

  getAllConnections(): ServiceConnection[] {
    return Array.from(this.connections.values());
  }

  isConnected(serviceId: bigint): boolean {
    return this.connections.get(serviceId)?.connected ?? false;
  }

  disconnectAll(): void {
    for (const [serviceId] of this.connections) {
      this.disconnect(serviceId);
    }
  }
}

