/**
 * Shared Response Utilities
 * Consistent API response helpers with validation
 */

import { z } from 'zod';
import { expectValid, CommandResultSchema } from '../schemas';
import type { CommandResult } from '../types';

// ============================================================================
// Response Schemas
// ============================================================================

export const HealthResponseSchema = z.object({
  status: z.literal('healthy'),
  agent: z.string(),
  version: z.string(),
  platforms: z.object({
    enabled: z.array(z.string()),
    ready: z.array(z.string()),
  }),
});

export const StatusResponseSchema = z.object({
  name: z.string(),
  version: z.string(),
  platforms: z.record(z.string(), z.object({
    enabled: z.boolean(),
    ready: z.boolean(),
  })),
  ai: z.object({
    enabled: z.boolean(),
  }),
  chains: z.array(z.number().int().positive()),
});

export const ChainsResponseSchema = z.object({
  chains: z.array(z.number().int().positive()),
  defaultChainId: z.number().int().positive(),
});

export const InfoResponseSchema = z.object({
  name: z.string(),
  description: z.string(),
  version: z.string(),
  platforms: z.array(z.string()),
  features: z.array(z.string()),
  miniapps: z.record(z.string(), z.string().url()),
  frame: z.string().url(),
  links: z.record(z.string(), z.string().url().nullable()),
});

export const SuccessResponseSchema = z.object({
  success: z.literal(true),
  address: z.string().optional(),
});

// ============================================================================
// Response Builders
// ============================================================================

export function createHealthResponse(status: { enabled: string[]; ready: string[] }): z.infer<typeof HealthResponseSchema> {
  const response = {
    status: 'healthy' as const,
    agent: 'otto',
    version: '1.0.0',
    platforms: status,
  };
  
  return expectValid(HealthResponseSchema, response, 'health response');
}

export function createStatusResponse(
  config: { discord: { enabled: boolean }; telegram: { enabled: boolean }; whatsapp: { enabled: boolean }; farcaster: { enabled: boolean }; ai: { enabled: boolean }; trading: { supportedChains: number[] } },
  status: { enabled: string[]; ready: string[] }
): z.infer<typeof StatusResponseSchema> {
  const response = {
    name: 'Otto Trading Agent',
    version: '1.0.0',
    platforms: {
      discord: {
        enabled: config.discord.enabled,
        ready: status.ready.includes('discord'),
      },
      telegram: {
        enabled: config.telegram.enabled,
        ready: status.ready.includes('telegram'),
      },
      whatsapp: {
        enabled: config.whatsapp.enabled,
        ready: status.ready.includes('whatsapp'),
      },
      farcaster: {
        enabled: config.farcaster.enabled,
        ready: status.ready.includes('farcaster'),
      },
    },
    ai: {
      enabled: config.ai.enabled,
    },
    chains: config.trading.supportedChains,
  };
  
  return expectValid(StatusResponseSchema, response, 'status response');
}

export function createChainsResponse(config: { trading: { supportedChains: number[]; defaultChainId: number } }): z.infer<typeof ChainsResponseSchema> {
  const response = {
    chains: config.trading.supportedChains,
    defaultChainId: config.trading.defaultChainId,
  };
  
  return expectValid(ChainsResponseSchema, response, 'chains response');
}

export function createInfoResponse(config: { baseUrl: string; discord: { applicationId?: string }; telegram: { token?: string } }): z.infer<typeof InfoResponseSchema> {
  const response = {
    name: 'Otto',
    description: 'Decentralized multi-platform AI trading agent',
    version: '1.0.0',
    platforms: ['discord', 'telegram', 'whatsapp', 'farcaster', 'web'],
    features: [
      'swap',
      'bridge',
      'send',
      'launch',
      'portfolio',
      'limit-orders',
      'cross-chain',
    ],
    miniapps: {
      telegram: `${config.baseUrl}/miniapp/telegram`,
      farcaster: `${config.baseUrl}/miniapp/farcaster`,
      web: `${config.baseUrl}/miniapp/`,
    },
    frame: `${config.baseUrl}/frame`,
    links: {
      discord: config.discord.applicationId 
        ? `https://discord.com/api/oauth2/authorize?client_id=${config.discord.applicationId}&permissions=2147485696&scope=bot%20applications.commands`
        : null,
      telegram: config.telegram.token
        ? `https://t.me/${config.telegram.token.split(':')[0]}`
        : null,
    },
  };
  
  return expectValid(InfoResponseSchema, response, 'info response');
}

export function createSuccessResponse(address?: string): z.infer<typeof SuccessResponseSchema> {
  const response = {
    success: true as const,
    address,
  };
  
  return expectValid(SuccessResponseSchema, response, 'success response');
}

export function createErrorResult(message: string): CommandResult {
  const result = {
    success: false,
    message,
  };
  
  return expectValid(CommandResultSchema, result, 'error result');
}
