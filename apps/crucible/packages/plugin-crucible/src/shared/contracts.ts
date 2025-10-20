import { Service, type IAgentRuntime } from '@elizaos/core';
import { ethers } from 'ethers';

/**
 * Contract ABIs for all Jeju Network contracts
 */
export const ABIS = {
  // Governance
  REGISTRY_GOVERNANCE: [
    'function proposeBan(uint256 agentId, string reason) external payable returns (bytes32)',
    'function proposeSlash(uint256 agentId, uint256 slashPercentageBPS, string reason) external payable returns (bytes32)',
    'function approveProposal(bytes32 proposalId) external',
    'function finalizeProposal(bytes32 proposalId) external',
    'function submitAppeal(bytes32 proposalId, string evidence) external payable returns (bytes32)',
    'function voteOnAppeal(bytes32 appealId, bool approve) external',
    'function proposals(bytes32) external view returns (tuple)',
    'function guardians(address) external view returns (tuple)',
    'event ProposalCreated(bytes32 indexed proposalId, uint8 proposalType, uint256 indexed targetAgentId, address indexed proposer, bytes32 yesMarketId, bytes32 noMarketId)'
  ],
  
  // Moderation
  UNIFIED_REPORTING: [
    'function submitReport(uint256 targetAgentId, uint8 reportType, uint8 severity, bytes32 evidenceHash, string details) external payable returns (uint256)',
    'function resolveReport(uint256 reportId) external',
    'function reports(uint256) external view returns (tuple)',
    'event ReportCreated(uint256 indexed reportId, uint256 indexed targetAgentId, uint8 reportType, uint8 severity, address indexed reporter, bytes32 marketId, bytes32 evidenceHash)'
  ],
  
  BAN_MANAGER: [
    'function banFromNetwork(uint256 agentId, string reason, bytes32 proposalId) external',
    'function banFromApp(uint256 agentId, bytes32 appId, string reason, bytes32 proposalId) external',
    'function unbanFromNetwork(uint256 agentId) external',
    'function isNetworkBanned(uint256 agentId) external view returns (bool)',
    'function isAppBanned(uint256 agentId, bytes32 appId) external view returns (bool)'
  ],
  
  LABEL_MANAGER: [
    'function proposeLabel(uint256 agentId, uint8 label, bytes32 evidenceHash) external payable returns (bytes32)',
    'function getLabel(uint256 agentId) external view returns (uint8)',
    'function hasLabel(uint256 agentId, uint8 label) external view returns (bool)'
  ],
  
  // DeFi
  PREDIMARKET: [
    'function buy(bytes32 sessionId, bool outcome, uint256 tokenAmount, uint256 minShares, address token) external returns (uint256)',
    'function sell(bytes32 sessionId, bool outcome, uint256 shareAmount, uint256 minPayout, address token, uint256 deadline) external returns (uint256)',
    'function getMarketPrices(bytes32 sessionId) external view returns (uint256 yesPrice, uint256 noPrice)',
    'function getMarket(bytes32 sessionId) external view returns (tuple)',
    'function resolveMarket(bytes32 sessionId) external'
  ],
  
  CREDIT_PURCHASE: [
    'function purchaseCredits(address recipient, uint256 paymentAmount, address paymentToken) external payable returns (uint256)',
    'function treasury() external view returns (address)'
  ],
  
  NODE_STAKING: [
    'function registerNode(string endpoint, address rewardToken, uint8 region) external payable returns (uint256)',
    'function stake(uint256 nodeId) external payable',
    'function claimRewards(uint256 nodeId) external'
  ]
};

/**
 * Contract Service - Utilities for interacting with Jeju contracts
 */
export class ContractService extends Service {
  public static serviceType = 'contract_service';
  
  private provider!: ethers.JsonRpcProvider;
  private wallet!: ethers.Wallet;
  private contracts: Map<string, ethers.Contract> = new Map();

  async start(runtime: IAgentRuntime): Promise<ContractService> {
    const rpcUrl = runtime.getSetting('JEJU_L2_RPC');
    const privateKey = runtime.getSetting('REDTEAM_PRIVATE_KEY');
    
    if (!rpcUrl) {
      throw new Error('JEJU_L2_RPC environment variable is required for ContractService');
    }
    
    if (!privateKey) {
      throw new Error('REDTEAM_PRIVATE_KEY environment variable is required for ContractService');
    }

    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.wallet = new ethers.Wallet(privateKey, this.provider);

    // Initialize commonly used contracts
    this.initializeContracts(runtime);

    runtime.logger.info('Contract service started', {
      rpcUrl,
      wallet: this.wallet.address,
      contracts: Array.from(this.contracts.keys())
    });

    return this;
  }

  private initializeContracts(runtime: IAgentRuntime): void {
    const contractAddresses = {
      IDENTITY_REGISTRY: runtime.getSetting('IDENTITY_REGISTRY'),
      REPUTATION_REGISTRY: runtime.getSetting('REPUTATION_REGISTRY'),
      SERVICE_REGISTRY: runtime.getSetting('SERVICE_REGISTRY'),
      CREDIT_MANAGER: runtime.getSetting('CREDIT_MANAGER')
    };

    for (const [name, address] of Object.entries(contractAddresses)) {
      if (address && ABIS[name as keyof typeof ABIS]) {
        this.contracts.set(
          name,
          new ethers.Contract(address, ABIS[name as keyof typeof ABIS], this.wallet)
        );
      }
    }
  }

  getContract(name: string): ethers.Contract | undefined {
    return this.contracts.get(name);
  }

  getProvider(): ethers.JsonRpcProvider {
    return this.provider;
  }

  getWallet(): ethers.Wallet {
    return this.wallet;
  }

  /**
   * Deploy a contract (for attack contracts)
   */
  async deployContract(abi: any[], bytecode: string, ...args: any[]): Promise<{address: string; contract: ethers.Contract}> {
    const factory = new ethers.ContractFactory(abi, bytecode, this.wallet);
    const contract = await factory.deploy(...args);
    await contract.waitForDeployment();
    
    const address = await contract.getAddress();
    
    this.runtime.logger.info('Contract deployed', {address, args});
    
    return {address, contract};
  }

  /**
   * Call contract method
   */
  async callContract(contractAddress: string, abi: any[], method: string, ...args: any[]): Promise<any> {
    const contract = new ethers.Contract(contractAddress, abi, this.wallet);
    const result = await contract[method](...args);
    return result;
  }

  /**
   * Send transaction to contract
   */
  async sendTransaction(contractAddress: string, abi: any[], method: string, value: string = '0', ...args: any[]): Promise<string> {
    const contract = new ethers.Contract(contractAddress, abi, this.wallet);
    const tx = await contract[method](...args, {
      value: ethers.parseEther(value)
    });
    const receipt = await tx.wait();
    return receipt?.hash || '';
  }

  async stop(): Promise<void> {
    this.runtime.logger.info('Contract service stopped');
  }

  public get capabilityDescription(): string {
    return 'Smart contract interaction utilities for Jeju Network';
  }
}

export const contractsPlugin: Plugin = {
  name: '@crucible/plugin-contracts',
  description: 'Contract interaction utilities',
  services: [ContractService]
};

