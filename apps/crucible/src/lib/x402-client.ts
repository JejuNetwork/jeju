/**
 * x402 Payment Client
 * Utilities for agents to make paid API calls to other agents
 */

import { ethers } from 'ethers';
import { createPaymentPayload, signPaymentPayload } from './x402.js';
import type { Address } from 'viem';

export interface PaidSkillCallOptions {
  agentUrl: string; // Target agent's A2A endpoint
  skillId: string;
  params?: Record<string, unknown>;
  paymentAsset?: Address; // Token to pay with (default: ETH)
  maxPayment?: bigint; // Maximum willing to pay
  privateKey: string; // Caller's private key for signing
  network?: string; // Network name (default: base-sepolia)
}

export interface PaidSkillResponse {
  success: boolean;
  message?: string;
  data?: Record<string, unknown>;
  settlement?: any;
  error?: string;
}

/**
 * Make a paid skill call to another agent
 */
export async function callPaidSkill(
  options: PaidSkillCallOptions
): Promise<PaidSkillResponse> {
  try {
    // Step 1: Query the skill to get payment requirements
    const initialResponse = await fetch(`${options.agentUrl}/api/a2a`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            messageId: `msg-${Date.now()}`,
            parts: [
              {
                kind: 'data',
                data: {
                  skillId: options.skillId,
                  params: options.params || {}
                }
              }
            ]
          }
        },
        id: 1
      })
    });
    
    const initialResult = await initialResponse.json();
    
    // If no payment required, return result
    if (initialResponse.status === 200 && initialResult.result) {
      return {
        success: true,
        message: initialResult.result.parts?.find((p: any) => p.kind === 'text')?.text,
        data: initialResult.result.parts?.find((p: any) => p.kind === 'data')?.data
      };
    }
    
    // Step 2: Handle 402 Payment Required
    if (initialResponse.status === 402 && initialResult.error?.data) {
      const paymentReq = initialResult.error.data;
      const scheme = paymentReq.accepts?.[0];
      
      if (!scheme) {
        return {success: false, error: 'No acceptable payment scheme'};
      }
      
      const requiredAmount = BigInt(scheme.maxAmountRequired);
      
      // Check if willing to pay
      if (options.maxPayment && requiredAmount > options.maxPayment) {
        return {
          success: false,
          error: `Payment required (${ethers.formatEther(requiredAmount)} ETH) exceeds maximum (${ethers.formatEther(options.maxPayment)} ETH)`
        };
      }
      
      // Step 3: Create and sign payment payload
      const payload = createPaymentPayload(
        options.paymentAsset || ('0x0000000000000000000000000000000000000000' as Address),
        scheme.payTo as Address,
        requiredAmount,
        scheme.resource,
        options.network || scheme.network || 'base-sepolia'
      );
      
      const signedPayload = await signPaymentPayload(
        payload,
        options.privateKey as `0x${string}`
      );
      
      // Step 4: Retry request with payment header
      const paidResponse = await fetch(`${options.agentUrl}/api/a2a`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Payment': JSON.stringify(signedPayload)
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'message/send',
          params: {
            message: {
              messageId: `msg-${Date.now()}`,
              parts: [
                {
                  kind: 'data',
                  data: {
                    skillId: options.skillId,
                    params: options.params || {}
                  }
                }
              ]
            }
          },
          id: 1
        })
      });
      
      const paidResult = await paidResponse.json();
      
      if (paidResponse.status === 200 && paidResult.result) {
        return {
          success: true,
          message: paidResult.result.parts?.find((p: any) => p.kind === 'text')?.text,
          data: paidResult.result.parts?.find((p: any) => p.kind === 'data')?.data,
          settlement: paidResult.result.parts?.find((p: any) => p.kind === 'data')?.data?.settlement
        };
      }
      
      return {
        success: false,
        error: paidResult.error?.message || 'Paid request failed'
      };
    }
    
    // Unexpected response
    return {
      success: false,
      error: initialResult.error?.message || 'Unexpected API response'
    };
    
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to call paid skill'
    };
  }
}

/**
 * Example: Get vulnerability report from Crucible
 */
export async function getVulnerabilityReport(
  crucibleUrl: string,
  vulnId: string,
  payerPrivateKey: string
): Promise<PaidSkillResponse> {
  return callPaidSkill({
    agentUrl: crucibleUrl,
    skillId: 'get-vulnerability-report',
    params: { vulnId },
    privateKey: payerPrivateKey,
    network: 'localnet'
  });
}

/**
 * Example: Trigger security test on a contract
 */
export async function triggerSecurityTest(
  crucibleUrl: string,
  contractAddress: string,
  testType: string,
  payerPrivateKey: string
): Promise<PaidSkillResponse> {
  return callPaidSkill({
    agentUrl: crucibleUrl,
    skillId: 'trigger-security-test',
    params: { contractAddress, testType },
    privateKey: payerPrivateKey,
    network: 'localnet'
  });
}

/**
 * Example: Subscribe to continuous monitoring
 */
export async function subscribeToMonitoring(
  crucibleUrl: string,
  contractAddress: string,
  payerPrivateKey: string
): Promise<PaidSkillResponse> {
  return callPaidSkill({
    agentUrl: crucibleUrl,
    skillId: 'subscribe-monitoring',
    params: { contractAddress },
    privateKey: payerPrivateKey,
    network: 'localnet'
  });
}

