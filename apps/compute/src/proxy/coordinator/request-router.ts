/**
 * Request Router - Routes proxy requests to nodes or external providers
 * @module @jeju/proxy/coordinator/request-router
 */

import type {
  Address,
  RegionCode,
  ProxyRequest,
  ProxyResponse,
  ConnectedNode,
  ExternalProxyProvider,
  TaskAssignPayload,
  TaskResultPayload,
} from '../types';
import type { NodeManager } from './node-manager';

interface RouterConfig {
  requestTimeoutMs: number;
  maxRetries: number;
  externalFallbackEnabled: boolean;
}

interface RouteResult {
  success: boolean;
  response?: ProxyResponse;
  routedTo: 'internal' | 'external';
  nodeAddress?: Address;
  providerName?: string;
  error?: string;
  bytesTransferred: number;
  latencyMs: number;
}

export class RequestRouter {
  private nodeManager: NodeManager;
  private externalProviders: Map<string, ExternalProxyProvider> = new Map();
  private config: RouterConfig;
  private providerPriority: string[] = [];

  constructor(nodeManager: NodeManager, config: RouterConfig) {
    this.nodeManager = nodeManager;
    this.config = config;
  }

  /**
   * Register an external provider for fallback
   */
  registerExternalProvider(provider: ExternalProxyProvider, priority: number): void {
    this.externalProviders.set(provider.name, provider);
    
    // Maintain priority order
    this.providerPriority.push(provider.name);
    this.providerPriority.sort((a, b) => {
      const provA = this.externalProviders.get(a);
      const provB = this.externalProviders.get(b);
      if (!provA || !provB) return 0;
      return priority - priority; // Placeholder - should store priority
    });

    console.log('[RequestRouter] Registered external provider:', provider.name);
  }

  /**
   * Route a proxy request
   */
  async route(request: ProxyRequest, regionCode: RegionCode): Promise<RouteResult> {
    const startTime = Date.now();
    let lastError: string | undefined;

    // Try internal nodes first
    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      const node = this.nodeManager.getAvailableNode(regionCode);
      
      if (node) {
        const result = await this.routeToNode(request, node);
        if (result.success) {
          return {
            ...result,
            routedTo: 'internal',
            nodeAddress: node.address,
            latencyMs: Date.now() - startTime,
          };
        }
        lastError = result.error;
      } else {
        // No node available for this region, try any node
        const anyNode = this.nodeManager.getAnyAvailableNode();
        if (anyNode) {
          console.log('[RequestRouter] No node for region', regionCode, ', trying any node');
          const result = await this.routeToNode(request, anyNode);
          if (result.success) {
            return {
              ...result,
              routedTo: 'internal',
              nodeAddress: anyNode.address,
              latencyMs: Date.now() - startTime,
            };
          }
          lastError = result.error;
        }
        break;
      }
    }

    // Fallback to external providers if enabled
    if (this.config.externalFallbackEnabled) {
      const externalResult = await this.routeToExternal(request, regionCode);
      if (externalResult) {
        return {
          ...externalResult,
          routedTo: 'external',
          latencyMs: Date.now() - startTime,
        };
      }
    }

    return {
      success: false,
      routedTo: 'internal',
      error: lastError || 'No available nodes or providers',
      bytesTransferred: 0,
      latencyMs: Date.now() - startTime,
    };
  }

  /**
   * Route request to internal node
   */
  private async routeToNode(request: ProxyRequest, node: ConnectedNode): Promise<RouteResult> {
    const taskPayload: TaskAssignPayload = {
      taskId: crypto.randomUUID(),
      request,
      deadline: Date.now() + this.config.requestTimeoutMs,
    };

    try {
      const result = await this.nodeManager.assignTask(
        node.address,
        taskPayload,
        this.config.requestTimeoutMs
      );

      if (result.success && result.response) {
        return {
          success: true,
          response: result.response,
          routedTo: 'internal',
          nodeAddress: node.address,
          bytesTransferred: result.response.bytesTransferred,
          latencyMs: result.response.latencyMs,
        };
      }

      return {
        success: false,
        routedTo: 'internal',
        error: result.error || 'Node returned error',
        bytesTransferred: 0,
        latencyMs: 0,
      };
    } catch (err) {
      return {
        success: false,
        routedTo: 'internal',
        error: err instanceof Error ? err.message : 'Unknown error',
        bytesTransferred: 0,
        latencyMs: 0,
      };
    }
  }

  /**
   * Route request to external provider
   */
  private async routeToExternal(
    request: ProxyRequest,
    regionCode: RegionCode
  ): Promise<RouteResult | null> {
    for (const providerName of this.providerPriority) {
      const provider = this.externalProviders.get(providerName);
      if (!provider) continue;

      try {
        const isAvailable = await provider.isAvailable();
        if (!isAvailable) continue;

        const supportedRegions = await provider.getSupportedRegions();
        if (!supportedRegions.includes(regionCode)) continue;

        const response = await provider.fetchViaProxy(request, regionCode);
        
        return {
          success: true,
          response,
          routedTo: 'external',
          providerName,
          bytesTransferred: response.bytesTransferred,
          latencyMs: response.latencyMs,
        };
      } catch (err) {
        console.warn('[RequestRouter] External provider failed:', providerName, err);
        continue;
      }
    }

    return null;
  }

  /**
   * Get routing stats
   */
  getStats(): {
    connectedNodes: number;
    availableRegions: RegionCode[];
    externalProviders: string[];
  } {
    return {
      connectedNodes: this.nodeManager.getConnectedCount(),
      availableRegions: this.nodeManager.getAvailableRegions(),
      externalProviders: Array.from(this.externalProviders.keys()),
    };
  }

  /**
   * Check if region is available (internal or external)
   */
  async isRegionAvailable(regionCode: RegionCode): Promise<{ available: boolean; source: 'internal' | 'external' | 'none' }> {
    // Check internal nodes first
    const node = this.nodeManager.getAvailableNode(regionCode);
    if (node) {
      return { available: true, source: 'internal' };
    }

    // Check external providers
    for (const provider of this.externalProviders.values()) {
      try {
        const regions = await provider.getSupportedRegions();
        if (regions.includes(regionCode)) {
          const isAvailable = await provider.isAvailable();
          if (isAvailable) {
            return { available: true, source: 'external' };
          }
        }
      } catch {
        continue;
      }
    }

    return { available: false, source: 'none' };
  }
}

