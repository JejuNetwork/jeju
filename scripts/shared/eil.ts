/**
 * EIL (Ethereum Interop Layer) SDK - cross-chain transfers via XLP liquidity providers.
 */

import { ethers, keccak256 as ethersKeccak256 } from 'ethers';
import { MerkleTree } from 'merkletreejs';

// Use ethers keccak256 that works with buffers
const keccak256 = (data: Buffer | Uint8Array | string): Buffer => {
  const bytes = typeof data === 'string' 
    ? ethers.toUtf8Bytes(data) 
    : data;
  const hash = ethersKeccak256(bytes);
  return Buffer.from(hash.slice(2), 'hex');
};

// ============ Types ============

export interface EILConfig {
  l1RpcUrl: string;
  l2RpcUrl: string;
  l1StakeManager: string;
  crossChainPaymaster: string;
  entryPoint?: string;
  l1ChainId: number;
  l2ChainId: number;
}

export interface TransferRequest {
  requestId: string;
  sourceChain: number;
  destinationChain: number;
  sourceToken: string;
  destinationToken: string;
  amount: bigint;
  maxFee: bigint;
  recipient: string;
  deadline: number;
}

export interface Voucher {
  voucherId: string;
  requestId: string;
  xlp: string;
  fee: bigint;
  signature: string;
}

export interface XLPInfo {
  address: string;
  stakedAmount: bigint;
  isActive: boolean;
  supportedChains: number[];
  liquidity: Map<string, bigint>; // token -> amount
  ethBalance: bigint;
}

export interface MultiChainUserOp {
  chainId: number;
  target: string;
  calldata: string;
  value: bigint;
  gasLimit: bigint;
}

// ============ ABIs ============

const CROSS_CHAIN_PAYMASTER_ABI = [
  'function createVoucherRequest(address token, uint256 amount, address destinationToken, uint256 destinationChainId, address recipient, uint256 gasOnDestination, uint256 maxFee, uint256 feeIncrement) external returns (bytes32)',
  'function getCurrentFee(bytes32 requestId) external view returns (uint256)',
  'function refundExpiredRequest(bytes32 requestId) external',
  'function depositLiquidity(address token, uint256 amount) external',
  'function depositETH() external payable',
  'function withdrawLiquidity(address token, uint256 amount) external',
  'function withdrawETH(uint256 amount) external',
  'function issueVoucher(bytes32 requestId, bytes signature) external returns (bytes32)',
  'function fulfillVoucher(bytes32 voucherId, bytes32 requestId, address xlp, address token, uint256 amount, address recipient, uint256 gasAmount, bytes xlpSignature) external',
  'function getXLPLiquidity(address xlp, address token) external view returns (uint256)',
  'function getXLPETH(address xlp) external view returns (uint256)',
  'function canFulfillRequest(bytes32 requestId) external view returns (bool)',
  'function supportedTokens(address) external view returns (bool)',
  'event VoucherRequested(bytes32 indexed requestId, address indexed requester, address token, uint256 amount, uint256 destinationChainId, address recipient, uint256 maxFee, uint256 deadline)',
  'event VoucherIssued(bytes32 indexed voucherId, bytes32 indexed requestId, address indexed xlp, uint256 fee)',
  'event VoucherFulfilled(bytes32 indexed voucherId, address indexed recipient, uint256 amount)',
];

const L1_STAKE_MANAGER_ABI = [
  'function register(uint256[] chains) external payable',
  'function addStake() external payable',
  'function startUnbonding(uint256 amount) external',
  'function completeUnbonding() external',
  'function getStake(address xlp) external view returns (tuple(uint256 stakedAmount, uint256 unbondingAmount, uint256 unbondingStartTime, uint256 slashedAmount, bool isActive, uint256 registeredAt))',
  'function getXLPChains(address xlp) external view returns (uint256[])',
  'function isXLPActive(address xlp) external view returns (bool)',
  'function getEffectiveStake(address xlp) external view returns (uint256)',
  'function supportsChain(address xlp, uint256 chainId) external view returns (bool)',
];

// ============ EIL Client ============

export class EILClient {
  private l1Provider: ethers.JsonRpcProvider;
  private l2Provider: ethers.JsonRpcProvider;
  private signer: ethers.Signer;
  private config: EILConfig;
  private paymaster: ethers.Contract;
  private stakeManager: ethers.Contract;

  constructor(config: EILConfig, signer: ethers.Signer) {
    this.config = config;
    this.signer = signer;
    this.l1Provider = new ethers.JsonRpcProvider(config.l1RpcUrl);
    this.l2Provider = new ethers.JsonRpcProvider(config.l2RpcUrl);
    
    this.paymaster = new ethers.Contract(
      config.crossChainPaymaster,
      CROSS_CHAIN_PAYMASTER_ABI,
      this.signer.connect(this.l2Provider)
    );
    
    this.stakeManager = new ethers.Contract(
      config.l1StakeManager,
      L1_STAKE_MANAGER_ABI,
      this.signer.connect(this.l1Provider)
    );
  }

  // ============ Transfer Operations ============

  /**
   * Create a cross-chain transfer request
   */
  async createTransfer(params: {
    sourceToken: string;
    destinationToken: string;
    amount: bigint;
    destinationChainId: number;
    recipient?: string;
    gasOnDestination?: bigint;
    maxFee?: bigint;
    feeIncrement?: bigint;
  }): Promise<TransferRequest> {
    const signerAddress = await this.signer.getAddress();
    const recipient = params.recipient || signerAddress;
    const gasOnDestination = params.gasOnDestination || ethers.parseEther('0.001');
    const maxFee = params.maxFee || ethers.parseEther('0.01');
    const feeIncrement = params.feeIncrement || ethers.parseEther('0.0001');

    // For ETH transfers, send value with the transaction
    const isETH = params.sourceToken === ethers.ZeroAddress;
    const txValue = isETH ? params.amount + maxFee : 0n;
    
    const tx = await this.paymaster.createVoucherRequest(
      params.sourceToken,
      params.amount,
      params.destinationToken,
      params.destinationChainId,
      recipient,
      gasOnDestination,
      maxFee,
      feeIncrement,
      { value: txValue }
    );

    const receipt = await tx.wait();
    
    // Parse VoucherRequested event
    const event = receipt.logs
      .map((log: ethers.Log) => {
        try {
          return this.paymaster.interface.parseLog({ topics: [...log.topics], data: log.data });
        } catch {
          return null;
        }
      })
      .find((parsed: ethers.LogDescription | null) => parsed?.name === 'VoucherRequested');

    if (!event) {
      throw new Error('VoucherRequested event not found');
    }

    return {
      requestId: event.args.requestId,
      sourceChain: this.config.l2ChainId,
      destinationChain: params.destinationChainId,
      sourceToken: params.sourceToken,
      destinationToken: params.destinationToken,
      amount: params.amount,
      maxFee,
      recipient,
      deadline: Number(event.args.deadline),
    };
  }

  /**
   * Get current fee for a request (increases over time)
   */
  async getCurrentFee(requestId: string): Promise<bigint> {
    return this.paymaster.getCurrentFee(requestId);
  }

  /**
   * Check if a request can still be fulfilled
   */
  async canFulfillRequest(requestId: string): Promise<boolean> {
    return this.paymaster.canFulfillRequest(requestId);
  }

  /**
   * Refund an expired request
   */
  async refundExpiredRequest(requestId: string): Promise<ethers.TransactionReceipt> {
    const tx = await this.paymaster.refundExpiredRequest(requestId);
    return tx.wait();
  }

  /**
   * Wait for a voucher to be issued for a request
   */
  async waitForVoucher(requestId: string, timeoutMs: number = 60000): Promise<Voucher> {
    return new Promise((resolve, reject) => {
      const filter = this.paymaster.filters.VoucherIssued(null, requestId);
      let resolved = false;
      
      const handler = (voucherId: string, _requestId: string, xlp: string, fee: bigint) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        this.paymaster.off(filter, handler);
        resolve({
          voucherId,
          requestId: _requestId,
          xlp,
          fee,
          signature: '',
        });
      };

      const timeout = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        this.paymaster.off(filter, handler);
        reject(new Error('Timeout waiting for voucher'));
      }, timeoutMs);
      
      this.paymaster.on(filter, handler);
    });
  }

  /**
   * Wait for transfer fulfillment on destination chain
   */
  async waitForFulfillment(voucherId: string, timeoutMs: number = 120000): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const filter = this.paymaster.filters.VoucherFulfilled(voucherId);
      let resolved = false;

      const handler = () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        this.paymaster.off(filter, handler);
        resolve(true);
      };

      const timeout = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        this.paymaster.off(filter, handler);
        reject(new Error('Timeout waiting for fulfillment'));
      }, timeoutMs);
      
      this.paymaster.on(filter, handler);
    });
  }

  // ============ XLP Operations ============

  /**
   * Get XLP information with liquidity for specified tokens
   */
  async getXLPInfo(xlpAddress: string, tokenAddresses: string[] = []): Promise<XLPInfo> {
    const [stake, chains, ethBalance] = await Promise.all([
      this.stakeManager.getStake(xlpAddress),
      this.stakeManager.getXLPChains(xlpAddress),
      this.paymaster.getXLPETH(xlpAddress),
    ]);

    // Query liquidity for each token
    const liquidity = new Map<string, bigint>();
    for (const token of tokenAddresses) {
      const tokenLiquidity = await this.paymaster.getXLPLiquidity(xlpAddress, token).catch(() => 0n);
      if (tokenLiquidity > 0n) {
        liquidity.set(token, tokenLiquidity);
      }
    }

    return {
      address: xlpAddress,
      stakedAmount: stake.stakedAmount,
      isActive: stake.isActive,
      supportedChains: chains.map((c: bigint) => Number(c)),
      liquidity,
      ethBalance,
    };
  }

  /**
   * Deposit token liquidity as XLP
   */
  async depositLiquidity(token: string, amount: bigint): Promise<ethers.TransactionReceipt> {
    // First approve
    const tokenContract = new ethers.Contract(
      token,
      ['function approve(address spender, uint256 amount) external returns (bool)'],
      this.signer.connect(this.l2Provider)
    );
    const approveTx = await tokenContract.approve(this.config.crossChainPaymaster, amount);
    await approveTx.wait();

    // Then deposit
    const tx = await this.paymaster.depositLiquidity(token, amount);
    return tx.wait();
  }

  /**
   * Deposit ETH for gas sponsorship as XLP
   */
  async depositETH(amount: bigint): Promise<ethers.TransactionReceipt> {
    const tx = await this.paymaster.depositETH({ value: amount });
    return tx.wait();
  }

  /**
   * Withdraw token liquidity as XLP
   */
  async withdrawLiquidity(token: string, amount: bigint): Promise<ethers.TransactionReceipt> {
    const tx = await this.paymaster.withdrawLiquidity(token, amount);
    return tx.wait();
  }

  /**
   * Withdraw ETH as XLP
   */
  async withdrawETH(amount: bigint): Promise<ethers.TransactionReceipt> {
    const tx = await this.paymaster.withdrawETH(amount);
    return tx.wait();
  }

  /**
   * Register as XLP on L1
   */
  async registerAsXLP(chains: number[], stakeAmount: bigint): Promise<ethers.TransactionReceipt> {
    const tx = await this.stakeManager.register(chains, { value: stakeAmount });
    return tx.wait();
  }

  /**
   * Add more stake on L1
   */
  async addStake(amount: bigint): Promise<ethers.TransactionReceipt> {
    const tx = await this.stakeManager.addStake({ value: amount });
    return tx.wait();
  }

  /**
   * Start unbonding stake
   */
  async startUnbonding(amount: bigint): Promise<ethers.TransactionReceipt> {
    const tx = await this.stakeManager.startUnbonding(amount);
    return tx.wait();
  }

  // ============ Multi-Chain UserOp Batch ============

  /**
   * Build a multi-chain UserOp batch with single signature
   */
  async buildMultiChainBatch(operations: MultiChainUserOp[]): Promise<{
    merkleRoot: string;
    leaves: string[];
    proofs: string[][];
  }> {
    // Create leaves from operations
    const leaves = operations.map((op) =>
      keccak256(
        ethers.solidityPacked(
          ['uint256', 'address', 'bytes', 'uint256', 'uint256'],
          [op.chainId, op.target, op.calldata, op.value, op.gasLimit]
        )
      )
    );

    // Build Merkle tree
    const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
    const merkleRoot = tree.getHexRoot();

    // Get proofs for each leaf
    const proofs = leaves.map((leaf) => tree.getHexProof(leaf));

    return {
      merkleRoot,
      leaves: leaves.map((l) => '0x' + l.toString('hex')),
      proofs,
    };
  }

  /**
   * Sign a multi-chain batch (single signature over merkle root)
   */
  async signMultiChainBatch(merkleRoot: string): Promise<string> {
    const message = ethers.solidityPackedKeccak256(
      ['bytes32', 'address', 'uint256'],
      [merkleRoot, await this.signer.getAddress(), this.config.l2ChainId]
    );

    return this.signer.signMessage(ethers.getBytes(message));
  }

  /**
   * Verify a multi-chain operation against merkle proof
   */
  verifyOperation(
    operation: MultiChainUserOp,
    merkleRoot: string,
    proof: string[]
  ): boolean {
    const leaf = keccak256(
      ethers.solidityPacked(
        ['uint256', 'address', 'bytes', 'uint256', 'uint256'],
        [operation.chainId, operation.target, operation.calldata, operation.value, operation.gasLimit]
      )
    );

    const tree = new MerkleTree([], keccak256, { sortPairs: true });
    return tree.verify(proof.map((p) => Buffer.from(p.slice(2), 'hex')), leaf, merkleRoot);
  }
}

// ============ Helper Functions ============

/**
 * Estimate fee for a cross-chain transfer
 */
export function estimateCrossChainFee(
  _amount: bigint,
  sourceChainGasPrice: bigint,
  destinationChainGasPrice: bigint
): bigint {
  // Base fee + gas costs on both chains
  const baseFee = ethers.parseEther('0.0005');
  const sourceGas = 150000n * sourceChainGasPrice;
  const destinationGas = 100000n * destinationChainGasPrice;
  
  return baseFee + sourceGas + destinationGas;
}

/**
 * Format transfer for display
 */
export function formatTransfer(request: TransferRequest): string {
  return `Transfer ${ethers.formatEther(request.amount)} from chain ${request.sourceChain} to chain ${request.destinationChain}`;
}

/**
 * Calculate optimal fee based on urgency
 */
export function calculateOptimalFee(
  baseFee: bigint,
  urgencyMultiplier: number = 1
): { maxFee: bigint; feeIncrement: bigint } {
  const maxFee = (baseFee * BigInt(Math.ceil(urgencyMultiplier * 100))) / 100n;
  const feeIncrement = maxFee / 50n; // Will reach max in ~50 blocks
  
  return { maxFee, feeIncrement };
}

