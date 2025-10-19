/**
 * Registry Service - Manages app discovery and A2A connections
 */

import { Service, type IAgentRuntime } from '@elizaos/core';
import { createPublicClient, http, type Address } from 'viem';
import { type DiscoveredApp, type A2AAgentCard, type ConnectedApp, REGISTRY_ABI } from './types';

export class RegistryService extends Service {
  public static serviceType = 'registry';
  
  private client: ReturnType<typeof createPublicClient>;
  private registryAddress: Address;
  private discoveredApps: Map<bigint, DiscoveredApp> = new Map();
  private connectedApps: Map<bigint, ConnectedApp> = new Map();
  private agentCards: Map<string, A2AAgentCard> = new Map();

  public get capabilityDescription(): string {
    return 'Discovers and connects to apps via ERC-8004 registry';
  }

  static async start(runtime: IAgentRuntime): Promise<RegistryService> {
    const service = new RegistryService(runtime);
    await service.initialize();
    return service;
  }

  constructor(runtime: IAgentRuntime) {
    super(runtime);
    
    const rpcUrl = runtime.getSetting('RPC_URL') || 'http://localhost:9545';
    const registryAddr = runtime.getSetting('IDENTITY_REGISTRY_ADDRESS');
    
    if (!registryAddr) {
      throw new Error('IDENTITY_REGISTRY_ADDRESS not configured');
    }
    
    this.registryAddress = registryAddr as Address;
    
    this.client = createPublicClient({
      transport: http(rpcUrl),
    });
  }

  private async initialize(): Promise<void> {
    this.runtime.logger.info('[Registry Service] Initializing...');
    
    // Discover all apps on startup
    await this.discoverAllApps();
    
    this.runtime.logger.info(`[Registry Service] Discovered ${this.discoveredApps.size} apps`);
  }

  async discoverAllApps(): Promise<DiscoveredApp[]> {
    const agentIds = await this.client.readContract({
      address: this.registryAddress,
      abi: REGISTRY_ABI,
      functionName: 'getAllAgents',
      args: [0n, 100n], // First 100 apps
    }) as bigint[];

    const apps: DiscoveredApp[] = [];

    for (const agentId of agentIds) {
      const app = await this.getAppDetails(agentId);
      if (app) {
        this.discoveredApps.set(agentId, app);
        apps.push(app);
      }
    }

    return apps;
  }

  async discoverAppsByTag(tag: string): Promise<DiscoveredApp[]> {
    const agentIds = await this.client.readContract({
      address: this.registryAddress,
      abi: REGISTRY_ABI,
      functionName: 'getAgentsByTag',
      args: [tag],
    }) as bigint[];

    const apps: DiscoveredApp[] = [];

    for (const agentId of agentIds) {
      let app = this.discoveredApps.get(agentId);
      if (!app) {
        app = await this.getAppDetails(agentId);
        if (app) {
          this.discoveredApps.set(agentId, app);
        }
      }
      if (app) {
        apps.push(app);
      }
    }

    return apps;
  }

  async getAppDetails(agentId: bigint): Promise<DiscoveredApp | null> {
    const tokenURI = await this.client.readContract({
      address: this.registryAddress,
      abi: REGISTRY_ABI,
      functionName: 'tokenURI',
      args: [agentId],
    }) as string;

    const tags = await this.client.readContract({
      address: this.registryAddress,
      abi: REGISTRY_ABI,
      functionName: 'getAgentTags',
      args: [agentId],
    }) as string[];

    const a2aEndpointBytes = await this.client.readContract({
      address: this.registryAddress,
      abi: REGISTRY_ABI,
      functionName: 'getMetadata',
      args: [agentId, 'a2a-endpoint'],
    }) as `0x${string}`;

    const owner = await this.client.readContract({
      address: this.registryAddress,
      abi: REGISTRY_ABI,
      functionName: 'ownerOf',
      args: [agentId],
    }) as string;

    // Parse tokenURI JSON
    let metadata: { name?: string; description?: string } = {};
    if (tokenURI) {
      metadata = JSON.parse(tokenURI);
    }

    // Decode A2A endpoint
    let a2aEndpoint: string | undefined;
    if (a2aEndpointBytes && a2aEndpointBytes !== '0x') {
      const hex = a2aEndpointBytes.slice(2);
      a2aEndpoint = Buffer.from(hex, 'hex').toString('utf8');
    }

    return {
      agentId,
      name: metadata.name || `Agent ${agentId}`,
      description: metadata.description,
      owner,
      tags,
      a2aEndpoint,
      stakeToken: 'Unknown',
      stakeAmount: 0n,
    };
  }

  async connectToApp(agentId: bigint): Promise<ConnectedApp | null> {
    const app = this.discoveredApps.get(agentId) || await this.getAppDetails(agentId);
    if (!app || !app.a2aEndpoint) {
      this.runtime.logger.error(`[Registry Service] App ${agentId} has no A2A endpoint`);
      return null;
    }

    // Fetch agent card
    const cardUrl = new URL('/.well-known/agent-card.json', app.a2aEndpoint).toString();
    
    let agentCard: A2AAgentCard | null = null;
    if (this.agentCards.has(cardUrl)) {
      agentCard = this.agentCards.get(cardUrl)!;
    } else {
      const response = await fetch(cardUrl);
      if (response.ok) {
        agentCard = await response.json();
        this.agentCards.set(cardUrl, agentCard);
      }
    }

    if (!agentCard) {
      this.runtime.logger.error(`[Registry Service] Failed to fetch agent card from ${cardUrl}`);
      return null;
    }

    const connectedApp: ConnectedApp = {
      agentId: app.agentId,
      name: app.name,
      endpoint: app.a2aEndpoint,
      capabilities: agentCard.skills.map((s) => ({
        skillId: s.id,
        name: s.name,
        description: s.description,
      })),
      connectedAt: new Date(),
    };

    this.connectedApps.set(agentId, connectedApp);
    
    this.runtime.logger.info(`[Registry Service] Connected to ${app.name} (${agentCard.skills.length} skills)`);

    return connectedApp;
  }

  async callSkill(agentId: bigint, skillId: string, parameters?: Record<string, unknown>): Promise<unknown> {
    const app = this.connectedApps.get(agentId);
    if (!app) {
      throw new Error(`Not connected to app ${agentId}. Call connectToApp first.`);
    }

    const response = await fetch(app.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            messageId: `msg-${Date.now()}`,
            parts: [
              { kind: 'data', data: { skillId, ...parameters } },
            ],
          },
        },
        id: Date.now(),
      }),
    });

    const result = await response.json();
    
    if (result.error) {
      throw new Error(`A2A call failed: ${result.error.message}`);
    }

    return result.result;
  }

  getDiscoveredApps(): DiscoveredApp[] {
    return Array.from(this.discoveredApps.values());
  }

  getConnectedApps(): ConnectedApp[] {
    return Array.from(this.connectedApps.values());
  }

  getAppsByTag(tag: string): DiscoveredApp[] {
    return this.getDiscoveredApps().filter((app) => app.tags.includes(tag));
  }

  async stop(): Promise<void> {
    this.discoveredApps.clear();
    this.connectedApps.clear();
    this.agentCards.clear();
    this.runtime.logger.info('[Registry Service] Stopped');
  }
}

