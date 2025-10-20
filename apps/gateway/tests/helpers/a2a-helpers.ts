/**
 * @fileoverview A2A protocol test helper functions
 * @module gateway/tests/helpers/a2a-helpers
 */

const A2A_BASE_URL = 'http://localhost:4003';

export interface A2AMessage {
  messageId: string;
  parts: Array<{
    kind: 'text' | 'data';
    text?: string;
    data?: Record<string, unknown>;
  }>;
}

export interface A2ARequest {
  jsonrpc: string;
  method: string;
  params?: {
    message?: A2AMessage;
  };
  id: number | string;
}

export interface A2AResponse {
  jsonrpc: string;
  id: number | string;
  result?: {
    role: string;
    parts: Array<{
      kind: string;
      text?: string;
      data?: Record<string, unknown>;
    }>;
    messageId: string;
    kind: string;
  };
  error?: {
    code: number;
    message: string;
  };
}

/**
 * Create a standard A2A request
 */
export function createA2ARequest(
  skillId: string,
  data: Record<string, unknown> = {},
  messageId: string = `test-${Date.now()}`
): A2ARequest {
  return {
    jsonrpc: '2.0',
    method: 'message/send',
    params: {
      message: {
        messageId,
        parts: [
          { kind: 'data', data: { skillId, ...data } }
        ]
      }
    },
    id: Math.floor(Math.random() * 10000)
  };
}

/**
 * Send A2A request to gateway
 */
export async function sendA2ARequest(request: A2ARequest): Promise<A2AResponse> {
  const response = await fetch(`${A2A_BASE_URL}/a2a`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  
  if (!response.ok) {
    throw new Error(`A2A request failed: ${response.status} ${response.statusText}`);
  }
  
  return await response.json();
}

/**
 * Execute A2A skill
 */
export async function executeSkill(
  skillId: string,
  params: Record<string, unknown> = {}
): Promise<A2AResponse> {
  const request = createA2ARequest(skillId, params);
  return await sendA2ARequest(request);
}

/**
 * Fetch agent card
 */
export async function fetchAgentCard(baseUrl: string = A2A_BASE_URL) {
  const response = await fetch(`${baseUrl}/.well-known/agent-card.json`);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch agent card: ${response.status}`);
  }
  
  return await response.json();
}

/**
 * Verify agent card structure
 */
export function verifyAgentCardStructure(card: Record<string, unknown>): void {
  const required = [
    'protocolVersion',
    'name',
    'description',
    'url',
    'preferredTransport',
    'provider',
    'version',
    'capabilities',
    'skills'
  ];
  
  for (const field of required) {
    if (!(field in card)) {
      throw new Error(`Agent card missing required field: ${field}`);
    }
  }
}

/**
 * Extract data from A2A response
 */
export function extractResponseData(response: A2AResponse): Record<string, unknown> | null {
  if (!response.result?.parts) return null;
  
  const dataPart = response.result.parts.find(p => p.kind === 'data');
  return dataPart?.data || null;
}

/**
 * Extract text from A2A response
 */
export function extractResponseText(response: A2AResponse): string | null {
  if (!response.result?.parts) return null;
  
  const textPart = response.result.parts.find(p => p.kind === 'text');
  return textPart?.text || null;
}

/**
 * Check if A2A server is running
 */
export async function isA2AServerRunning(baseUrl: string = A2A_BASE_URL): Promise<boolean> {
  const response = await fetch(`${baseUrl}/.well-known/agent-card.json`).catch(() => null);
  return response?.ok || false;
}

/**
 * Validate skill execution
 */
export async function validateSkillExecution(
  skillId: string,
  expectedDataKeys: string[]
): Promise<void> {
  const response = await executeSkill(skillId);
  
  if (response.error) {
    throw new Error(`Skill execution failed: ${response.error.message}`);
  }
  
  const data = extractResponseData(response);
  
  if (!data) {
    throw new Error('No data in response');
  }
  
  for (const key of expectedDataKeys) {
    if (!(key in data)) {
      throw new Error(`Missing expected key in response data: ${key}`);
    }
  }
}


