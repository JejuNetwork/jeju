/**
 * Platform Integration for ElizaOS Services Authentication
 * Handles platform-to-client key distribution and validation
 */

import type { IAgentRuntime } from '@elizaos/core';
import { logger } from '@elizaos/core';
import { AuthenticationService, TEST_KEYS, type AuthStatus } from './AuthenticationService.js';

export interface PlatformAuthConfig {
  platformId: string;
  clientType: 'cli' | 'gui' | 'agent';
  distributionMode: 'test' | 'production' | 'auto';
  allowTestKeys: boolean;
}

export interface ClientSession {
  sessionId: string;
  clientType: 'cli' | 'gui' | 'agent';
  platformId: string;
  authStatus: AuthStatus | null;
  lastActivity: Date;
  validatedKeys: string[];
}

export interface KeyDistributionRequest {
  sessionId: string;
  provider: string;
  keyType: 'test' | 'production';
  clientCapabilities: string[];
}

export interface KeyDistributionResponse {
  success: boolean;
  apiKey?: string;
  keyType: 'test' | 'production';
  capabilities: string[];
  expiresAt?: Date;
  error?: string;
}

/**
 * Platform Integration Service
 * Manages authentication across different client modalities
 */
export class PlatformIntegrationService {
  private runtime: IAgentRuntime;
  private authService: AuthenticationService;
  private activeSessions = new Map<string, ClientSession>();
  private keyDistributionLog: Array<{
    timestamp: Date;
    sessionId: string;
    provider: string;
    keyType: string;
    success: boolean;
  }> = [];

  constructor(runtime: IAgentRuntime, config: PlatformAuthConfig) {
    this.runtime = runtime;
    this.authService = new AuthenticationService(runtime);

    logger.info(`Initializing platform integration for ${config.clientType} client`);
  }

  /**
   * Register a new client session
   */
  async registerSession(
    sessionId: string,
    clientType: 'cli' | 'gui' | 'agent',
    platformId: string
  ): Promise<ClientSession> {
    logger.debug(`Registering session ${sessionId} for ${clientType} client`);

    const session: ClientSession = {
      sessionId,
      clientType,
      platformId,
      authStatus: null,
      lastActivity: new Date(),
      validatedKeys: [],
    };

    this.activeSessions.set(sessionId, session);

    // Perform initial auth check
    try {
      session.authStatus = await this.authService.getAuthStatus();
    } catch (error) {
      logger.warn(`Failed to get initial auth status for session ${sessionId}:`, error);
    }

    return session;
  }

  /**
   * Distribute API key to client
   */
  async distributeKey(request: KeyDistributionRequest): Promise<KeyDistributionResponse> {
    const session = this.activeSessions.get(request.sessionId);
    if (!session) {
      return {
        success: false,
        keyType: request.keyType,
        capabilities: [],
        error: 'Invalid session ID',
      };
    }

    // Update session activity
    session.lastActivity = new Date();

    try {
      let apiKey: string;
      let capabilities: string[];

      if (request.keyType === 'test') {
        // Distribute test key
        const result = await this.distributeTestKey(request.provider, session.clientType);
        if (!result.success) {
          return result;
        }
        apiKey = result.apiKey!;
        capabilities = result.capabilities;
      } else {
        // Distribute production key
        const result = await this.distributeProductionKey(request.provider, session);
        if (!result.success) {
          return result;
        }
        apiKey = result.apiKey!;
        capabilities = result.capabilities;
      }

      // Log distribution
      this.keyDistributionLog.push({
        timestamp: new Date(),
        sessionId: request.sessionId,
        provider: request.provider,
        keyType: request.keyType,
        success: true,
      });

      // Add to session's validated keys
      session.validatedKeys.push(`${request.provider}:${request.keyType}`);

      return {
        success: true,
        apiKey,
        keyType: request.keyType,
        capabilities,
        expiresAt:
          request.keyType === 'test' ? new Date(Date.now() + 24 * 60 * 60 * 1000) : undefined, // Test keys expire in 24h
      };
    } catch (error) {
      logger.error(`Failed to distribute ${request.keyType} key for ${request.provider}:`, error);

      this.keyDistributionLog.push({
        timestamp: new Date(),
        sessionId: request.sessionId,
        provider: request.provider,
        keyType: request.keyType,
        success: false,
      });

      return {
        success: false,
        keyType: request.keyType,
        capabilities: [],
        error: error instanceof Error ? error.message : 'Unknown distribution error',
      };
    }
  }

  /**
   * Validate distributed key
   */
  async validateDistributedKey(
    sessionId: string,
    provider: string,
    apiKey: string
  ): Promise<{ isValid: boolean; error?: string }> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return { isValid: false, error: 'Invalid session ID' };
    }

    try {
      const result = await this.authService.validateApiKey(provider, apiKey);

      if (result.isValid) {
        // Update session auth status
        session.authStatus = await this.authService.getAuthStatus();
        session.lastActivity = new Date();

        logger.debug(`Successfully validated ${provider} key for session ${sessionId}`);
        return { isValid: true };
      } else {
        logger.warn(
          `Key validation failed for ${provider} in session ${sessionId}: ${result.errorMessage}`
        );
        return { isValid: false, error: result.errorMessage };
      }
    } catch (error) {
      logger.error(`Key validation error for ${provider} in session ${sessionId}:`, error);
      return { isValid: false, error: error instanceof Error ? error.message : 'Validation error' };
    }
  }

  /**
   * Invalidate session and revoke access
   */
  async invalidateSession(sessionId: string): Promise<{ success: boolean; error?: string }> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return { success: false, error: 'Session not found' };
    }

    logger.info(`Invalidating session ${sessionId} for ${session.clientType} client`);

    // Remove from active sessions
    this.activeSessions.delete(sessionId);

    // Clear any cached auth data
    this.authService.clearCache();

    return { success: true };
  }

  /**
   * Get session status and auth information
   */
  async getSessionStatus(sessionId: string): Promise<{
    session: ClientSession | null;
    authStatus: AuthStatus | null;
    capabilities: string[];
  }> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return {
        session: null,
        authStatus: null,
        capabilities: [],
      };
    }

    // Refresh auth status if needed
    if (!session.authStatus || Date.now() - session.lastActivity.getTime() > 5 * 60 * 1000) {
      try {
        session.authStatus = await this.authService.getAuthStatus();
        session.lastActivity = new Date();
      } catch (error) {
        logger.warn(`Failed to refresh auth status for session ${sessionId}:`, error);
      }
    }

    return {
      session,
      authStatus: session.authStatus,
      capabilities: session.authStatus?.capabilities || [],
    };
  }

  /**
   * Get platform analytics and monitoring data
   */
  getAnalytics(): {
    activeSessions: number;
    sessionsByType: Record<string, number>;
    keyDistributions: number;
    recentActivity: Array<{
      timestamp: Date;
      sessionId: string;
      provider: string;
      keyType: string;
      success: boolean;
    }>;
  } {
    const sessionsByType = Array.from(this.activeSessions.values()).reduce(
      (acc, session) => {
        acc[session.clientType] = (acc[session.clientType] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    return {
      activeSessions: this.activeSessions.size,
      sessionsByType,
      keyDistributions: this.keyDistributionLog.length,
      recentActivity: this.keyDistributionLog
        .slice(-10)
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()),
    };
  }

  /**
   * Cleanup expired sessions
   */
  cleanupExpiredSessions(): number {
    const now = Date.now();
    const expiredSessions: string[] = [];

    for (const [sessionId, session] of this.activeSessions.entries()) {
      // Sessions expire after 24 hours of inactivity
      if (now - session.lastActivity.getTime() > 24 * 60 * 60 * 1000) {
        expiredSessions.push(sessionId);
      }
    }

    expiredSessions.forEach((sessionId) => {
      this.activeSessions.delete(sessionId);
      logger.debug(`Cleaned up expired session: ${sessionId}`);
    });

    return expiredSessions.length;
  }

  /**
   * Distribute test key for development/testing
   */
  private async distributeTestKey(
    provider: string,
    clientType: string
  ): Promise<KeyDistributionResponse> {
    const testKeyMap: Record<string, string> = {
      openai: TEST_KEYS.OPENAI_TEST_KEY,
      groq: TEST_KEYS.GROQ_TEST_KEY,
      anthropic: TEST_KEYS.ANTHROPIC_TEST_KEY,
    };

    const apiKey = testKeyMap[provider];
    if (!apiKey) {
      return {
        success: false,
        keyType: 'test',
        capabilities: [],
        error: `No test key available for provider: ${provider}`,
      };
    }

    // Get capabilities for test key
    const validation = await this.authService.validateApiKey(provider, apiKey);

    logger.info(`Distributed test key for ${provider} to ${clientType} client`);

    return {
      success: true,
      apiKey,
      keyType: 'test',
      capabilities: validation.capabilities,
    };
  }

  /**
   * Distribute production key (requires proper configuration)
   */
  private async distributeProductionKey(
    provider: string,
    session: ClientSession
  ): Promise<KeyDistributionResponse> {
    const keyMap: Record<string, string> = {
      openai: 'OPENAI_API_KEY',
      groq: 'GROQ_API_KEY',
      anthropic: 'ANTHROPIC_API_KEY',
    };

    const envKey = keyMap[provider];
    if (!envKey) {
      return {
        success: false,
        keyType: 'production',
        capabilities: [],
        error: `Unsupported provider: ${provider}`,
      };
    }

    const apiKey = this.runtime.getSetting(envKey) || process.env[envKey];
    if (!apiKey) {
      return {
        success: false,
        keyType: 'production',
        capabilities: [],
        error: `Production key not configured for ${provider}`,
      };
    }

    // Validate the production key
    const validation = await this.authService.validateApiKey(provider, apiKey);
    if (!validation.isValid) {
      return {
        success: false,
        keyType: 'production',
        capabilities: [],
        error: `Production key validation failed: ${validation.errorMessage}`,
      };
    }

    logger.info(
      `Distributed production key for ${provider} to ${session.clientType} client (session: ${session.sessionId})`
    );

    return {
      success: true,
      apiKey,
      keyType: 'production',
      capabilities: validation.capabilities,
    };
  }
}

/**
 * Platform Integration Factory
 */
export class PlatformIntegrationFactory {
  static createForCLI(runtime: IAgentRuntime): PlatformIntegrationService {
    return new PlatformIntegrationService(runtime, {
      platformId: 'elizaos-cli',
      clientType: 'cli',
      distributionMode: 'auto',
      allowTestKeys: true,
    });
  }

  static createForGUI(runtime: IAgentRuntime): PlatformIntegrationService {
    return new PlatformIntegrationService(runtime, {
      platformId: 'elizaos-gui',
      clientType: 'gui',
      distributionMode: 'auto',
      allowTestKeys: true,
    });
  }

  static createForAgent(runtime: IAgentRuntime): PlatformIntegrationService {
    return new PlatformIntegrationService(runtime, {
      platformId: 'elizaos-agent',
      clientType: 'agent',
      distributionMode: 'production',
      allowTestKeys: false,
    });
  }
}

/**
 * Utility functions for platform integration
 */
export class PlatformAuthUtils {
  /**
   * Generate secure session ID
   */
  static generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Validate session ID format
   */
  static isValidSessionId(sessionId: string): boolean {
    return /^session_\d+_[a-z0-9]{13}$/.test(sessionId);
  }

  /**
   * Get client capabilities based on type
   */
  static getClientCapabilities(clientType: 'cli' | 'gui' | 'agent'): string[] {
    switch (clientType) {
      case 'cli':
        return ['text_generation', 'embeddings', 'validation', 'testing'];
      case 'gui':
        return ['text_generation', 'embeddings', 'image_description', 'validation', 'monitoring'];
      case 'agent':
        return ['text_generation', 'embeddings', 'image_description', 'reasoning'];
      default:
        return [];
    }
  }

  /**
   * Check if provider supports client capabilities
   */
  static isProviderCompatible(
    providerCapabilities: string[],
    clientCapabilities: string[]
  ): boolean {
    return clientCapabilities.some((cap) => providerCapabilities.includes(cap));
  }
}
