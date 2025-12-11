/**
 * TEE Gateway
 */

import type {
  TEEGateway as ITEEGateway,
  TEEProvider,
  TEENode,
  TEENodeStatus,
  TEEProvisionRequest,
  TEEProvisionResult,
} from './tee-interface';
import { TEEProviderType } from './tee-interface';

export class TEEGateway implements ITEEGateway {
  private providers: Map<TEEProviderType, TEEProvider> = new Map();

  registerProvider(provider: TEEProvider): void {
    this.providers.set(provider.getProviderType(), provider);
  }

  async getEndpoint(request: TEEProvisionRequest): Promise<TEEProvisionResult> {
    if (request.providerType) {
      const provider = this.providers.get(request.providerType);
      if (provider && provider.isAvailable()) {
        return provider.getEndpoint(request);
      }
    }
    const preferredOrder = [
      TEEProviderType.PHALA,
      TEEProviderType.MARLIN,
      TEEProviderType.OASIS,
      TEEProviderType.AWS_NITRO,
      TEEProviderType.AZURE_CONFIDENTIAL,
      TEEProviderType.GOOGLE_CONFIDENTIAL,
      TEEProviderType.CLOUDFLARE_WORKERS,
    ];

    for (const providerType of preferredOrder) {
      const provider = this.providers.get(providerType);
      if (!provider || !provider.isAvailable()) continue;

      if (request.requireSecure) {
        const caps = provider.getCapabilities();
        if (!caps.isSecure) continue;
      }

      try {
        return await provider.getEndpoint(request);
      } catch (error) {
        continue;
      }
    }

    throw new Error('No available TEE provider found');
  }

  async listNodes(providerType?: TEEProviderType): Promise<TEENode[]> {
    const allNodes: TEENode[] = [];

    if (providerType) {
      const provider = this.providers.get(providerType);
      if (provider && provider.isAvailable()) {
        const nodes = await provider.listNodes();
        allNodes.push(...nodes);
      }
    } else {
      for (const provider of this.providers.values()) {
        if (!provider.isAvailable()) continue;
        const nodes = await provider.listNodes();
        allNodes.push(...nodes);
      }
    }

    return allNodes;
  }

  async getNode(nodeId: string): Promise<TEENode | null> {
    for (const provider of this.providers.values()) {
      if (!provider.isAvailable()) continue;
      const node = await provider.getNode(nodeId);
      if (node) return node;
    }
    return null;
  }

  async deprovision(nodeId: string): Promise<void> {
    for (const provider of this.providers.values()) {
      if (!provider.isAvailable()) continue;
      const node = await provider.getNode(nodeId);
      if (node) {
        await provider.deprovision(nodeId);
        return;
      }
    }
    throw new Error(`Node ${nodeId} not found`);
  }

  getStats(): {
    totalNodes: number;
    nodesByProvider: Record<TEEProviderType, number>;
    nodesByStatus: Record<TEENodeStatus, number>;
    averageColdStartMs: number;
  } {
    return {
      totalNodes: 0,
      nodesByProvider: {} as Record<TEEProviderType, number>,
      nodesByStatus: {} as Record<TEENodeStatus, number>,
      averageColdStartMs: 0,
    };
  }
}

