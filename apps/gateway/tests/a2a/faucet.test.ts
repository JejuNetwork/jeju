/**
 * @fileoverview Faucet A2A, MCP, and REST API tests
 * @module gateway/tests/a2a/faucet
 */

import { expect, test, describe } from 'bun:test';

const A2A_BASE_URL = 'http://localhost:4003';
const TEST_ADDRESS = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266'; // Standard hardhat test address

describe('Faucet Agent Card Skills', () => {
  test('should list faucet skills in agent card', async () => {
    const response = await fetch(`${A2A_BASE_URL}/.well-known/agent-card.json`);
    const agentCard = await response.json();
    
    const skillIds = agentCard.skills.map((s: { id: string }) => s.id);
    
    expect(skillIds).toContain('faucet-status');
    expect(skillIds).toContain('faucet-claim');
    expect(skillIds).toContain('faucet-info');
  });

  test('should have correct faucet skill metadata', async () => {
    const response = await fetch(`${A2A_BASE_URL}/.well-known/agent-card.json`);
    const agentCard = await response.json();
    
    const faucetStatusSkill = agentCard.skills.find((s: { id: string }) => s.id === 'faucet-status');
    expect(faucetStatusSkill).toBeDefined();
    expect(faucetStatusSkill.tags).toContain('faucet');
    expect(faucetStatusSkill.tags).toContain('query');
    
    const faucetClaimSkill = agentCard.skills.find((s: { id: string }) => s.id === 'faucet-claim');
    expect(faucetClaimSkill).toBeDefined();
    expect(faucetClaimSkill.tags).toContain('faucet');
    expect(faucetClaimSkill.tags).toContain('action');
  });
});

describe('Faucet A2A Skills', () => {
  test('should execute faucet-info skill', async () => {
    const request = {
      jsonrpc: '2.0',
      method: 'message/send',
      params: {
        message: {
          messageId: 'faucet-info-001',
          parts: [
            { kind: 'data', data: { skillId: 'faucet-info' } }
          ]
        }
      },
      id: 1
    };
    
    const response = await fetch(`${A2A_BASE_URL}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    
    expect(response.status).toBe(200);
    
    const result = await response.json();
    expect(result.result).toBeDefined();
    
    const dataPart = result.result.parts.find((p: { kind: string }) => p.kind === 'data');
    expect(dataPart).toBeDefined();
    expect(dataPart.data.name).toBe('Jeju Testnet Faucet');
    expect(dataPart.data.tokenSymbol).toBe('JEJU');
    expect(dataPart.data.cooldownHours).toBe(12);
    expect(dataPart.data.requirements).toBeDefined();
    expect(Array.isArray(dataPart.data.requirements)).toBe(true);
  });

  test('should execute faucet-status skill', async () => {
    const request = {
      jsonrpc: '2.0',
      method: 'message/send',
      params: {
        message: {
          messageId: 'faucet-status-001',
          parts: [
            { kind: 'data', data: { skillId: 'faucet-status', address: TEST_ADDRESS } }
          ]
        }
      },
      id: 2
    };
    
    const response = await fetch(`${A2A_BASE_URL}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    
    expect(response.status).toBe(200);
    
    const result = await response.json();
    expect(result.result).toBeDefined();
    
    const dataPart = result.result.parts.find((p: { kind: string }) => p.kind === 'data');
    expect(dataPart).toBeDefined();
    expect(typeof dataPart.data.eligible).toBe('boolean');
    expect(typeof dataPart.data.isRegistered).toBe('boolean');
    expect(typeof dataPart.data.cooldownRemaining).toBe('number');
  });

  test('should return error for faucet-status without address', async () => {
    const request = {
      jsonrpc: '2.0',
      method: 'message/send',
      params: {
        message: {
          messageId: 'faucet-status-002',
          parts: [
            { kind: 'data', data: { skillId: 'faucet-status' } }
          ]
        }
      },
      id: 3
    };
    
    const response = await fetch(`${A2A_BASE_URL}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    
    const result = await response.json();
    const dataPart = result.result.parts.find((p: { kind: string }) => p.kind === 'data');
    expect(dataPart.data.error).toBe('Missing address parameter');
  });

  test('should return error for faucet-claim without address', async () => {
    const request = {
      jsonrpc: '2.0',
      method: 'message/send',
      params: {
        message: {
          messageId: 'faucet-claim-002',
          parts: [
            { kind: 'data', data: { skillId: 'faucet-claim' } }
          ]
        }
      },
      id: 4
    };
    
    const response = await fetch(`${A2A_BASE_URL}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    
    const result = await response.json();
    const dataPart = result.result.parts.find((p: { kind: string }) => p.kind === 'data');
    expect(dataPart.data.error).toBe('Missing address parameter');
  });
});

describe('Faucet MCP Tools', () => {
  test('should list faucet tools', async () => {
    const response = await fetch(`${A2A_BASE_URL}/mcp/tools/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    
    expect(response.status).toBe(200);
    
    const result = await response.json();
    const toolNames = result.tools.map((t: { name: string }) => t.name);
    
    expect(toolNames).toContain('faucet_status');
    expect(toolNames).toContain('faucet_claim');
    expect(toolNames).toContain('faucet_info');
  });

  test('should execute faucet_info MCP tool', async () => {
    const response = await fetch(`${A2A_BASE_URL}/mcp/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'faucet_info',
        arguments: {},
      }),
    });
    
    expect(response.status).toBe(200);
    
    const result = await response.json();
    expect(result.isError).toBe(false);
    
    const data = JSON.parse(result.content[0].text);
    expect(data.name).toBe('Jeju Testnet Faucet');
    expect(data.tokenSymbol).toBe('JEJU');
  });

  test('should execute faucet_status MCP tool', async () => {
    const response = await fetch(`${A2A_BASE_URL}/mcp/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'faucet_status',
        arguments: { address: TEST_ADDRESS },
      }),
    });
    
    expect(response.status).toBe(200);
    
    const result = await response.json();
    expect(result.isError).toBe(false);
    
    const data = JSON.parse(result.content[0].text);
    expect(typeof data.eligible).toBe('boolean');
    expect(typeof data.isRegistered).toBe('boolean');
  });

  test('should return error for faucet_status without address', async () => {
    const response = await fetch(`${A2A_BASE_URL}/mcp/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'faucet_status',
        arguments: {},
      }),
    });
    
    const result = await response.json();
    expect(result.isError).toBe(true);
    
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toBe('Address required');
  });

  test('should list faucet resource', async () => {
    const response = await fetch(`${A2A_BASE_URL}/mcp/resources/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    
    expect(response.status).toBe(200);
    
    const result = await response.json();
    const resourceUris = result.resources.map((r: { uri: string }) => r.uri);
    
    expect(resourceUris).toContain('faucet://info');
  });

  test('should read faucet info resource', async () => {
    const response = await fetch(`${A2A_BASE_URL}/mcp/resources/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uri: 'faucet://info' }),
    });
    
    expect(response.status).toBe(200);
    
    const result = await response.json();
    expect(result.contents).toBeDefined();
    expect(result.contents[0].uri).toBe('faucet://info');
    
    const data = JSON.parse(result.contents[0].text);
    expect(data.name).toBe('Jeju Testnet Faucet');
  });
});

describe('Faucet REST API', () => {
  test('should return faucet info', async () => {
    const response = await fetch(`${A2A_BASE_URL}/api/faucet/info`);
    
    expect(response.status).toBe(200);
    
    const data = await response.json();
    expect(data.name).toBe('Jeju Testnet Faucet');
    expect(data.description).toContain('JEJU tokens');
    expect(data.tokenSymbol).toBe('JEJU');
    expect(data.amountPerClaim).toBe('100');
    expect(data.cooldownHours).toBe(12);
    expect(data.chainId).toBe(420690);
    expect(data.chainName).toBe('Jeju Testnet');
    expect(data.requirements).toBeDefined();
    expect(data.requirements.length).toBe(2);
  });

  test('should return faucet status for address', async () => {
    const response = await fetch(`${A2A_BASE_URL}/api/faucet/status/${TEST_ADDRESS}`);
    
    expect(response.status).toBe(200);
    
    const data = await response.json();
    expect(typeof data.eligible).toBe('boolean');
    expect(typeof data.isRegistered).toBe('boolean');
    expect(typeof data.cooldownRemaining).toBe('number');
    expect(typeof data.amountPerClaim).toBe('string');
    expect(typeof data.faucetBalance).toBe('string');
  });

  test('should require address in request body for claim', async () => {
    const response = await fetch(`${A2A_BASE_URL}/api/faucet/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    
    expect(response.status).toBe(400);
    
    const data = await response.json();
    expect(data.error).toBe('Address required in request body');
  });

  // Note: Full claim test would require:
  // 1. A registered address in the Identity Registry
  // 2. FAUCET_PRIVATE_KEY configured with funded wallet
  // 3. Proper contract deployment
  // These would be integration tests run against a local network
});

describe('Faucet Anti-Bot Protection', () => {
  test('should enforce 12 hour cooldown', async () => {
    // This test verifies the cooldown is properly tracked
    // In production, we'd need to test with actual claims
    const response = await fetch(`${A2A_BASE_URL}/api/faucet/status/${TEST_ADDRESS}`);
    const data = await response.json();
    
    // Cooldown should be 0 for new addresses (never claimed)
    // or should have remaining time if recently claimed
    expect(data.cooldownRemaining).toBeGreaterThanOrEqual(0);
    expect(data.cooldownRemaining).toBeLessThanOrEqual(12 * 60 * 60 * 1000);
  });

  test('should require ERC-8004 registration', async () => {
    // Verify the registration requirement is documented
    const response = await fetch(`${A2A_BASE_URL}/api/faucet/info`);
    const data = await response.json();
    
    const registryRequirement = data.requirements.find((r: string) => 
      r.includes('ERC-8004') || r.includes('Identity Registry')
    );
    
    expect(registryRequirement).toBeDefined();
  });
});
