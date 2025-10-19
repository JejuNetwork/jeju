/**
 * ERC-8004 Registry Integration for eHorse
 * Registers the game to IdentityRegistry on startup
 */

import { ethers, Contract, Wallet, JsonRpcProvider } from 'ethers';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const IDENTITY_REGISTRY_ABI = [
  'function register(string memory tokenURI) external returns (uint256 agentId)',
  'function balanceOf(address owner) external view returns (uint256)',
  'function totalAgents() external view returns (uint256)',
  'event Registered(uint256 indexed agentId, address indexed agentAddress, string tokenURI, uint256 timestamp)'
];

export interface RegistrationResult {
  registered: boolean;
  agentId?: bigint;
  agentDomain?: string;
  transactionHash?: string;
  error?: string;
}

export class RegistryClient {
  private provider: JsonRpcProvider;
  private wallet: Wallet;
  private registry: Contract | null = null;

  constructor(rpcUrl: string, privateKey: string) {
    this.provider = new JsonRpcProvider(rpcUrl);
    this.wallet = new Wallet(privateKey, this.provider);
  }

  async initialize(): Promise<void> {
    // Try to load IdentityRegistry from contracts deployment
    const possiblePaths = [
      join(process.cwd(), '../../contracts/IdentityRegistry.json'),
      join(process.cwd(), '../../../contracts/IdentityRegistry.json')
    ];

    let registryData: { address?: string; abi?: unknown } | null = null;

    for (const path of possiblePaths) {
      if (existsSync(path)) {
        registryData = JSON.parse(readFileSync(path, 'utf-8'));
        break;
      }
    }

    if (!registryData?.address || !registryData?.abi) {
      console.log('⚠️  IdentityRegistry not found - skipping ERC-8004 registration');
      return;
    }

    this.registry = new Contract(
      registryData.address,
      registryData.abi,
      this.wallet
    );

    console.log(`📝 IdentityRegistry loaded: ${registryData.address}`);
  }

  async registerGame(gameName: string, serverUrl: string): Promise<RegistrationResult> {
    if (!this.registry) {
      return { registered: false, error: 'Registry not initialized' };
    }

    // Check if already registered
    const balance = await this.registry.balanceOf(this.wallet.address).catch(() => 0n);
    
    if (balance > 0n) {
      console.log('✅ Already registered to ERC-8004');
      return {
        registered: true,
        agentDomain: `${gameName}.ehorse.jeju`
      };
    }

    // Register with metadata
    const domain = `${gameName}.ehorse.jeju`;
    const metadata = JSON.stringify({
      type: 'game-server',
      name: gameName,
      url: serverUrl,
      category: 'racing'
    });

    console.log(`🔄 Registering ${gameName} to ERC-8004...`);

    const tx = await this.registry['register(string)'](metadata);
    const receipt = await tx.wait();

    // Extract agentId from event
    const event = receipt.logs
      .map((log: ethers.Log) => {
        return this.registry!.interface.parseLog({
          topics: log.topics as string[],
          data: log.data
        });
      })
      .find((e: ethers.LogDescription | null) => e?.name === 'Registered');

    const agentId = event?.args?.agentId;

    console.log(`✅ Registered to ERC-8004: ID=${agentId}`);

    return {
      registered: true,
      agentId,
      agentDomain: domain,
      transactionHash: receipt.hash
    };
  }

  getWalletAddress(): string {
    return this.wallet.address;
  }

  isEnabled(): boolean {
    return this.registry !== null;
  }
}



