/**
 * Wormhole Bridge Adapter
 * Provides alternative bridge path for Solana ↔ EVM via Wormhole
 * 
 * Used as fallback when ZKSolBridge is congested or for specific token types
 */

import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  parseAbi,
  type Chain,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { mainnet, sepolia, arbitrum, base, optimism } from 'viem/chains';
import { EventEmitter } from 'events';

// Wormhole chain IDs (different from regular chain IDs)
const WORMHOLE_CHAIN_IDS: Record<number, number> = {
  1: 2,      // Ethereum
  56: 4,     // BSC
  137: 5,    // Polygon
  43114: 6,  // Avalanche
  42161: 23, // Arbitrum
  10: 24,    // Optimism
  8453: 30,  // Base
  101: 1,    // Solana (mainnet)
  102: 1,    // Solana (devnet) - same wormhole ID
};

// Wormhole Core Bridge addresses
const WORMHOLE_CORE_BRIDGES: Record<number, Address> = {
  1: '0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B', // Ethereum
  42161: '0xa5f208e072434bC67592E4C49C1B991BA79BCA46', // Arbitrum
  10: '0xEe91C335eab126dF5fDB3797EA9d6aD93aeC9722', // Optimism
  8453: '0xbebdb6C8ddC678FfA9f8748f85C815C556Dd8ac6', // Base
};

// Wormhole Token Bridge addresses
const WORMHOLE_TOKEN_BRIDGES: Record<number, Address> = {
  1: '0x3ee18B2214AFF97000D974cf647E7C347E8fa585', // Ethereum
  42161: '0x0b2402144Bb366A632D14B83F244D2e0e21bD39c', // Arbitrum
  10: '0x1D68124e65faFC907325e3EDbF8c4d84499DAa8b', // Optimism
  8453: '0x8d2de8d2f73F1F4cAB472AC9A881C9b123C79627', // Base
};

// Solana Wormhole program IDs
const SOLANA_WORMHOLE_CORE = new PublicKey('worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth');
const SOLANA_TOKEN_BRIDGE = new PublicKey('wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb');

const WORMHOLE_TOKEN_BRIDGE_ABI = parseAbi([
  'function transferTokens(address token, uint256 amount, uint16 recipientChain, bytes32 recipient, uint256 arbiterFee, uint32 nonce) external payable returns (uint64 sequence)',
  'function completeTransfer(bytes memory encodedVm) external',
  'function wrappedAsset(uint16 tokenChainId, bytes32 tokenAddress) view returns (address)',
  'function isWrappedAsset(address token) view returns (bool)',
  'function attestToken(address tokenAddress, uint32 nonce) external payable returns (uint64 sequence)',
  'event TransferRedeemed(uint16 indexed emitterChainId, bytes32 indexed emitterAddress, uint64 indexed sequence)',
]);

const WORMHOLE_CORE_ABI = parseAbi([
  'function publishMessage(uint32 nonce, bytes memory payload, uint8 consistencyLevel) external payable returns (uint64 sequence)',
  'function messageFee() external view returns (uint256)',
]);

export interface WormholeConfig {
  evmPrivateKey: Hex;
  evmRpcUrls: Record<number, string>;
  solanaRpcUrl: string;
  solanaKeypair?: Uint8Array;
  wormholeRestApi?: string;
}

export interface WormholeTransferParams {
  sourceChainId: number;
  destChainId: number;
  token: Address | string;
  amount: bigint;
  recipient: Address | string;
}

export interface WormholeTransferResult {
  success: boolean;
  txHash?: Hex | string;
  sequence?: bigint;
  vaa?: string;
  error?: string;
}

export interface WormholeVAA {
  version: number;
  guardianSetIndex: number;
  signatures: WormholeSignature[];
  timestamp: number;
  nonce: number;
  emitterChain: number;
  emitterAddress: string;
  sequence: bigint;
  consistencyLevel: number;
  payload: string;
}

interface WormholeSignature {
  guardianIndex: number;
  r: string;
  s: string;
  v: number;
}

type ChainClients = {
  public: ReturnType<typeof createPublicClient>;
  wallet: ReturnType<typeof createWalletClient>;
};

const CHAINS: Record<number, { chain: Chain; name: string }> = {
  1: { chain: mainnet, name: 'Ethereum' },
  11155111: { chain: sepolia, name: 'Sepolia' },
  42161: { chain: arbitrum, name: 'Arbitrum' },
  8453: { chain: base, name: 'Base' },
  10: { chain: optimism, name: 'Optimism' },
};

export class WormholeAdapter extends EventEmitter {
  private account: PrivateKeyAccount;
  private evmClients: Map<number, ChainClients> = new Map();
  private solanaConnection: Connection;
  private solanaKeypair: Keypair | null = null;
  private wormholeRestApi: string;

  constructor(config: WormholeConfig) {
    super();
    this.account = privateKeyToAccount(config.evmPrivateKey);
    this.wormholeRestApi = config.wormholeRestApi || 'https://api.wormholescan.io';

    // Initialize EVM clients
    for (const [chainIdStr, rpcUrl] of Object.entries(config.evmRpcUrls)) {
      const chainId = Number(chainIdStr);
      const chainConfig = CHAINS[chainId];
      if (!chainConfig) continue;

      const publicClient = createPublicClient({
        chain: chainConfig.chain,
        transport: http(rpcUrl),
      });

      const walletClient = createWalletClient({
        account: this.account,
        chain: chainConfig.chain,
        transport: http(rpcUrl),
      });

      this.evmClients.set(chainId, { public: publicClient, wallet: walletClient });
    }

    this.solanaConnection = new Connection(config.solanaRpcUrl, 'confirmed');

    if (config.solanaKeypair) {
      this.solanaKeypair = Keypair.fromSecretKey(config.solanaKeypair);
    }
  }

  /**
   * Transfer tokens from EVM to EVM via Wormhole
   */
  async transferEVMToEVM(params: WormholeTransferParams): Promise<WormholeTransferResult> {
    const sourceClients = this.evmClients.get(params.sourceChainId);
    if (!sourceClients) {
      return { success: false, error: `Source chain ${params.sourceChainId} not configured` };
    }

    const tokenBridge = WORMHOLE_TOKEN_BRIDGES[params.sourceChainId];
    if (!tokenBridge) {
      return { success: false, error: `No Wormhole bridge on chain ${params.sourceChainId}` };
    }

    const destWormholeChainId = WORMHOLE_CHAIN_IDS[params.destChainId];
    if (!destWormholeChainId) {
      return { success: false, error: `Destination chain ${params.destChainId} not supported by Wormhole` };
    }

    // Convert recipient to bytes32
    const recipientBytes32 = `0x${(params.recipient as string).slice(2).padStart(64, '0')}` as Hex;

    // Get message fee
    const coreBridge = WORMHOLE_CORE_BRIDGES[params.sourceChainId];
    const messageFee = await sourceClients.public.readContract({
      address: coreBridge,
      abi: WORMHOLE_CORE_ABI,
      functionName: 'messageFee',
    }) as bigint;

    // Approve token
    const ERC20_ABI = parseAbi([
      'function approve(address spender, uint256 amount) returns (bool)',
    ]);

    const approveHash = await sourceClients.wallet.writeContract({
      address: params.token as Address,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [tokenBridge, params.amount],
      account: this.account,
      chain: null,
    });
    await sourceClients.public.waitForTransactionReceipt({ hash: approveHash });

    // Transfer tokens - use cryptographically secure nonce
    const nonceBytes = new Uint8Array(4);
    crypto.getRandomValues(nonceBytes);
    const nonce = new DataView(nonceBytes.buffer).getUint32(0, false);
    const hash = await sourceClients.wallet.writeContract({
      address: tokenBridge,
      abi: WORMHOLE_TOKEN_BRIDGE_ABI,
      functionName: 'transferTokens',
      args: [
        params.token as Address,
        params.amount,
        destWormholeChainId,
        recipientBytes32,
        0n, // No arbiter fee
        nonce,
      ],
      value: messageFee,
      account: this.account,
      chain: null,
    });

    const receipt = await sourceClients.public.waitForTransactionReceipt({ hash });

    // Parse sequence from logs
    let sequence: bigint = 0n;
    for (const log of receipt.logs) {
      // Look for LogMessagePublished event from core bridge
      if (log.address.toLowerCase() === coreBridge.toLowerCase()) {
        // Sequence is in the data field
        sequence = BigInt(log.topics[1] || '0');
        break;
      }
    }

    this.emit('transferInitiated', {
      sourceChain: params.sourceChainId,
      destChain: params.destChainId,
      txHash: hash,
      sequence,
    });

    return {
      success: true,
      txHash: hash,
      sequence,
    };
  }

  /**
   * Transfer tokens from EVM to Solana via Wormhole
   */
  async transferEVMToSolana(params: {
    sourceChainId: number;
    token: Address;
    amount: bigint;
    recipient: string; // Solana pubkey
  }): Promise<WormholeTransferResult> {
    const sourceClients = this.evmClients.get(params.sourceChainId);
    if (!sourceClients) {
      return { success: false, error: `Source chain ${params.sourceChainId} not configured` };
    }

    const tokenBridge = WORMHOLE_TOKEN_BRIDGES[params.sourceChainId];
    if (!tokenBridge) {
      return { success: false, error: `No Wormhole bridge on chain ${params.sourceChainId}` };
    }

    // Convert Solana pubkey to bytes32
    const solanaRecipient = new PublicKey(params.recipient);
    const recipientBytes32 = `0x${Buffer.from(solanaRecipient.toBytes()).toString('hex')}` as Hex;

    const coreBridge = WORMHOLE_CORE_BRIDGES[params.sourceChainId];
    const messageFee = await sourceClients.public.readContract({
      address: coreBridge,
      abi: WORMHOLE_CORE_ABI,
      functionName: 'messageFee',
    }) as bigint;

    // Approve and transfer
    const ERC20_ABI = parseAbi([
      'function approve(address spender, uint256 amount) returns (bool)',
    ]);

    const approveHash = await sourceClients.wallet.writeContract({
      address: params.token,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [tokenBridge, params.amount],
      account: this.account,
      chain: null,
    });
    await sourceClients.public.waitForTransactionReceipt({ hash: approveHash });

    // Use cryptographically secure nonce
    const nonceBytes2 = new Uint8Array(4);
    crypto.getRandomValues(nonceBytes2);
    const nonce = new DataView(nonceBytes2.buffer).getUint32(0, false);
    const hash = await sourceClients.wallet.writeContract({
      address: tokenBridge,
      abi: WORMHOLE_TOKEN_BRIDGE_ABI,
      functionName: 'transferTokens',
      args: [
        params.token,
        params.amount,
        1, // Solana wormhole chain ID
        recipientBytes32,
        0n,
        nonce,
      ],
      value: messageFee,
      account: this.account,
      chain: null,
    });

    await sourceClients.public.waitForTransactionReceipt({ hash });

    return { success: true, txHash: hash };
  }

  /**
   * Transfer tokens from Solana to EVM via Wormhole
   */
  async transferSolanaToEVM(params: {
    tokenMint: string;
    amount: bigint;
    destChainId: number;
    recipient: Address;
  }): Promise<WormholeTransferResult> {
    if (!this.solanaKeypair) {
      return { success: false, error: 'Solana keypair not configured' };
    }

    const destWormholeChainId = WORMHOLE_CHAIN_IDS[params.destChainId];
    if (!destWormholeChainId) {
      return { success: false, error: `Destination chain ${params.destChainId} not supported` };
    }

    // Build Wormhole transfer instruction
    // This is simplified - full implementation would use @certusone/wormhole-sdk
    const mint = new PublicKey(params.tokenMint);
    
    // Derive PDAs
    const [tokenBridgeConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from('config')],
      SOLANA_TOKEN_BRIDGE
    );

    const [coreBridgeConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from('Bridge')],
      SOLANA_WORMHOLE_CORE
    );

    const [sequence] = PublicKey.findProgramAddressSync(
      [Buffer.from('Sequence'), SOLANA_TOKEN_BRIDGE.toBuffer()],
      SOLANA_WORMHOLE_CORE
    );

    // Convert recipient to bytes32
    const recipientBytes = Buffer.alloc(32);
    Buffer.from(params.recipient.slice(2), 'hex').copy(recipientBytes, 12);

    // Build transfer instruction data
    const instructionData = Buffer.alloc(1 + 8 + 32 + 2 + 4);
    let offset = 0;

    instructionData.writeUInt8(1, offset); // Transfer instruction
    offset += 1;

    instructionData.writeBigUInt64LE(params.amount, offset);
    offset += 8;

    recipientBytes.copy(instructionData, offset);
    offset += 32;

    instructionData.writeUInt16LE(destWormholeChainId, offset);
    offset += 2;

    // Use cryptographically secure nonce
    const solNonceBytes = new Uint8Array(4);
    crypto.getRandomValues(solNonceBytes);
    instructionData.writeUInt32LE(new DataView(solNonceBytes.buffer).getUint32(0, false), offset);

    // Create instruction (simplified)
    const instruction = new TransactionInstruction({
      programId: SOLANA_TOKEN_BRIDGE,
      keys: [
        { pubkey: this.solanaKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: tokenBridgeConfig, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: coreBridgeConfig, isSigner: false, isWritable: false },
        { pubkey: sequence, isSigner: false, isWritable: true },
      ],
      data: instructionData,
    });

    const transaction = new Transaction().add(instruction);
    const signature = await sendAndConfirmTransaction(
      this.solanaConnection,
      transaction,
      [this.solanaKeypair]
    );

    return { success: true, txHash: signature };
  }

  /**
   * Complete a transfer on destination chain using VAA
   */
  async completeTransfer(
    destChainId: number,
    vaa: string
  ): Promise<WormholeTransferResult> {
    // For Solana destination
    if (destChainId === 101 || destChainId === 102) {
      return this.completeTransferOnSolana(vaa);
    }

    // For EVM destination
    const destClients = this.evmClients.get(destChainId);
    if (!destClients) {
      return { success: false, error: `Destination chain ${destChainId} not configured` };
    }

    const tokenBridge = WORMHOLE_TOKEN_BRIDGES[destChainId];
    if (!tokenBridge) {
      return { success: false, error: `No Wormhole bridge on chain ${destChainId}` };
    }

    const vaaBytes = `0x${Buffer.from(vaa, 'base64').toString('hex')}` as Hex;

    const hash = await destClients.wallet.writeContract({
      address: tokenBridge,
      abi: WORMHOLE_TOKEN_BRIDGE_ABI,
      functionName: 'completeTransfer',
      args: [vaaBytes],
      account: this.account,
      chain: null,
    });

    await destClients.public.waitForTransactionReceipt({ hash });

    return { success: true, txHash: hash };
  }

  /**
   * Complete transfer on Solana
   */
  private async completeTransferOnSolana(vaa: string): Promise<WormholeTransferResult> {
    if (!this.solanaKeypair) {
      return { success: false, error: 'Solana keypair not configured' };
    }

    // Build complete transfer instruction
    const vaaBytes = Buffer.from(vaa, 'base64');

    const instruction = new TransactionInstruction({
      programId: SOLANA_TOKEN_BRIDGE,
      keys: [
        { pubkey: this.solanaKeypair.publicKey, isSigner: true, isWritable: true },
      ],
      data: Buffer.concat([Buffer.from([2]), vaaBytes]), // 2 = completeTransfer
    });

    const transaction = new Transaction().add(instruction);
    const signature = await sendAndConfirmTransaction(
      this.solanaConnection,
      transaction,
      [this.solanaKeypair]
    );

    return { success: true, txHash: signature };
  }

  /**
   * Get VAA from Wormhole guardians
   */
  async getVAA(
    emitterChain: number,
    emitterAddress: string,
    sequence: bigint
  ): Promise<WormholeVAA | null> {
    const wormholeChainId = WORMHOLE_CHAIN_IDS[emitterChain];
    if (!wormholeChainId) return null;

    const url = `${this.wormholeRestApi}/api/v1/vaas/${wormholeChainId}/${emitterAddress}/${sequence}`;
    
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`VAA not found: ${response.status}`);
      return null;
    }

    const data = await response.json() as { data?: { vaa?: string } };
    return data.data?.vaa ? this.parseVAA(data.data.vaa) : null;
  }

  /**
   * Get wrapped asset address on destination chain
   */
  async getWrappedAsset(
    destChainId: number,
    originChainId: number,
    originToken: Address | string
  ): Promise<Address | null> {
    const destClients = this.evmClients.get(destChainId);
    if (!destClients) return null;

    const tokenBridge = WORMHOLE_TOKEN_BRIDGES[destChainId];
    if (!tokenBridge) return null;

    const originWormholeChainId = WORMHOLE_CHAIN_IDS[originChainId];
    if (!originWormholeChainId) return null;

    // Convert origin token to bytes32
    let originTokenBytes32: Hex;
    if (typeof originToken === 'string' && originToken.length === 44) {
      // Solana pubkey
      const pubkey = new PublicKey(originToken);
      originTokenBytes32 = `0x${Buffer.from(pubkey.toBytes()).toString('hex')}` as Hex;
    } else {
      originTokenBytes32 = `0x${(originToken as string).slice(2).padStart(64, '0')}` as Hex;
    }

    const wrappedAsset = await destClients.public.readContract({
      address: tokenBridge,
      abi: WORMHOLE_TOKEN_BRIDGE_ABI,
      functionName: 'wrappedAsset',
      args: [originWormholeChainId, originTokenBytes32],
    }) as Address;

    if (wrappedAsset === '0x0000000000000000000000000000000000000000') {
      return null;
    }

    return wrappedAsset;
  }

  /**
   * Check if token is a Wormhole wrapped asset
   */
  async isWrappedAsset(chainId: number, token: Address): Promise<boolean> {
    const clients = this.evmClients.get(chainId);
    if (!clients) return false;

    const tokenBridge = WORMHOLE_TOKEN_BRIDGES[chainId];
    if (!tokenBridge) return false;

    return await clients.public.readContract({
      address: tokenBridge,
      abi: WORMHOLE_TOKEN_BRIDGE_ABI,
      functionName: 'isWrappedAsset',
      args: [token],
    }) as boolean;
  }

  /**
   * Estimate bridge fee
   */
  async estimateBridgeFee(sourceChainId: number): Promise<bigint> {
    const clients = this.evmClients.get(sourceChainId);
    if (!clients) return 0n;

    const coreBridge = WORMHOLE_CORE_BRIDGES[sourceChainId];
    if (!coreBridge) return 0n;

    return await clients.public.readContract({
      address: coreBridge,
      abi: WORMHOLE_CORE_ABI,
      functionName: 'messageFee',
    }) as bigint;
  }

  /**
   * Parse VAA from base64
   */
  private parseVAA(vaaBase64: string): WormholeVAA {
    const vaaBytes = Buffer.from(vaaBase64, 'base64');
    let offset = 0;

    const version = vaaBytes.readUInt8(offset);
    offset += 1;

    const guardianSetIndex = vaaBytes.readUInt32BE(offset);
    offset += 4;

    const sigCount = vaaBytes.readUInt8(offset);
    offset += 1;

    const signatures: WormholeSignature[] = [];
    for (let i = 0; i < sigCount; i++) {
      const guardianIndex = vaaBytes.readUInt8(offset);
      offset += 1;

      const r = vaaBytes.slice(offset, offset + 32).toString('hex');
      offset += 32;

      const s = vaaBytes.slice(offset, offset + 32).toString('hex');
      offset += 32;

      const v = vaaBytes.readUInt8(offset);
      offset += 1;

      signatures.push({ guardianIndex, r, s, v });
    }

    const timestamp = vaaBytes.readUInt32BE(offset);
    offset += 4;

    const nonce = vaaBytes.readUInt32BE(offset);
    offset += 4;

    const emitterChain = vaaBytes.readUInt16BE(offset);
    offset += 2;

    const emitterAddress = vaaBytes.slice(offset, offset + 32).toString('hex');
    offset += 32;

    const sequence = vaaBytes.readBigUInt64BE(offset);
    offset += 8;

    const consistencyLevel = vaaBytes.readUInt8(offset);
    offset += 1;

    const payload = vaaBytes.slice(offset).toString('hex');

    return {
      version,
      guardianSetIndex,
      signatures,
      timestamp,
      nonce,
      emitterChain,
      emitterAddress,
      sequence,
      consistencyLevel,
      payload,
    };
  }
}

export function createWormholeAdapter(config: WormholeConfig): WormholeAdapter {
  return new WormholeAdapter(config);
}

