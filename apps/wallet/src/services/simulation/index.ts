/**
 * Transaction Simulation Service
 * Simulates transactions and shows expected state changes
 */

import type { Address, Hex } from 'viem';
import { rpcService, type SupportedChainId } from '../rpc';
import { oracleService } from '../oracle';

// Token change types
export type ChangeType = 'receive' | 'send' | 'approve' | 'revoke';

export interface TokenChange {
  type: ChangeType;
  token: {
    address: Address;
    symbol: string;
    name: string;
    decimals: number;
    logoUrl?: string;
  };
  amount: bigint;
  amountFormatted: string;
  usdValue: number;
  from?: Address;
  to?: Address;
  spender?: Address;
}

export interface NFTChange {
  type: ChangeType;
  collection: {
    address: Address;
    name: string;
    verified: boolean;
  };
  tokenId: bigint;
  name?: string;
  imageUrl?: string;
  from?: Address;
  to?: Address;
  spender?: Address;
}

export interface ContractInteraction {
  address: Address;
  name?: string;
  method: string;
  verified: boolean;
  isProxy: boolean;
  riskLevel: 'safe' | 'low' | 'medium' | 'high' | 'critical';
}

export interface GasEstimate {
  gasLimit: bigint;
  gasPrice: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  totalCost: bigint;
  totalCostUsd: number;
}

export interface SimulationResult {
  success: boolean;
  error?: string;
  
  // Balance changes
  tokenChanges: TokenChange[];
  nftChanges: NFTChange[];
  nativeChange?: {
    amount: bigint;
    amountFormatted: string;
    usdValue: number;
    type: 'send' | 'receive';
  };
  
  // Contract info
  contractInteraction?: ContractInteraction;
  
  // Approvals
  approvalChanges: {
    token: Address;
    symbol: string;
    spender: Address;
    spenderName?: string;
    amount: bigint | 'unlimited';
    isRevoke: boolean;
  }[];
  
  // Gas
  gas: GasEstimate;
  
  // Risk assessment
  risk: {
    level: 'safe' | 'low' | 'medium' | 'high' | 'critical';
    warnings: string[];
    suggestions: string[];
  };
  
  // Raw data for debugging
  logs: { address: Address; topics: Hex[]; data: Hex }[];
  trace?: unknown;
}

export interface TransactionToSimulate {
  chainId: SupportedChainId;
  from: Address;
  to: Address;
  value: bigint;
  data: Hex;
  gasLimit?: bigint;
  gasPrice?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
}

// Common token ABIs for decoding
const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ERC20_APPROVAL_TOPIC = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';
const ERC721_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// Known contract names
const KNOWN_CONTRACTS: Record<string, string> = {
  '0x0000000071727de22e5e9d8baf0edac6f37da032': 'EntryPoint v0.7',
  '0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789': 'EntryPoint v0.6',
};

// Unlimited approval threshold (max uint256)
const UNLIMITED_APPROVAL = 2n ** 256n - 1n;

class SimulationService {
  /**
   * Simulate a transaction and return expected state changes
   */
  async simulate(tx: TransactionToSimulate): Promise<SimulationResult> {
    const client = rpcService.getClient(tx.chainId);
    
    // Initialize result
    const result: SimulationResult = {
      success: false,
      tokenChanges: [],
      nftChanges: [],
      approvalChanges: [],
      gas: {
        gasLimit: 0n,
        gasPrice: 0n,
        totalCost: 0n,
        totalCostUsd: 0,
      },
      risk: {
        level: 'safe',
        warnings: [],
        suggestions: [],
      },
      logs: [],
    };
    
    try {
      // Estimate gas
      const gasEstimate = await this.estimateGas(tx);
      result.gas = gasEstimate;
      
      // Simulate call to check for revert
      const callResult = await client.call({
        account: tx.from,
        to: tx.to,
        data: tx.data,
        value: tx.value,
      }).catch(err => ({ error: err.message }));
      
      if ('error' in callResult) {
        result.success = false;
        result.error = this.parseRevertReason(callResult.error);
        result.risk.level = 'high';
        result.risk.warnings.push('Transaction will revert: ' + result.error);
        return result;
      }
      
      result.success = true;
      
      // Decode transaction data
      const decoded = this.decodeCalldata(tx.data);
      
      // Check for native ETH transfer
      if (tx.value > 0n) {
        const ethPrice = await oracleService.getNativeTokenPrice(tx.chainId);
        const ethAmount = Number(tx.value) / 1e18;
        result.nativeChange = {
          amount: tx.value,
          amountFormatted: ethAmount.toFixed(6),
          usdValue: ethAmount * ethPrice,
          type: 'send',
        };
      }
      
      // Analyze contract interaction
      if (tx.to && tx.data !== '0x') {
        result.contractInteraction = await this.analyzeContract(tx.chainId, tx.to, decoded?.method);
      }
      
      // Check for approval
      if (decoded?.method === 'approve') {
        const [spender, amount] = decoded.args as [Address, bigint];
        const isUnlimited = amount >= UNLIMITED_APPROVAL / 2n;
        const isRevoke = amount === 0n;
        
        result.approvalChanges.push({
          token: tx.to,
          symbol: await this.getTokenSymbol(tx.chainId, tx.to),
          spender,
          spenderName: KNOWN_CONTRACTS[spender.toLowerCase()],
          amount: isUnlimited ? 'unlimited' : amount,
          isRevoke,
        });
        
        if (isUnlimited && !isRevoke) {
          result.risk.warnings.push('Unlimited token approval requested');
          result.risk.suggestions.push('Consider setting a specific approval amount');
          result.risk.level = this.elevateRisk(result.risk.level, 'medium');
        }
      }
      
      // Check for transfer
      if (decoded?.method === 'transfer') {
        const [to, amount] = decoded.args as [Address, bigint];
        const symbol = await this.getTokenSymbol(tx.chainId, tx.to);
        const decimals = await this.getTokenDecimals(tx.chainId, tx.to);
        const price = await oracleService.getTokenPrice(symbol);
        const amountFormatted = Number(amount) / 10 ** decimals;
        
        result.tokenChanges.push({
          type: 'send',
          token: {
            address: tx.to,
            symbol,
            name: symbol,
            decimals,
          },
          amount,
          amountFormatted: amountFormatted.toFixed(6),
          usdValue: amountFormatted * price,
          to,
        });
      }
      
      // Risk assessment
      result.risk = this.assessRisk(result, tx);
      
      return result;
    } catch (error) {
      result.success = false;
      result.error = (error as Error).message;
      result.risk.level = 'high';
      result.risk.warnings.push('Simulation failed: ' + result.error);
      return result;
    }
  }
  
  /**
   * Estimate gas for transaction
   */
  private async estimateGas(tx: TransactionToSimulate): Promise<GasEstimate> {
    const client = rpcService.getClient(tx.chainId);
    
    const [gasLimit, gasPrice, feeData] = await Promise.all([
      tx.gasLimit || client.estimateGas({
        account: tx.from,
        to: tx.to,
        data: tx.data,
        value: tx.value,
      }),
      tx.gasPrice || client.getGasPrice(),
      client.estimateFeesPerGas().catch(() => null),
    ]);
    
    const effectiveGasPrice = tx.maxFeePerGas || gasPrice;
    const totalCost = gasLimit * effectiveGasPrice;
    const ethPrice = await oracleService.getNativeTokenPrice(tx.chainId);
    const totalCostUsd = (Number(totalCost) / 1e18) * ethPrice;
    
    return {
      gasLimit,
      gasPrice,
      maxFeePerGas: feeData?.maxFeePerGas || undefined,
      maxPriorityFeePerGas: feeData?.maxPriorityFeePerGas || undefined,
      totalCost,
      totalCostUsd,
    };
  }
  
  /**
   * Decode calldata
   */
  private decodeCalldata(data: Hex): { method: string; args: unknown[] } | null {
    if (!data || data === '0x') return null;
    
    const selector = data.slice(0, 10);
    
    // Common selectors
    const selectors: Record<string, { method: string; decode: (data: Hex) => unknown[] }> = {
      '0x095ea7b3': { // approve(address,uint256)
        method: 'approve',
        decode: (d) => [
          ('0x' + d.slice(34, 74)) as Address,
          BigInt('0x' + d.slice(74, 138)),
        ],
      },
      '0xa9059cbb': { // transfer(address,uint256)
        method: 'transfer',
        decode: (d) => [
          ('0x' + d.slice(34, 74)) as Address,
          BigInt('0x' + d.slice(74, 138)),
        ],
      },
      '0x23b872dd': { // transferFrom(address,address,uint256)
        method: 'transferFrom',
        decode: (d) => [
          ('0x' + d.slice(34, 74)) as Address,
          ('0x' + d.slice(98, 138)) as Address,
          BigInt('0x' + d.slice(138, 202)),
        ],
      },
    };
    
    const known = selectors[selector];
    if (known) {
      return { method: known.method, args: known.decode(data) };
    }
    
    return { method: selector, args: [] };
  }
  
  /**
   * Analyze contract
   */
  private async analyzeContract(
    chainId: SupportedChainId,
    address: Address,
    method?: string
  ): Promise<ContractInteraction> {
    const knownName = KNOWN_CONTRACTS[address.toLowerCase()];
    
    return {
      address,
      name: knownName,
      method: method || 'unknown',
      verified: !!knownName, // In production, check etherscan API
      isProxy: false, // In production, detect proxy patterns
      riskLevel: knownName ? 'safe' : 'low',
    };
  }
  
  /**
   * Get token symbol
   */
  private async getTokenSymbol(chainId: SupportedChainId, address: Address): Promise<string> {
    const client = rpcService.getClient(chainId);
    try {
      const symbol = await client.readContract({
        address,
        abi: [{ name: 'symbol', type: 'function', inputs: [], outputs: [{ type: 'string' }] }],
        functionName: 'symbol',
      });
      return symbol as string;
    } catch {
      return 'UNKNOWN';
    }
  }
  
  /**
   * Get token decimals
   */
  private async getTokenDecimals(chainId: SupportedChainId, address: Address): Promise<number> {
    const client = rpcService.getClient(chainId);
    try {
      const decimals = await client.readContract({
        address,
        abi: [{ name: 'decimals', type: 'function', inputs: [], outputs: [{ type: 'uint8' }] }],
        functionName: 'decimals',
      });
      return Number(decimals);
    } catch {
      return 18;
    }
  }
  
  /**
   * Parse revert reason
   */
  private parseRevertReason(error: string): string {
    // Common revert patterns
    if (error.includes('insufficient funds')) return 'Insufficient balance';
    if (error.includes('transfer amount exceeds balance')) return 'Transfer amount exceeds balance';
    if (error.includes('allowance')) return 'Insufficient allowance';
    if (error.includes('only owner')) return 'Only owner can call this function';
    if (error.includes('paused')) return 'Contract is paused';
    return error;
  }
  
  /**
   * Assess transaction risk
   */
  private assessRisk(
    result: SimulationResult,
    tx: TransactionToSimulate
  ): SimulationResult['risk'] {
    const risk: SimulationResult['risk'] = {
      level: 'safe',
      warnings: [...result.risk.warnings],
      suggestions: [...result.risk.suggestions],
    };
    
    // High value transfer
    if (result.nativeChange && result.nativeChange.usdValue > 1000) {
      risk.warnings.push(`High value transfer: $${result.nativeChange.usdValue.toFixed(2)}`);
      risk.level = this.elevateRisk(risk.level, 'medium');
    }
    
    // Token transfers
    for (const change of result.tokenChanges) {
      if (change.usdValue > 1000) {
        risk.warnings.push(`High value token transfer: $${change.usdValue.toFixed(2)} ${change.token.symbol}`);
        risk.level = this.elevateRisk(risk.level, 'medium');
      }
    }
    
    // Unverified contract
    if (result.contractInteraction && !result.contractInteraction.verified) {
      risk.warnings.push('Interacting with unverified contract');
      risk.suggestions.push('Verify the contract source code before proceeding');
      risk.level = this.elevateRisk(risk.level, 'low');
    }
    
    // Unlimited approvals
    for (const approval of result.approvalChanges) {
      if (approval.amount === 'unlimited') {
        risk.level = this.elevateRisk(risk.level, 'medium');
      }
    }
    
    return risk;
  }
  
  /**
   * Elevate risk level
   */
  private elevateRisk(
    current: SimulationResult['risk']['level'],
    newLevel: SimulationResult['risk']['level']
  ): SimulationResult['risk']['level'] {
    const levels = ['safe', 'low', 'medium', 'high', 'critical'];
    const currentIdx = levels.indexOf(current);
    const newIdx = levels.indexOf(newLevel);
    return levels[Math.max(currentIdx, newIdx)] as SimulationResult['risk']['level'];
  }
}

export const simulationService = new SimulationService();
export { SimulationService };

