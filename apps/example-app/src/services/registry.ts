/**
 * OAuth3 Registry Service
 *
 * Interacts with on-chain registries for:
 * - App registration and discovery
 * - TEE node registration and health checks
 */

import {
  createPublicClient,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import {
  AuthProvider,
  type OAuth3App,
  type TEENodeInfo,
  type TEEAttestation,
  TEEProvider,
} from '@jejunetwork/oauth3';
import { getNetworkName } from '@jejunetwork/config';
import { expectValid } from '../utils/validation';
import { z } from 'zod';
import { AddressSchema } from '@jejunetwork/types/validation';

// Chain IDs for different networks - unused for now but kept for future contract integration
// const CHAIN_IDS: Record<string, number> = {
//   localnet: 420691,  // Jeju localnet
//   testnet: 420690,   // Jeju testnet (Base Sepolia)
//   mainnet: 8453,     // Jeju mainnet (Base)
// };

// Default contract addresses - kept for future contract integration
// const DEFAULT_CONTRACTS: Record<string, Address> = {
//   appRegistry: '0x5FbDB2315678afecb367f032d93F642f64180aa3' as Address,
//   identityRegistry: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512' as Address,
//   teeVerifier: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0' as Address,
// };

export interface RegistryService {
  registerApp(app: Partial<OAuth3App>): Promise<Hex>;
  getApp(appId: Hex | string): Promise<OAuth3App | null>;
  registerTEENode(node: Partial<TEENodeInfo>): Promise<Hex>;
  getTEENode(nodeId: Address): Promise<TEENodeInfo | null>;
  getActiveNodes(): Promise<TEENodeInfo[]>;
  isHealthy(): Promise<boolean>;
}

type NetworkType = 'localnet' | 'testnet' | 'mainnet';

function getNetworkType(name: string): NetworkType {
  if (name === 'localnet') return 'localnet';
  if (name === 'testnet') return 'testnet';
  return 'mainnet';
}

// Future: Contract address resolution for production registry interactions
// function getContractAddress(name: keyof typeof DEFAULT_CONTRACTS): Address {
//   const envKey = `OAUTH3_${name.toUpperCase()}_ADDRESS`;
//   return (process.env[envKey] as Address) || DEFAULT_CONTRACTS[name];
// }

class RegistryServiceImpl implements RegistryService {
  private publicClient: PublicClient;
  private networkType: NetworkType;

  constructor() {
    const networkName = getNetworkName();
    this.networkType = getNetworkType(networkName);

    this.publicClient = createPublicClient({
      transport: http(process.env.L2_RPC_URL || 'http://localhost:9545'),
    });
  }

  async registerApp(app: Partial<OAuth3App>): Promise<Hex> {
    const validatedApp = expectValid(
      z.object({
        name: z.string().optional(),
        jnsName: z.string().optional(),
        owner: AddressSchema.optional(),
        redirectUris: z.array(z.string().url()).optional(),
        allowedProviders: z.array(z.nativeEnum(AuthProvider)).optional(),
      }),
      app,
      'App registration data'
    );

    // In production, this would submit a transaction signed by the app owner
    // For dev/testing, we log and return a mock tx hash
    console.log(`[Registry] Registering app: ${validatedApp.name || validatedApp.jnsName}`);
    console.log(`  Owner: ${validatedApp.owner}`);
    console.log(`  Redirect URIs: ${validatedApp.redirectUris?.join(', ')}`);
    console.log(`  Allowed Providers: ${validatedApp.allowedProviders?.join(', ')}`);

    // Return mock transaction hash
    return `0x${Date.now().toString(16).padStart(64, '0')}` as Hex;
  }

  async getApp(appId: Hex | string): Promise<OAuth3App | null> {
    if (!appId) {
      throw new Error('App ID is required');
    }

    // For localnet/testing, return a mock app
    if (this.networkType === 'localnet') {
      console.log(`[Registry] Returning mock app for: ${appId}`);
      return this.getMockApp(appId);
    }

    // Read from on-chain registry
    const blockNumber = await this.publicClient.getBlockNumber();
    console.log(`[Registry] Chain accessible at block ${blockNumber}`);

    // In production, would read from actual contract
    // For now, return mock for non-localnet too
    return this.getMockApp(appId);
  }

  private getMockApp(appId: Hex | string): OAuth3App {
    const frontendPort = process.env.FRONTEND_PORT || '4501';
    return {
      appId: (typeof appId === 'string' && !appId.startsWith('0x')
        ? `0x${Buffer.from(appId).toString('hex').padEnd(64, '0')}`
        : appId) as Hex,
      name: 'Decentralized App Template',
      description: 'A template for decentralized applications on Jeju Network',
      owner: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address,
      council: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address,
      redirectUris: [`http://localhost:${frontendPort}/oauth3/callback`],
      allowedProviders: [AuthProvider.WALLET, AuthProvider.GITHUB, AuthProvider.FARCASTER],
      jnsName: 'example-app.oauth3.jeju',
      createdAt: Date.now(),
      active: true,
      metadata: {
        logoUri: '',
        policyUri: '',
        termsUri: '',
        supportEmail: '',
        webhookUrl: '',
      },
    };
  }

  async registerTEENode(node: Partial<TEENodeInfo>): Promise<Hex> {
    const validatedNode = expectValid(
      z.object({
        nodeId: AddressSchema.optional(),
        endpoint: z.string().url().optional(),
        provider: z.nativeEnum(TEEProvider).optional(),
        stake: z.bigint().optional(),
      }),
      node,
      'TEE node registration data'
    );

    console.log(`[Registry] Registering TEE node: ${validatedNode.nodeId}`);
    console.log(`  Endpoint: ${validatedNode.endpoint}`);
    console.log(`  Provider: ${validatedNode.provider}`);
    console.log(`  Stake: ${validatedNode.stake}`);

    return `0x${Date.now().toString(16).padStart(64, '0')}` as Hex;
  }

  async getTEENode(nodeId: Address): Promise<TEENodeInfo | null> {
    expectValid(AddressSchema, nodeId, 'Node ID');

    // For localnet/testing, return a mock node
    if (this.networkType === 'localnet') {
      console.log(`[Registry] Returning mock TEE node for: ${nodeId}`);
      return this.getMockTEENode(nodeId);
    }

    return null;
  }

  private getMockTEENode(nodeId: Address): TEENodeInfo {
    const teeAgentUrl = process.env.OAUTH3_TEE_AGENT_URL || 'http://localhost:8004';
    return {
      nodeId: nodeId,
      endpoint: teeAgentUrl,
      provider: TEEProvider.SIMULATED,
      attestation: {
        quote: '0x00' as Hex,
        measurement: '0x00' as Hex,
        reportData: '0x00' as Hex,
        timestamp: Date.now(),
        provider: TEEProvider.SIMULATED,
        verified: true,
      } as TEEAttestation,
      publicKey: '0x00' as Hex,
      stake: BigInt(1e18),
      active: true,
    };
  }

  async getActiveNodes(): Promise<TEENodeInfo[]> {
    // For localnet, return mock nodes
    if (this.networkType === 'localnet') {
      return [
        this.getMockTEENode('0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address),
      ];
    }

    return [];
  }

  async isHealthy(): Promise<boolean> {
    try {
      // Try to get block number to verify RPC connectivity
      const blockNumber = await this.publicClient.getBlockNumber();
      console.log(`[Registry] Health check passed. Current block: ${blockNumber}`);
      return true;
    } catch (error) {
      // For localnet without running node, mock success
      if (this.networkType === 'localnet') {
        console.log('[Registry] Health check: localnet mock (RPC may not be available)');
        return true;
      }
      console.error('[Registry] Health check failed:', error);
      return false;
    }
  }
}

let registryService: RegistryService | null = null;

export function getRegistryService(): RegistryService {
  if (!registryService) {
    registryService = new RegistryServiceImpl();
  }
  return registryService;
}

export function resetRegistryService(): void {
  registryService = null;
}
