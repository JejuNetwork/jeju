/**
 * ElizaOS API Client
 * Handles communication with the ElizaOS agent server
 */

const API_BASE_URL = import.meta.env.VITE_ELIZA_API_URL || 'http://localhost:3000';

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

class ElizaClient {
  private authToken: string | null = null;
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
    this.authToken = localStorage.getItem('eliza-auth-token');
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
    localStorage.setItem('eliza-auth-token', token);
  }

  clearAuthToken() {
    this.authToken = null;
    localStorage.removeItem('eliza-auth-token');
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
export type { Agent, Message, Channel };

