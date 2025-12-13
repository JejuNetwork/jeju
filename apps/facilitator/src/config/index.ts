/**
 * Facilitator Configuration
 */

import type { Address } from 'viem';
import { getPrimaryChainConfig, ZERO_ADDRESS } from '../lib/chains';

export interface FacilitatorConfig {
  port: number;
  host: string;
  environment: 'production' | 'development';
  chainId: number;
  network: string;
  rpcUrl: string;
  facilitatorAddress: Address;
  usdcAddress: Address;
  privateKey: `0x${string}` | null;
  protocolFeeBps: number;
  feeRecipient: Address;
  maxPaymentAge: number;
  minAmount: bigint;
  serviceName: string;
  serviceVersion: string;
  serviceUrl: string;
}

function getEnvAddress(key: string, defaultValue: Address): Address {
  const value = process.env[key];
  if (!value) return defaultValue;
  if (!value.startsWith('0x') || value.length !== 42) return defaultValue;
  return value as Address;
}

function getEnvPrivateKey(): `0x${string}` | null {
  const key = process.env.FACILITATOR_PRIVATE_KEY;
  if (!key || !key.startsWith('0x') || key.length !== 66) return null;
  return key as `0x${string}`;
}

export function getConfig(): FacilitatorConfig {
  const chainConfig = getPrimaryChainConfig();
  const port = parseInt(process.env.FACILITATOR_PORT || process.env.PORT || '3402', 10);

  return {
    port,
    host: process.env.HOST || '0.0.0.0',
    environment: process.env.NODE_ENV === 'production' ? 'production' : 'development',
    chainId: chainConfig.chainId,
    network: chainConfig.network,
    rpcUrl: chainConfig.rpcUrl,
    facilitatorAddress: getEnvAddress('X402_FACILITATOR_ADDRESS', chainConfig.facilitator),
    usdcAddress: getEnvAddress('JEJU_USDC_ADDRESS', chainConfig.usdc),
    privateKey: getEnvPrivateKey(),
    protocolFeeBps: parseInt(process.env.PROTOCOL_FEE_BPS || '50', 10),
    feeRecipient: getEnvAddress('FEE_RECIPIENT_ADDRESS', ZERO_ADDRESS),
    maxPaymentAge: parseInt(process.env.MAX_PAYMENT_AGE || '300', 10),
    minAmount: BigInt(process.env.MIN_PAYMENT_AMOUNT || '1'),
    serviceName: 'Jeju x402 Facilitator',
    serviceVersion: '1.0.0',
    serviceUrl: process.env.FACILITATOR_URL || `http://localhost:${port}`,
  };
}

let configInstance: FacilitatorConfig | null = null;

export function config(): FacilitatorConfig {
  if (!configInstance) configInstance = getConfig();
  return configInstance;
}

export function resetConfig(): void {
  configInstance = null;
}

export function validateConfig(): { valid: boolean; errors: string[] } {
  const cfg = config();
  const errors: string[] = [];
  if (cfg.facilitatorAddress === ZERO_ADDRESS) errors.push('X402_FACILITATOR_ADDRESS not configured');
  if (!cfg.privateKey && cfg.environment === 'production') errors.push('FACILITATOR_PRIVATE_KEY required in production');
  if (cfg.protocolFeeBps > 1000) errors.push('Protocol fee cannot exceed 10%');
  return { valid: errors.length === 0, errors };
}
