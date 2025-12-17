/**
 * EIL (Ethereum Interop Layer) SDK - cross-chain transfers via XLP liquidity providers.
 */

import { createPublicClient, createWalletClient, http, type PublicClient, type WalletClient, type Address, keccak256 as viemKeccak256, stringToBytes, parseEther, formatEther, zeroAddress, encodePacked, type Chain, type TransactionReceipt } from 'viem';
import { type PrivateKeyAccount } from 'viem/accounts';
import { readContract, waitForTransactionReceipt, watchEvent } from 'viem/actions';
import { parseAbi } from 'viem';
import { MerkleTree } from 'merkletreejs';

// Use viem keccak256 that works with buffers
const keccak256 = (data: Buffer | Uint8Array | string): Buffer => {
  const bytes = typeof data === 'string' 
    ? stringToBytes(data) 
    : data;
  const hash = viemKeccak256(bytes);
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

const CROSS_CHAIN_PAYMASTER_ABI = parseAbi([
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
]);

const L1_STAKE_MANAGER_ABI = parseAbi([
  'function register(uint256[] chains) external payable',
  'function addStake() external payable',
  'function startUnbonding(uint256 amount) external',
  'function completeUnbonding() external',
  'function getStake(address xlp) external view returns (tuple(uint256 stakedAmount, uint256 unbondingAmount, uint256 unbondingStartTime, uint256 slashedAmount, bool isActive, uint256 registeredAt))',
  'function getXLPChains(address xlp) external view returns (uint256[])',
  'function isXLPActive(address xlp) external view returns (bool)',
  'function getEffectiveStake(address xlp) external view returns (uint256)',
  'function supportsChain(address xlp, uint256 chainId) external view returns (bool)',
]);

// ============ EIL Client ============

export class EILClient {
  private l1Client: PublicClient;
  private l2Client: PublicClient;
  private l1WalletClient: WalletClient;
  private l2WalletClient: WalletClient;
  private account: PrivateKeyAccount;
  private config: EILConfig;

  constructor(config: EILConfig, account: PrivateKeyAccount) {
    this.config = config;
    this.account = account;
    
    const l1Chain: Chain = { id: config.l1ChainId, name: 'L1', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [config.l1RpcUrl] } } };
    const l2Chain: Chain = { id: config.l2ChainId, name: 'L2', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [config.l2RpcUrl] } } };
    
    this.l1Client = createPublicClient({
      chain: l1Chain,
      transport: http(config.l1RpcUrl),
    });
    
    this.l2Client = createPublicClient({
      chain: l2Chain,
      transport: http(config.l2RpcUrl),
    });
    
    this.l1WalletClient = createWalletClient({
      account,
      chain: l1Chain,
      transport: http(config.l1RpcUrl),
    });
    
    this.l2WalletClient = createWalletClient({
      account,
      chain: l2Chain,
      transport: http(config.l2RpcUrl),
    });
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
    const recipient = params.recipient || this.account.address;
    const gasOnDestination = params.gasOnDestination || parseEther('0.001');
    const maxFee = params.maxFee || parseEther('0.01');
    const feeIncrement = params.feeIncrement || parseEther('0.0001');

    // For ETH transfers, send value with the transaction
    const isETH = params.sourceToken === zeroAddress;
    const txValue = isETH ? params.amount + maxFee : 0n;
    
    const hash = await this.l2WalletClient.writeContract({
      address: this.config.crossChainPaymaster as Address,
      abi: CROSS_CHAIN_PAYMASTER_ABI,
      functionName: 'createVoucherRequest',
      args: [
        params.sourceToken as Address,
        params.amount,
        params.destinationToken as Address,
        BigInt(params.destinationChainId),
        recipient as Address,
        gasOnDestination,
        maxFee,
        feeIncrement,
      ],
      value: txValue,
      account: this.account,
    });

    const receipt = await waitForTransactionReceipt(this.l2Client, { hash });
    
    // Parse VoucherRequested event - keccak256 local function handles string encoding
    const eventSignature = keccak256('VoucherRequested(bytes32,address,address,uint256,uint256,address,uint256,uint256)');
    const eventSignatureHex = `0x${eventSignature.toString('hex')}`;
    const event = receipt.logs.find((log) => {
      return log.topics[0] === eventSignatureHex;
    });

    if (!event || !event.topics[1]) {
      throw new Error('VoucherRequested event not found');
    }

    // Decode event data - simplified, would need proper ABI decoding in production
    const requestId = event.topics[1];

    return {
      requestId,
      sourceChain: this.config.l2ChainId,
      destinationChain: params.destinationChainId,
      sourceToken: params.sourceToken,
      destinationToken: params.destinationToken,
      amount: params.amount,
      maxFee,
      recipient,
      deadline: Math.floor(Date.now() / 1000) + 3600, // Default 1 hour
    };
  }

  /**
   * Get current fee for a request (increases over time)
   */
  async getCurrentFee(requestId: `0x${string}`): Promise<bigint> {
    return readContract(this.l2Client, {
      address: this.config.crossChainPaymaster as Address,
      abi: CROSS_CHAIN_PAYMASTER_ABI,
      functionName: 'getCurrentFee',
      args: [requestId],
    });
  }

  /**
   * Check if a request can still be fulfilled
   */
  async canFulfillRequest(requestId: `0x${string}`): Promise<boolean> {
    return readContract(this.l2Client, {
      address: this.config.crossChainPaymaster as Address,
      abi: CROSS_CHAIN_PAYMASTER_ABI,
      functionName: 'canFulfillRequest',
      args: [requestId],
    });
  }

  /**
   * Refund an expired request
   */
  async refundExpiredRequest(requestId: `0x${string}`): Promise<TransactionReceipt> {
    const hash = await this.l2WalletClient.writeContract({
      address: this.config.crossChainPaymaster as Address,
      abi: CROSS_CHAIN_PAYMASTER_ABI,
      functionName: 'refundExpiredRequest',
      args: [requestId],
      account: this.account,
    });
    return waitForTransactionReceipt(this.l2Client, { hash });
  }

  /**
   * Wait for a voucher to be issued for a request
   */
  async waitForVoucher(requestId: `0x${string}`, timeoutMs: number = 60000): Promise<Voucher> {
    return new Promise((resolve, reject) => {
      let resolved = false;
      
      const unwatch = watchEvent(this.l2Client, {
        address: this.config.crossChainPaymaster as Address,
        event: {
          type: 'event',
          name: 'VoucherIssued',
          inputs: [
            { type: 'bytes32', indexed: true, name: 'voucherId' },
            { type: 'bytes32', indexed: true, name: 'requestId' },
            { type: 'address', indexed: true, name: 'xlp' },
            { type: 'uint256', indexed: false, name: 'fee' },
          ],
        },
        args: {
          requestId,
        },
        onLogs: (logs) => {
          if (resolved || logs.length === 0) return;
          resolved = true;
          clearTimeout(timeout);
          unwatch();
          const log = logs[0];
          // Note: Signature is not emitted in VoucherIssued event
          // It must be fetched separately or obtained from the XLP off-chain
          // For now, we return empty string and the caller should fetch it if needed
          resolve({
            voucherId: log.args.voucherId || '0x',
            requestId: log.args.requestId || requestId,
            xlp: log.args.xlp || zeroAddress,
            fee: log.args.fee || 0n,
            signature: '', // Signature not available from event - fetch separately if needed
          });
        },
      });

      const timeout = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        unwatch();
        reject(new Error('Timeout waiting for voucher'));
      }, timeoutMs);
    });
  }

  /**
   * Wait for transfer fulfillment on destination chain
   */
  async waitForFulfillment(voucherId: `0x${string}`, timeoutMs: number = 120000): Promise<boolean> {
    return new Promise((resolve, reject) => {
      let resolved = false;

      const unwatch = watchEvent(this.l2Client, {
        address: this.config.crossChainPaymaster as Address,
        event: {
          type: 'event',
          name: 'VoucherFulfilled',
          inputs: [
            { type: 'bytes32', indexed: true, name: 'voucherId' },
            { type: 'address', indexed: false, name: 'recipient' },
            { type: 'uint256', indexed: false, name: 'amount' },
          ],
        },
        args: {
          voucherId,
        },
        onLogs: () => {
          if (resolved) return;
          resolved = true;
          clearTimeout(timeout);
          unwatch();
          resolve(true);
        },
      });

      const timeout = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        unwatch();
        reject(new Error('Timeout waiting for fulfillment'));
      }, timeoutMs);
    });
  }

  // ============ XLP Operations ============

  /**
   * Get XLP information with liquidity for specified tokens
   */
  async getXLPInfo(xlpAddress: Address, tokenAddresses: Address[] = []): Promise<XLPInfo> {
    const [stake, chains, ethBalance] = await Promise.all([
      readContract(this.l1Client, {
        address: this.config.l1StakeManager as Address,
        abi: L1_STAKE_MANAGER_ABI,
        functionName: 'getStake',
        args: [xlpAddress],
      }),
      readContract(this.l1Client, {
        address: this.config.l1StakeManager as Address,
        abi: L1_STAKE_MANAGER_ABI,
        functionName: 'getXLPChains',
        args: [xlpAddress],
      }),
      readContract(this.l2Client, {
        address: this.config.crossChainPaymaster as Address,
        abi: CROSS_CHAIN_PAYMASTER_ABI,
        functionName: 'getXLPETH',
        args: [xlpAddress],
      }),
    ]);

    // Query liquidity for each token
    const liquidity = new Map<string, bigint>();
    for (const token of tokenAddresses) {
      const tokenLiquidity = await readContract(this.l2Client, {
        address: this.config.crossChainPaymaster as Address,
        abi: CROSS_CHAIN_PAYMASTER_ABI,
        functionName: 'getXLPLiquidity',
        args: [xlpAddress, token],
      }).catch(() => 0n);
      if (tokenLiquidity > 0n) {
        liquidity.set(token, tokenLiquidity);
      }
    }

    return {
      address: xlpAddress,
      stakedAmount: (stake as { stakedAmount: bigint }).stakedAmount,
      isActive: (stake as { isActive: boolean }).isActive,
      supportedChains: (chains as bigint[]).map((c) => Number(c)),
      liquidity,
      ethBalance,
    };
  }

  /**
   * Deposit token liquidity as XLP
   */
  async depositLiquidity(token: Address, amount: bigint): Promise<TransactionReceipt> {
    // First approve
    const ERC20_ABI = parseAbi(['function approve(address spender, uint256 amount) external returns (bool)']);
    const approveHash = await this.l2WalletClient.writeContract({
      address: token,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [this.config.crossChainPaymaster as Address, amount],
      account: this.account,
    });
    await waitForTransactionReceipt(this.l2Client, { hash: approveHash });

    // Then deposit
    const hash = await this.l2WalletClient.writeContract({
      address: this.config.crossChainPaymaster as Address,
      abi: CROSS_CHAIN_PAYMASTER_ABI,
      functionName: 'depositLiquidity',
      args: [token, amount],
      account: this.account,
    });
    return waitForTransactionReceipt(this.l2Client, { hash });
  }

  /**
   * Deposit ETH for gas sponsorship as XLP
   */
  async depositETH(amount: bigint): Promise<TransactionReceipt> {
    const hash = await this.l2WalletClient.writeContract({
      address: this.config.crossChainPaymaster as Address,
      abi: CROSS_CHAIN_PAYMASTER_ABI,
      functionName: 'depositETH',
      value: amount,
      account: this.account,
    });
    return waitForTransactionReceipt(this.l2Client, { hash });
  }

  /**
   * Withdraw token liquidity as XLP
   */
  async withdrawLiquidity(token: Address, amount: bigint): Promise<TransactionReceipt> {
    const hash = await this.l2WalletClient.writeContract({
      address: this.config.crossChainPaymaster as Address,
      abi: CROSS_CHAIN_PAYMASTER_ABI,
      functionName: 'withdrawLiquidity',
      args: [token, amount],
      account: this.account,
    });
    return waitForTransactionReceipt(this.l2Client, { hash });
  }

  /**
   * Withdraw ETH as XLP
   */
  async withdrawETH(amount: bigint): Promise<TransactionReceipt> {
    const hash = await this.l2WalletClient.writeContract({
      address: this.config.crossChainPaymaster as Address,
      abi: CROSS_CHAIN_PAYMASTER_ABI,
      functionName: 'withdrawETH',
      args: [amount],
      account: this.account,
    });
    return waitForTransactionReceipt(this.l2Client, { hash });
  }

  /**
   * Register as XLP on L1
   */
  async registerAsXLP(chains: number[], stakeAmount: bigint): Promise<TransactionReceipt> {
    const hash = await this.l1WalletClient.writeContract({
      address: this.config.l1StakeManager as Address,
      abi: L1_STAKE_MANAGER_ABI,
      functionName: 'register',
      args: [chains.map((c) => BigInt(c))],
      value: stakeAmount,
      account: this.account,
    });
    return waitForTransactionReceipt(this.l1Client, { hash });
  }

  /**
   * Add more stake on L1
   */
  async addStake(amount: bigint): Promise<TransactionReceipt> {
    const hash = await this.l1WalletClient.writeContract({
      address: this.config.l1StakeManager as Address,
      abi: L1_STAKE_MANAGER_ABI,
      functionName: 'addStake',
      value: amount,
      account: this.account,
    });
    return waitForTransactionReceipt(this.l1Client, { hash });
  }

  /**
   * Start unbonding stake
   */
  async startUnbonding(amount: bigint): Promise<TransactionReceipt> {
    const hash = await this.l1WalletClient.writeContract({
      address: this.config.l1StakeManager as Address,
      abi: L1_STAKE_MANAGER_ABI,
      functionName: 'startUnbonding',
      args: [amount],
      account: this.account,
    });
    return waitForTransactionReceipt(this.l1Client, { hash });
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
        encodePacked(
          ['uint256', 'address', 'bytes', 'uint256', 'uint256'],
          [BigInt(op.chainId), op.target as Address, op.calldata as `0x${string}`, op.value, op.gasLimit]
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
  async signMultiChainBatch(merkleRoot: `0x${string}`): Promise<`0x${string}`> {
    const message = keccak256(
      encodePacked(
        ['bytes32', 'address', 'uint256'],
        [merkleRoot, this.account.address, BigInt(this.config.l2ChainId)]
      )
    );

    return this.account.signMessage({ message });
  }

  /**
   * Verify a multi-chain operation against merkle proof
   */
  verifyOperation(
    operation: MultiChainUserOp,
    merkleRoot: `0x${string}`,
    proof: string[]
  ): boolean {
    const leaf = keccak256(
      encodePacked(
        ['uint256', 'address', 'bytes', 'uint256', 'uint256'],
        [BigInt(operation.chainId), operation.target as Address, operation.calldata as `0x${string}`, operation.value, operation.gasLimit]
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
  const baseFee = parseEther('0.0005');
  const sourceGas = 150000n * sourceChainGasPrice;
  const destinationGas = 100000n * destinationChainGasPrice;
  
  return baseFee + sourceGas + destinationGas;
}

/**
 * Format transfer for display
 */
export function formatTransfer(request: TransferRequest): string {
  return `Transfer ${formatEther(request.amount)} from chain ${request.sourceChain} to chain ${request.destinationChain}`;
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

