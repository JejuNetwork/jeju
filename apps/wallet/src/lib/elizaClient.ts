/**
 * ElizaOS API Client
 * Handles communication with the ElizaOS agent server
 * 
 * The Network Wallet agent is an ElizaOS agent that can be run locally
 * or connected to a remote ElizaOS server.
 * 
 * This client is compatible with the @elizaos/api-client pattern used in otaku.
 */

const API_BASE_URL = import.meta.env.VITE_ELIZA_API_URL || 'http://localhost:3000';
const AGENT_ID = import.meta.env.VITE_ELIZA_AGENT_ID || 'jeju-wallet';

interface Agent {
  id: string;
  name: string;
  description?: string;
  settings?: Record<string, unknown>;
}

interface Message {
  id: string;
  content: string;
  authorId: string;
  channelId: string;
  createdAt: string | number;
  sourceType?: string;
  metadata?: Record<string, unknown>;
  rawMessage?: Record<string, unknown>;
}

interface Channel {
  id: string;
  name: string;
  serverId: string;
  metadata?: Record<string, unknown>;
}

interface ChatResponse {
  id: string;
  content: string;
  agentId: string;
  metadata?: Record<string, unknown>;
}

class ElizaClient {
  private authToken: string | null = null;
  private baseUrl: string;
  private agentId: string;
  private userId: string;
  private roomId: string | null = null;

  constructor(baseUrl: string = API_BASE_URL, agentId: string = AGENT_ID) {
    this.baseUrl = baseUrl;
    this.agentId = agentId;
    this.userId = this.getOrCreateUserId();
    this.authToken = this.getStorage('eliza-auth-token');
  }

  private getStorage(key: string): string | null {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(key);
    }
    return null;
  }

  private setStorage(key: string, value: string): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
    }
  }

  private removeStorage(key: string): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
    }
  }

  private getOrCreateUserId(): string {
    let userId = this.getStorage('eliza-user-id');
    if (!userId) {
      userId = `user-${crypto.randomUUID()}`;
      this.setStorage('eliza-user-id', userId);
    }
    return userId;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    return response.json();
  }

  setAuthToken(token: string) {
    this.authToken = token;
    this.setStorage('eliza-auth-token', token);
  }

  clearAuthToken() {
    this.authToken = null;
    this.removeStorage('eliza-auth-token');
  }

  // Chat API - primary interface for wallet
  async chat(message: string, walletContext?: Record<string, unknown>): Promise<ChatResponse> {
    // First ensure we have a room
    if (!this.roomId) {
      await this.initializeRoom();
    }

    // Send message to agent
    const response = await this.request<ChatResponse[]>(`/${this.agentId}/message`, {
      method: 'POST',
      body: JSON.stringify({
        text: message,
        userId: this.userId,
        roomId: this.roomId,
        metadata: walletContext,
      }),
    });

    // ElizaOS returns array of responses
    if (Array.isArray(response) && response.length > 0) {
      return {
        id: response[0].id || `eliza-${Date.now()}`,
        content: response.map(r => r.content || (r as { text?: string }).text || '').join('\n'),
        agentId: this.agentId,
        metadata: response[0].metadata,
      };
    }

    // Handle single response
    const singleResponse = response as unknown as { text?: string; content?: string; id?: string };
    return {
      id: singleResponse.id || `eliza-${Date.now()}`,
      content: singleResponse.text || singleResponse.content || '',
      agentId: this.agentId,
    };
  }

  private async initializeRoom(): Promise<void> {
    // Create or get existing room for this user
    this.roomId = `${this.userId}-${this.agentId}`;
  }

  // Check if ElizaOS server is available
  async isAvailable(): Promise<boolean> {
    const response = await fetch(`${this.baseUrl}/health`, { method: 'GET' });
    return response.ok;
  }

  // Get available agents
  async getAgents(): Promise<Agent[]> {
    const response = await this.request<{ agents: Agent[] }>('/api/agents');
    if (!response.agents) {
      throw new Error('Invalid agents response: missing agents array');
    }
    return response.agents;
  }

  // Agent APIs
  agents = {
    listAgents: () => this.request<{ agents: Agent[] }>('/api/agents'),
    getAgent: (agentId: string) => this.request<Agent>(`/api/agents/${agentId}`),
  };

  // Messaging APIs
  messaging = {
    createServer: (data: { id: string; name: string; sourceType: string; sourceId: string; metadata?: Record<string, unknown> }) =>
      this.request<{ id: string }>('/api/messaging/servers', { method: 'POST', body: JSON.stringify(data) }),

    addAgentToServer: (serverId: string, agentId: string) =>
      this.request(`/api/messaging/servers/${serverId}/agents`, { method: 'POST', body: JSON.stringify({ agentId }) }),

    getServerChannels: (serverId: string) =>
      this.request<{ channels: Channel[] }>(`/api/messaging/servers/${serverId}/channels`),

    createGroupChannel: (data: { name: string; participantIds: string[]; metadata?: Record<string, unknown> }) =>
      this.request<Channel>('/api/messaging/channels', { method: 'POST', body: JSON.stringify(data) }),

    getChannelMessages: (channelId: string, options?: { limit?: number; before?: string }) => {
      const params = new URLSearchParams();
      if (options?.limit) params.set('limit', options.limit.toString());
      if (options?.before) params.set('before', options.before);
      return this.request<{ messages: Message[] }>(`/api/messaging/channels/${channelId}/messages?${params}`);
    },

    generateChannelTitle: (message: string, agentId: string) =>
      this.request<{ title: string }>('/api/messaging/generate-title', {
        method: 'POST',
        body: JSON.stringify({ message, agentId }),
      }),
  };

  // Auth APIs (if needed)
  auth = {
    login: (data: { email: string; username: string; cdpUserId?: string }) =>
      this.request<{ token: string; userId: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  };

  // Entity APIs
  entities = {
    getEntity: (entityId: string) => this.request<{ id: string; metadata?: Record<string, unknown> }>(`/api/entities/${entityId}`),
    createEntity: (data: Record<string, unknown>) =>
      this.request<{ id: string; metadata?: Record<string, unknown> }>('/api/entities', { method: 'POST', body: JSON.stringify(data) }),
    updateEntity: (entityId: string, data: Record<string, unknown>) =>
      this.request<{ id: string; metadata?: Record<string, unknown> }>(`/api/entities/${entityId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
  };
}

export const elizaClient = new ElizaClient();
export { ElizaClient };
export type { Agent, Message, Channel, ChatResponse };

