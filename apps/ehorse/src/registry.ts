/**
 * ERC-8004 Registry Integration for eHorse
 * Registers the game to IdentityRegistry on startup
 */

import { ethers, Contract, Wallet, JsonRpcProvider } from 'ethers';

export interface RegistrationResult {
  registered: boolean;
  agentId?: bigint;
  agentDomain?: string;
  transactionHash?: string;
  error?: string;
}

const IDENTITY_REGISTRY_ABI = [
  'function register(string memory tokenURI) external returns (uint256 agentId)',
  'function balanceOf(address owner) external view returns (uint256)',
  'function totalAgents() external view returns (uint256)',
  'function setMetadata(uint256 agentId, string memory key, bytes memory value) external',
  'event Registered(uint256 indexed agentId, address indexed agentAddress, string tokenURI, uint256 timestamp)'
];

export class RegistryClient {
  private provider: JsonRpcProvider;
  private wallet: Wallet;
  private registry: Contract | null = null;
  private registryAddress: string;

  constructor(rpcUrl: string, privateKey: string, registryAddress: string) {
    this.provider = new JsonRpcProvider(rpcUrl);
    this.wallet = new Wallet(privateKey, this.provider);
    this.registryAddress = registryAddress;
  }

  async initialize(): Promise<void> {
    if (!this.registryAddress) {
      console.log('⚠️  IdentityRegistry address not provided - skipping ERC-8004 registration');
      return;
    }

    this.registry = new Contract(
      this.registryAddress,
      IDENTITY_REGISTRY_ABI,
      this.wallet
    );

    console.log(`📝 IdentityRegistry loaded: ${this.registryAddress}`);
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
      type: 'tee-oracle',
      subtype: 'contest',
      name: 'eHorse Racing',
      category: 'racing',
      description: 'TEE-based horse racing oracle for prediction markets',
      url: serverUrl,
      a2a_card: `${serverUrl}/.well-known/agent-card.json`,
      oracle_type: 'contest',
      implements: ['IPredictionOracle', 'ContestOracle'],
      version: '2.0.0'
    });

    console.log(`🔄 Registering ${gameName} to ERC-8004...`);
    console.log(`   Metadata: ${metadata}`);

    const tx = await this.registry.register(metadata);
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



