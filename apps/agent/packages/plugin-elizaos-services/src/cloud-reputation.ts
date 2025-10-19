/**
 * Cloud Reputation Integration for ElizaOS Services
 * 
 * Integrates cloud services with ERC-8004 registry and reputation system.
 * Enables:
 * - Reputation tracking for all API users
 * - Automated violation detection
 * - TOS enforcement via bans
 * - x402 payment integration
 * - A2A agent communication
 */

import { ethers } from 'ethers';
import { CloudIntegration, ViolationType, type CloudConfig } from '../../../../../scripts/shared/cloud-integration';

export interface RequestContext {
  userId: string;
  agentId?: bigint;
  service: string;
  method: string;
  tokensUsed?: number;
  responseTime: number;
  success: boolean;
  error?: string;
}

export interface ReputationConfig {
  enabled: boolean;
  updateAfterRequest: boolean;
  autobanThreshold: number;
  violationThreshold: {
    apiAbuse: number;
    resourceExploitation: number;
  };
  rateLimit: {
    requestsPerMinute: number;
    tokensPerHour: number;
  };
}

export class CloudReputationService {
  private integration: CloudIntegration;
  private config: ReputationConfig;
  private requestCounts: Map<string, number[]> = new Map();
  private tokenUsage: Map<string, number[]> = new Map();
  
  constructor(
    integration: CloudIntegration,
    config: Partial<ReputationConfig> = {}
  ) {
    this.integration = integration;
    this.config = {
      enabled: true,
      updateAfterRequest: true,
      autobanThreshold: 20,
      violationThreshold: {
        apiAbuse: 3,
        resourceExploitation: 2
      },
      rateLimit: {
        requestsPerMinute: 60,
        tokensPerHour: 100000
      },
      ...config
    };
  }
  
  /**
   * Middleware for API requests
   * Checks reputation, rate limits, and updates after request
   */
  async handleRequest(
    request: Request,
    handler: (req: Request) => Promise<Response>
  ): Promise<Response> {
    if (!this.config.enabled) {
      return handler(request);
    }
    
    const startTime = Date.now();
    const userId = this.extractUserId(request);
    const agentId = await this.getUserAgentId(userId);
    
    // Check if user is banned
    if (agentId) {
      const isBanned = await this.isAgentBanned(agentId);
      if (isBanned) {
        return new Response(
          JSON.stringify({ error: 'User banned for TOS violation' }),
          { status: 403 }
        );
      }
    }
    
    // Check reputation
    if (agentId) {
      const reputation = await this.integration.getAgentReputation(agentId);
      if (reputation.averageScore < this.config.autobanThreshold) {
        return new Response(
          JSON.stringify({ error: 'Reputation too low. Please contact support.' }),
          { status: 403 }
        );
      }
    }
    
    // Check rate limits
    const rateLimitCheck = this.checkRateLimit(userId);
    if (!rateLimitCheck.allowed) {
      if (agentId) {
        await this.recordViolationAsync(
          agentId,
          ViolationType.API_ABUSE,
          70,
          `Rate limit exceeded: ${rateLimitCheck.reason}`
        );
      }
      
      return new Response(
        JSON.stringify({ 
          error: 'Rate limit exceeded',
          reason: rateLimitCheck.reason,
          retryAfter: rateLimitCheck.retryAfter
        }),
        { status: 429 }
      );
    }
    
    // Handle request
    let response: Response;
    let success = false;
    let error: string | undefined;
    
    try {
      response = await handler(request);
      success = response.ok;
      
      if (!success) {
        error = `HTTP ${response.status}`;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Unknown error';
      response = new Response(
        JSON.stringify({ error }),
        { status: 500 }
      );
    }
    
    const responseTime = Date.now() - startTime;
    
    // Update reputation after request
    if (this.config.updateAfterRequest && agentId) {
      const context: RequestContext = {
        userId,
        agentId,
        service: this.extractService(request),
        method: request.method,
        responseTime,
        success,
        error
      };
      
      this.updateReputationAsync(context).catch(console.error);
    }
    
    return response;
  }
  
  /**
   * Update reputation based on request context
   */
  private async updateReputationAsync(context: RequestContext): Promise<void> {
    if (!context.agentId) return;
    
    // Calculate score based on request metrics
    let score = 80; // Baseline
    
    // Success bonus
    if (context.success) score += 15;
    
    // Response time bonus
    if (context.responseTime < 1000) score += 5;
    if (context.responseTime < 500) score += 5;
    
    // Token usage (if applicable)
    if (context.tokensUsed) {
      if (context.tokensUsed < 1000) score += 3;
      if (context.tokensUsed > 10000) score -= 5;
    }
    
    // Error penalty
    if (context.error) score -= 20;
    
    // Clamp score
    score = Math.max(0, Math.min(100, score));
    
    // Set reputation
    try {
      const signer = this.getSigner();
      await this.integration.setReputation(
        signer,
        context.agentId,
        score,
        'quality',
        context.service,
        JSON.stringify({
          responseTime: context.responseTime,
          success: context.success,
          error: context.error,
          timestamp: Date.now()
        })
      );
    } catch (error) {
      console.error('Failed to update reputation:', error);
    }
  }
  
  /**
   * Record violation
   */
  private async recordViolationAsync(
    agentId: bigint,
    type: ViolationType,
    severity: number,
    evidence: string
  ): Promise<void> {
    try {
      const signer = this.getSigner();
      await this.integration.recordViolation(
        signer,
        agentId,
        type,
        severity,
        evidence
      );
      
      // Check if should propose ban
      const violations = await this.integration.getAgentViolations(agentId);
      
      // Auto-ban after repeated severe violations
      const severeViolations = violations.filter(
        v => v.severityScore >= 80 && v.violationType === type
      );
      
      const threshold = type === ViolationType.API_ABUSE 
        ? this.config.violationThreshold.apiAbuse
        : this.config.violationThreshold.resourceExploitation;
      
      if (severeViolations.length >= threshold) {
        await this.integration.proposeBan(
          signer,
          agentId,
          type,
          `Repeated violations: ${severeViolations.length} severe ${ViolationType[type]}`
        );
      }
    } catch (error) {
      console.error('Failed to record violation:', error);
    }
  }
  
  /**
   * Check rate limits
   */
  private checkRateLimit(userId: string): {
    allowed: boolean;
    reason?: string;
    retryAfter?: number;
  } {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const oneHourAgo = now - 3600000;
    
    // Get request history
    const requests = this.requestCounts.get(userId) || [];
    const recentRequests = requests.filter(t => t > oneMinuteAgo);
    
    // Check requests per minute
    if (recentRequests.length >= this.config.rateLimit.requestsPerMinute) {
      return {
        allowed: false,
        reason: 'Too many requests per minute',
        retryAfter: 60
      };
    }
    
    // Get token usage history
    const tokens = this.tokenUsage.get(userId) || [];
    const recentTokens = tokens.filter(t => t > oneHourAgo);
    const totalTokens = recentTokens.reduce((sum, t) => sum + t, 0);
    
    // Check tokens per hour
    if (totalTokens >= this.config.rateLimit.tokensPerHour) {
      return {
        allowed: false,
        reason: 'Token limit exceeded',
        retryAfter: 3600
      };
    }
    
    // Update history
    recentRequests.push(now);
    this.requestCounts.set(userId, recentRequests);
    
    return { allowed: true };
  }
  
  /**
   * Helper methods
   */
  private extractUserId(request: Request): string {
    // Extract from Authorization header, x-api-key, or other source
    const authHeader = request.headers.get('Authorization');
    if (authHeader) {
      return authHeader.split(' ')[1] || 'anonymous';
    }
    
    const apiKey = request.headers.get('x-api-key');
    if (apiKey) {
      return apiKey;
    }
    
    return 'anonymous';
  }
  
  private extractService(request: Request): string {
    const url = new URL(request.url);
    const path = url.pathname;
    
    if (path.includes('chat')) return 'chat-completion';
    if (path.includes('image')) return 'image-generation';
    if (path.includes('embed')) return 'embeddings';
    if (path.includes('storage')) return 'storage';
    if (path.includes('compute')) return 'compute';
    
    return 'unknown';
  }
  
  private async getUserAgentId(userId: string): Promise<bigint | undefined> {
    // Map userId to agentId
    // In production, this would query a database or registry
    // For now, return undefined (anonymous users)
    return undefined;
  }
  
  private async isAgentBanned(agentId: bigint): Promise<boolean> {
    try {
      // Check if agent is banned in IdentityRegistry
      // This would require accessing the identity registry contract
      return false;
    } catch (error) {
      return false;
    }
  }
  
  private getSigner(): ethers.Signer {
    // Get signer from environment
    const privateKey = process.env.CLOUD_OPERATOR_KEY || process.env.PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('No operator key configured');
    }
    
    const provider = new ethers.JsonRpcProvider(
      process.env.RPC_URL || 'http://localhost:8545'
    );
    
    return new ethers.Wallet(privateKey, provider);
  }
}

/**
 * Express/Next.js middleware example
 */
export function createReputationMiddleware(service: CloudReputationService) {
  return async (req: Request): Promise<Response | null> => {
    try {
      const response = await service.handleRequest(req, async (request) => {
        // This should never be called directly
        // The actual handler will be provided by the route
        throw new Error('Handler not provided');
      });
      
      // If response is 403 or 429, return it immediately
      if (response.status === 403 || response.status === 429) {
        return response;
      }
      
      // Otherwise, let the request continue
      return null;
    } catch (error) {
      console.error('Reputation middleware error:', error);
      return null;
    }
  };
}

/**
 * Usage example in Next.js API route:
 * 
 * ```typescript
 * // app/api/chat/route.ts
 * import { reputationService } from '@/lib/reputation';
 * 
 * export async function POST(request: Request) {
 *   // Reputation check happens here
 *   const response = await reputationService.handleRequest(
 *     request,
 *     async (req) => {
 *       // Your actual API logic
 *       const body = await req.json();
 *       const result = await generateChat(body.messages);
 *       
 *       return Response.json(result);
 *     }
 *   );
 *   
 *   return response;
 * }
 * ```
 */

