/**
 * Security Service
 * 
 * Handles transaction simulation, risk analysis, and signature context review.
 * Provides security checks before transaction execution.
 */

import type { IAgentRuntime } from '@elizaos/core';
import { 
  createPublicClient, 
  http,
  type PublicClient,
  type Address,
  type Hex,
  decodeErrorResult,
} from 'viem';
import type {
  SecurityAnalysis,
  SignatureRisk,
  TransactionRisk,
} from '../types';
import {
  expectAddress,
  expectHex,
  expectChainId,
  expectBigInt,
  expectNonEmpty,
} from '../../lib/validation';

// Known malicious/scam patterns
const KNOWN_SCAM_PATTERNS = [
  'setApprovalForAll',
  'approve(address,uint256)',
  'increaseAllowance',
];

// Known safe contracts (could be loaded from config)
const KNOWN_SAFE_CONTRACTS = new Set<string>([
  '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', // Uniswap V2 Router
  '0xE592427A0AEce92De3Edee1F18E0157C05861564', // Uniswap V3 Router
  '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45', // Uniswap Universal Router
]);

export class SecurityService {
  static readonly serviceType = 'jeju-security';
  
  private runtime: IAgentRuntime | null = null;
  private publicClients: Map<number, PublicClient> = new Map();
  
  
  constructor() {}
  
  get serviceType(): string {
    return SecurityService.serviceType;
  }
  
  static async start(): Promise<SecurityService> {
    return new SecurityService();
  }
  
  static async stop(): Promise<void> {
    // Cleanup
  }
  
  async initialize(runtime: IAgentRuntime): Promise<void> {
    this.runtime = runtime;
    runtime.logger.info('[SecurityService] Initialized');
  }
  
  async stop(): Promise<void> {
    this.runtime?.logger.info('[SecurityService] Stopped');
  }
  
  /**
   * Analyze a transaction for security risks
   */
  async analyzeTransaction(options: {
    chainId: number;
    to: Address;
    value?: bigint;
    data?: Hex;
    from?: Address;
  }): Promise<SecurityAnalysis> {
    expectChainId(options.chainId, 'chainId');
    expectAddress(options.to, 'to');
    if (options.value) expectBigInt(options.value, 'value');
    if (options.data) expectHex(options.data, 'data');
    if (options.from) expectAddress(options.from, 'from');

    this.runtime?.logger.info(`[SecurityService] Analyzing transaction to ${options.to}`);
    
    const risks: TransactionRisk[] = [];
    let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
    
    // Check if target is a known safe contract
    const isSafeContract = KNOWN_SAFE_CONTRACTS.has(options.to.toLowerCase());
    
    // Check for approval patterns in calldata
    if (options.data && options.data.length > 10) {
      const selector = options.data.slice(0, 10);
      
      for (const pattern of KNOWN_SCAM_PATTERNS) {
        if (options.data.includes(pattern)) {
          risks.push({
            type: 'approval',
            severity: 'high',
            description: `Transaction includes approval function: ${pattern}`,
            recommendation: 'Review the approval amount carefully',
          });
          riskLevel = 'high';
        }
      }
      
      // Check for setApprovalForAll
      if (selector === '0xa22cb465') {
        risks.push({
          type: 'approval',
          severity: 'high',
          description: 'Transaction will approve all NFTs to a third party',
          recommendation: 'Only approve trusted contracts',
        });
        riskLevel = 'high';
      }
      
      // Check for unlimited approve
      if (selector === '0x095ea7b3') {
        const maxUint256 = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
        if (options.data.toLowerCase().includes(maxUint256)) {
          risks.push({
            type: 'approval',
            severity: 'medium',
            description: 'Transaction includes unlimited token approval',
            recommendation: 'Consider using exact amount instead of unlimited',
          });
          if (riskLevel === 'low') riskLevel = 'medium';
        }
      }
    }
    
    // Check for high value transfers
    if (options.value && options.value > BigInt(10e18)) {
      risks.push({
        type: 'value',
        severity: 'medium',
        description: 'Transaction includes high ETH value (>10 ETH)',
        recommendation: 'Double-check the recipient address',
      });
      if (riskLevel === 'low') riskLevel = 'medium';
    }
    
    // Simulate transaction
    const simulation = await this.simulateTransaction(options);
    
    if (!simulation.success) {
      risks.push({
        type: 'simulation',
        severity: 'critical',
        description: `Transaction will likely fail: ${simulation.error}`,
        recommendation: 'Review transaction parameters',
      });
      riskLevel = 'critical';
    }
    
    return {
      riskLevel,
      risks,
      simulation,
      isKnownContract: isSafeContract,
      summary: this.generateSummary(options, risks, riskLevel),
    };
  }
  
  /**
   * Simulate a transaction
   */
  private async simulateTransaction(options: {
    chainId: number;
    to: Address;
    value?: bigint;
    data?: Hex;
    from?: Address;
  }): Promise<{
    success: boolean;
    gasUsed?: bigint;
    error?: string;
    returnData?: Hex;
  }> {
    expectChainId(options.chainId, 'chainId');
    expectAddress(options.to, 'to');
    if (options.value) expectBigInt(options.value, 'value');
    if (options.data) expectHex(options.data, 'data');
    if (options.from) expectAddress(options.from, 'from');

    const publicClient = this.getPublicClient(options.chainId);
    
    const from = options.from || '0x0000000000000000000000000000000000000001' as Address;
    
    try {
      const result = await publicClient.call({
        account: from,
        to: options.to,
        value: options.value,
        data: options.data,
      });
      
      return {
        success: true,
        returnData: result.data,
      };
    } catch (error) {
      let errorMessage = 'Unknown error';
      
      if (error instanceof Error) {
        errorMessage = error.message;
        
        // Try to decode revert reason
        if (errorMessage.includes('0x')) {
          const hexMatch = errorMessage.match(/0x[a-fA-F0-9]+/);
          if (hexMatch) {
            try {
              const decoded = decodeErrorResult({
                data: hexMatch[0] as Hex,
                abi: [{ type: 'error', name: 'Error', inputs: [{ type: 'string', name: 'message' }] }],
              });
              errorMessage = decoded.args[0] as string;
            } catch {
              // Keep original error
            }
          }
        }
      }
      
      return {
        success: false,
        error: errorMessage,
      };
    }
  }
  
  /**
   * Analyze a signature request
   */
  async analyzeSignature(options: {
    message: string | Record<string, unknown>;
    signerAddress: Address;
    origin?: string;
    typedData?: {
      domain: Record<string, unknown>;
      types: Record<string, Array<{ name: string; type: string }>>;
      primaryType: string;
      message: Record<string, unknown>;
    };
  }): Promise<{
    risks: SignatureRisk[];
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    summary: string;
  }> {
    const risks: SignatureRisk[] = [];
    let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
    
    // Check for permit signatures (EIP-2612)
    if (options.typedData) {
      const { primaryType, message, domain } = options.typedData;
      
      if (primaryType === 'Permit') {
        const spenderAddr = message.spender as string;
        risks.push({
          type: 'permit',
          severity: 'medium',
          description: 'This signature will approve token spending',
          details: {
            spender: spenderAddr.startsWith('0x') ? spenderAddr as `0x${string}` : undefined,
            amount: typeof message.value === 'string' ? BigInt(message.value) : undefined,
            deadline: typeof message.deadline === 'number' ? message.deadline : undefined,
          },
        });
        riskLevel = 'medium';
        
        // Check for unlimited permit
        const maxUint256Str = '115792089237316195423570985008687907853269984665640564039457584007913129639935';
        if (message.value === maxUint256Str) {
          risks.push({
            type: 'unlimited',
            severity: 'high',
            description: 'This permit grants unlimited spending approval',
          });
          riskLevel = 'high';
        }
      }
      
      // Check for suspicious domain
      if (domain.name && typeof domain.name === 'string') {
        if (domain.name.toLowerCase().includes('claim') || 
            domain.name.toLowerCase().includes('airdrop')) {
          risks.push({
            type: 'suspicious',
            severity: 'high',
            description: 'Signature request appears to be from a potential phishing site',
          });
          riskLevel = 'high';
        }
      }
    }
    
    // Check origin
    if (options.origin) {
      const originLower = options.origin.toLowerCase();
      
      // Check for common typosquatting
      const suspiciousPatterns = ['uniswap-', 'opensea-', '-airdrop', '-claim'];
      for (const pattern of suspiciousPatterns) {
        if (originLower.includes(pattern)) {
          risks.push({
            type: 'phishing',
            severity: 'critical',
            description: `Origin "${options.origin}" matches suspicious pattern`,
          });
          riskLevel = 'critical';
          break;
        }
      }
    }
    
    const summary = risks.length > 0
      ? `${risks.length} risk(s) detected. ${risks.map(r => r.description).join('. ')}`
      : 'No significant risks detected';
    
    return { risks, riskLevel, summary };
  }
  
  /**
   * Review page/DApp context
   */
  async reviewPageContext(url: string): Promise<{
    domain: string;
    isVerified: boolean;
    riskScore: number;
    warnings: string[];
    summary: string;
  }> {
    expectNonEmpty(url, 'url');
    
    let domain: string;
    try {
      domain = new URL(url).hostname;
    } catch {
      return {
        domain: 'invalid',
        isVerified: false,
        riskScore: 100,
        warnings: ['Invalid URL'],
        summary: 'Unable to analyze URL',
      };
    }
    
    const warnings: string[] = [];
    let riskScore = 0;
    
    // Check for known safe domains
    const knownSafe = [
      'uniswap.org',
      'app.uniswap.org',
      'opensea.io',
      'aave.com',
      'compound.finance',
    ];
    
    const isVerified = knownSafe.some(safe => domain.endsWith(safe));
    
    if (!isVerified) {
      riskScore += 20;
      warnings.push('Domain is not in verified list');
    }
    
    // Check for suspicious TLDs
    const suspiciousTlds = ['.xyz', '.click', '.top', '.fun'];
    for (const tld of suspiciousTlds) {
      if (domain.endsWith(tld)) {
        riskScore += 30;
        warnings.push(`Suspicious TLD: ${tld}`);
      }
    }
    
    // Check for typosquatting patterns
    const typoPatterns = ['uniiswap', 'uniswwap', 'opensee', 'opensea1'];
    for (const pattern of typoPatterns) {
      if (domain.includes(pattern)) {
        riskScore += 50;
        warnings.push('Potential typosquatting detected');
      }
    }
    
    const summary = isVerified
      ? `${domain} is a verified DApp`
      : warnings.length > 0
        ? `${domain}: ${warnings.join(', ')}`
        : `${domain} is not verified but no specific risks detected`;
    
    return {
      domain,
      isVerified,
      riskScore: Math.min(riskScore, 100),
      warnings,
      summary,
    };
  }
  
  /**
   * Generate human-readable summary
   */
  private generateSummary(
    options: { to: Address; value?: bigint; data?: Hex },
    risks: TransactionRisk[],
    riskLevel: string
  ): string {
    let summary = '';
    
    if (options.value && options.value > 0) {
      const ethValue = Number(options.value) / 1e18;
      summary += `Transfer ${ethValue.toFixed(4)} ETH to ${options.to.slice(0, 6)}...${options.to.slice(-4)}. `;
    } else if (options.data) {
      summary += `Contract interaction with ${options.to.slice(0, 6)}...${options.to.slice(-4)}. `;
    }
    
    if (risks.length > 0) {
      summary += `Risk level: ${riskLevel}. ${risks.map(r => r.description).join(' ')}`;
    } else {
      summary += 'No significant risks detected.';
    }
    
    return summary;
  }
  
  private getPublicClient(chainId: number): PublicClient {
    let client = this.publicClients.get(chainId);
    if (!client) {
      client = createPublicClient({
        transport: http(`http://localhost:4010/rpc/${chainId}`),
      });
      this.publicClients.set(chainId, client);
    }
    return client;
  }
}

export default SecurityService;
