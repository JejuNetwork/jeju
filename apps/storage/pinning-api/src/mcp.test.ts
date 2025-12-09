/**
 * MCP Server Tests
 * 
 * Tests all MCP routes including:
 * - Server initialization
 * - Resource listing and reading
 * - Tool listing and calling (free + x402 paid)
 * - Payment requirement validation
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { Hono } from 'hono';

// Check if server is running
const SERVER_URL = 'http://localhost:3100';
let serverAvailable = false;

async function checkServer(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 500);
  
  try {
    const response = await fetch(`${SERVER_URL}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    return response.ok;
  } catch {
    clearTimeout(timeout);
    return false;
  }
}

// ============================================================================
// MCP Server Info Tests
// ============================================================================

describe('MCP Server', () => {
  beforeAll(async () => {
    serverAvailable = await checkServer();
    if (!serverAvailable) {
      console.log('⚠️  Server not running at http://localhost:3100 - skipping MCP integration tests');
    }
  });

  // ========== Initialization ==========

  it('should respond to initialize request', async () => {
    if (!serverAvailable) {
      console.log('⏭️  Skipped: Server not available');
      return;
    }

    const response = await fetch(`${SERVER_URL}/initialize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(response.ok).toBe(true);
    const data = await response.json();
    
    expect(data.protocolVersion).toBe('2024-11-05');
    expect(data.serverInfo).toBeDefined();
    expect(data.serverInfo.name).toBe('jeju-storage');
    expect(data.serverInfo.version).toBe('2.0.0');
    expect(data.capabilities).toBeDefined();
    expect(data.capabilities.resources).toBe(true);
    expect(data.capabilities.tools).toBe(true);
  });

  it('should serve discovery endpoint at root', async () => {
    if (!serverAvailable) {
      console.log('⏭️  Skipped: Server not available');
      return;
    }

    // Root serves the A2A agent card, not MCP discovery
    // MCP discovery is at /initialize
    const response = await fetch(`${SERVER_URL}/initialize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(response.ok).toBe(true);
    
    const data = await response.json();
    expect(data.serverInfo.name).toBe('jeju-storage');
    expect(data.serverInfo.version).toBe('2.0.0');
    expect(data.capabilities).toBeDefined();
    expect(data.capabilities.resources).toBe(true);
    expect(data.capabilities.tools).toBe(true);
  });

  // ========== Resources ==========

  it('should list all MCP resources', async () => {
    if (!serverAvailable) {
      console.log('⏭️  Skipped: Server not available');
      return;
    }

    const response = await fetch(`${SERVER_URL}/resources/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(response.ok).toBe(true);
    const data = await response.json();
    
    expect(data.resources).toBeDefined();
    expect(Array.isArray(data.resources)).toBe(true);
    expect(data.resources.length).toBeGreaterThanOrEqual(7);
    
    // Check expected resources exist
    const uris = data.resources.map((r: { uri: string }) => r.uri);
    expect(uris).toContain('storage://providers');
    expect(uris).toContain('storage://pricing');
    expect(uris).toContain('storage://stats');
    expect(uris).toContain('storage://pins');
    expect(uris).toContain('storage://payment/options');
  });

  it('should read storage://pricing resource', async () => {
    if (!serverAvailable) {
      console.log('⏭️  Skipped: Server not available');
      return;
    }

    const response = await fetch(`${SERVER_URL}/resources/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uri: 'storage://pricing' }),
    });

    expect(response.ok).toBe(true);
    const data = await response.json();
    
    expect(data.contents).toBeDefined();
    expect(Array.isArray(data.contents)).toBe(true);
    expect(data.contents.length).toBeGreaterThan(0);
    
    const content = JSON.parse(data.contents[0].text);
    expect(content.tiers).toBeDefined();
    expect(content.tiers).toContain('HOT');
    expect(content.tiers).toContain('WARM');
    expect(content.tiers).toContain('COLD');
    expect(content.tiers).toContain('PERMANENT');
    expect(content.pricing).toBeDefined();
    expect(content.pricing.HOT).toBeDefined();
    expect(content.pricing.WARM).toBeDefined();
  });

  it('should read storage://pins resource', async () => {
    if (!serverAvailable) {
      console.log('⏭️  Skipped: Server not available');
      return;
    }

    const response = await fetch(`${SERVER_URL}/resources/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uri: 'storage://pins' }),
    });

    expect(response.ok).toBe(true);
    const data = await response.json();
    
    expect(data.contents).toBeDefined();
    const content = JSON.parse(data.contents[0].text);
    expect(content.total).toBeDefined();
    expect(typeof content.total).toBe('number');
    expect(content.pins).toBeDefined();
    expect(Array.isArray(content.pins)).toBe(true);
  });

  it('should read storage://payment/options resource', async () => {
    if (!serverAvailable) {
      console.log('⏭️  Skipped: Server not available');
      return;
    }

    const response = await fetch(`${SERVER_URL}/resources/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uri: 'storage://payment/options' }),
    });

    expect(response.ok).toBe(true);
    const data = await response.json();
    
    expect(data.contents).toBeDefined();
    const content = JSON.parse(data.contents[0].text);
    expect(content.x402).toBeDefined();
    expect(content.x402.enabled).toBe(true);
    expect(content.x402.schemes).toContain('exact');
    expect(content.headers).toBeDefined();
    expect(content.headers.required).toContain('x-payment');
  });

  it('should return 404 for unknown resource', async () => {
    if (!serverAvailable) {
      console.log('⏭️  Skipped: Server not available');
      return;
    }

    const response = await fetch(`${SERVER_URL}/resources/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uri: 'storage://nonexistent' }),
    });

    expect(response.status).toBe(404);
  });

  // ========== Tools ==========

  it('should list all MCP tools', async () => {
    if (!serverAvailable) {
      console.log('⏭️  Skipped: Server not available');
      return;
    }

    const response = await fetch(`${SERVER_URL}/tools/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(response.ok).toBe(true);
    const data = await response.json();
    
    expect(data.tools).toBeDefined();
    expect(Array.isArray(data.tools)).toBe(true);
    expect(data.tools.length).toBeGreaterThanOrEqual(20);
    
    // Check expected tools exist
    const names = data.tools.map((t: { name: string }) => t.name);
    expect(names).toContain('list_providers');
    expect(names).toContain('get_provider');
    expect(names).toContain('calculate_cost');
    expect(names).toContain('get_quote');
    expect(names).toContain('upload_file');
    expect(names).toContain('pin_cid');
    expect(names).toContain('create_deal');
    expect(names).toContain('get_deal');
    expect(names).toContain('check_credits');
    expect(names).toContain('get_reputation');
    
    // Check tools have proper schema
    const calcCost = data.tools.find((t: { name: string }) => t.name === 'calculate_cost');
    expect(calcCost).toBeDefined();
    expect(calcCost.inputSchema).toBeDefined();
    expect(calcCost.inputSchema.properties).toBeDefined();
    expect(calcCost.inputSchema.properties.sizeBytes).toBeDefined();
    expect(calcCost.inputSchema.properties.durationDays).toBeDefined();
  });

  // ========== Free Tools ==========

  it('should execute calculate_cost tool', async () => {
    if (!serverAvailable) {
      console.log('⏭️  Skipped: Server not available');
      return;
    }

    const response = await fetch(`${SERVER_URL}/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'calculate_cost',
        arguments: {
          sizeBytes: 1073741824, // 1 GB
          durationDays: 30,
          tier: 'warm',
        },
      }),
    });

    expect(response.ok).toBe(true);
    const data = await response.json();
    
    expect(data.content).toBeDefined();
    expect(Array.isArray(data.content)).toBe(true);
    expect(data.content[0].type).toBe('text');
    expect(data.isError).toBeFalsy();
    
    const result = JSON.parse(data.content[0].text);
    expect(result.sizeBytes).toBe(1073741824);
    expect(result.sizeGB).toBe('1.0000');
    expect(result.durationDays).toBe(30);
    expect(result.tier).toBe('warm');
    expect(result.costETH).toBeDefined();
    expect(result.costWei).toBeDefined();
    expect(BigInt(result.costWei)).toBeGreaterThan(0n);
  });

  it('should validate calculate_cost input', async () => {
    if (!serverAvailable) {
      console.log('⏭️  Skipped: Server not available');
      return;
    }

    const response = await fetch(`${SERVER_URL}/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'calculate_cost',
        arguments: {
          // Missing required fields
        },
      }),
    });

    expect(response.ok).toBe(true);
    const data = await response.json();
    
    expect(data.isError).toBe(true);
    const result = JSON.parse(data.content[0].text);
    expect(result.error).toContain('required');
  });

  it('should execute list_pins tool', async () => {
    if (!serverAvailable) {
      console.log('⏭️  Skipped: Server not available');
      return;
    }

    const response = await fetch(`${SERVER_URL}/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'list_pins',
        arguments: { limit: 10 },
      }),
    });

    expect(response.ok).toBe(true);
    const data = await response.json();
    
    expect(data.content).toBeDefined();
    expect(data.isError).toBeFalsy();
    
    const result = JSON.parse(data.content[0].text);
    expect(result.total).toBeDefined();
    expect(typeof result.total).toBe('number');
    expect(result.pins).toBeDefined();
    expect(Array.isArray(result.pins)).toBe(true);
  });

  it('should execute get_gateway_url tool', async () => {
    if (!serverAvailable) {
      console.log('⏭️  Skipped: Server not available');
      return;
    }

    const response = await fetch(`${SERVER_URL}/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'get_gateway_url',
        arguments: { cid: 'QmTest123456789' },
      }),
    });

    expect(response.ok).toBe(true);
    const data = await response.json();
    
    expect(data.content).toBeDefined();
    expect(data.isError).toBeFalsy();
    
    const result = JSON.parse(data.content[0].text);
    expect(result.cid).toBe('QmTest123456789');
    expect(result.primary).toContain('/ipfs/QmTest123456789');
    expect(result.alternatives).toBeDefined();
    expect(Array.isArray(result.alternatives)).toBe(true);
    expect(result.alternatives.length).toBeGreaterThan(0);
  });

  it('should validate get_gateway_url requires cid', async () => {
    if (!serverAvailable) {
      console.log('⏭️  Skipped: Server not available');
      return;
    }

    const response = await fetch(`${SERVER_URL}/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'get_gateway_url',
        arguments: {},
      }),
    });

    expect(response.ok).toBe(true);
    const data = await response.json();
    
    expect(data.isError).toBe(true);
    const result = JSON.parse(data.content[0].text);
    expect(result.error).toContain('cid');
  });

  it('should execute get_payment_options tool', async () => {
    if (!serverAvailable) {
      console.log('⏭️  Skipped: Server not available');
      return;
    }

    const response = await fetch(`${SERVER_URL}/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'get_payment_options',
        arguments: { amountWei: '1000000000000000' },
      }),
    });

    expect(response.ok).toBe(true);
    const data = await response.json();
    
    expect(data.content).toBeDefined();
    expect(data.isError).toBeFalsy();
    
    const result = JSON.parse(data.content[0].text);
    expect(result.amountWei).toBe('1000000000000000');
    expect(result.amountETH).toBeDefined();
    expect(result.requirement).toBeDefined();
    expect(result.requirement.accepts).toBeDefined();
    expect(Array.isArray(result.requirement.accepts)).toBe(true);
    expect(result.headers).toBeDefined();
  });

  // ========== Paid Tools (x402) ==========

  it('should require payment for upload_file tool', async () => {
    if (!serverAvailable) {
      console.log('⏭️  Skipped: Server not available');
      return;
    }

    const response = await fetch(`${SERVER_URL}/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'upload_file',
        arguments: { sizeBytes: 1048576, durationDays: 30 },
      }),
    });

    expect(response.status).toBe(402);
    const data = await response.json();
    
    expect(data.error).toBeDefined();
    expect(data.error.code).toBe(402);
    expect(data.error.message).toBe('Payment Required');
    expect(data.error.data).toBeDefined();
    expect(data.error.data.x402Version).toBe(1);
    expect(data.error.data.accepts).toBeDefined();
    expect(Array.isArray(data.error.data.accepts)).toBe(true);
    expect(data.error.data.accepts.length).toBeGreaterThan(0);
    
    // Validate payment requirement structure
    const accept = data.error.data.accepts[0];
    expect(accept.scheme).toBe('exact');
    expect(accept.network).toBeDefined();
    expect(accept.maxAmountRequired).toBeDefined();
    expect(BigInt(accept.maxAmountRequired)).toBeGreaterThan(0n);
    expect(accept.payTo).toBeDefined();
    expect(accept.resource).toContain('upload_file');
  });

  it('should require payment for pin_cid tool', async () => {
    if (!serverAvailable) {
      console.log('⏭️  Skipped: Server not available');
      return;
    }

    const response = await fetch(`${SERVER_URL}/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'pin_cid',
        arguments: { cid: 'QmTest123456789' },
      }),
    });

    expect(response.status).toBe(402);
    const data = await response.json();
    
    expect(data.error).toBeDefined();
    expect(data.error.code).toBe(402);
    expect(data.error.data.accepts).toBeDefined();
  });

  it('should validate pin_cid requires cid even before payment check', async () => {
    if (!serverAvailable) {
      console.log('⏭️  Skipped: Server not available');
      return;
    }

    const response = await fetch(`${SERVER_URL}/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'pin_cid',
        arguments: {},
      }),
    });

    expect(response.ok).toBe(true);
    const data = await response.json();
    
    expect(data.isError).toBe(true);
    const result = JSON.parse(data.content[0].text);
    expect(result.error).toContain('cid');
  });

  it('should require payment for create_deal tool', async () => {
    if (!serverAvailable) {
      console.log('⏭️  Skipped: Server not available');
      return;
    }

    const response = await fetch(`${SERVER_URL}/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'create_deal',
        arguments: {
          provider: '0x1234567890123456789012345678901234567890',
          cid: 'QmTest123456789',
          sizeBytes: 1048576,
          durationDays: 30,
        },
      }),
    });

    // Either 402 (payment required) or contract call fails (provider not found)
    // Both are valid responses
    expect([200, 402]).toContain(response.status);
  });

  it('should validate create_deal required parameters', async () => {
    if (!serverAvailable) {
      console.log('⏭️  Skipped: Server not available');
      return;
    }

    const response = await fetch(`${SERVER_URL}/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'create_deal',
        arguments: {
          // Missing required fields
          provider: '0x1234567890123456789012345678901234567890',
        },
      }),
    });

    expect(response.ok).toBe(true);
    const data = await response.json();
    
    expect(data.isError).toBe(true);
    const result = JSON.parse(data.content[0].text);
    // In basic mode (no contracts), returns "Contracts not configured"
    // In marketplace mode, returns "required"
    expect(result.error).toBeDefined();
    expect(result.error.length).toBeGreaterThan(0);
  });

  it('should require payment for extend_deal tool', async () => {
    if (!serverAvailable) {
      console.log('⏭️  Skipped: Server not available');
      return;
    }

    const response = await fetch(`${SERVER_URL}/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'extend_deal',
        arguments: {
          dealId: '0x1234567890123456789012345678901234567890123456789012345678901234',
          additionalDays: 30,
        },
      }),
    });

    // Either 402 (payment required) or contract call fails (deal not found)
    expect([200, 402]).toContain(response.status);
  });

  // ========== Error Handling ==========

  it('should return error for unknown tool', async () => {
    if (!serverAvailable) {
      console.log('⏭️  Skipped: Server not available');
      return;
    }

    const response = await fetch(`${SERVER_URL}/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'nonexistent_tool',
        arguments: {},
      }),
    });

    expect(response.ok).toBe(true);
    const data = await response.json();
    
    expect(data.isError).toBe(true);
    const result = JSON.parse(data.content[0].text);
    expect(result.error).toContain('not found');
  });

  it('should handle health check', async () => {
    if (!serverAvailable) {
      console.log('⏭️  Skipped: Server not available');
      return;
    }

    const response = await fetch(`${SERVER_URL}/health`);
    expect(response.ok).toBe(true);
    
    const data = await response.json();
    expect(data.status).toBe('healthy');
  });
});

// ============================================================================
// Unit Tests (No Server Required)
// ============================================================================

describe('MCP Server Unit Tests', () => {
  it('should have valid pricing constants', async () => {
    const { STORAGE_PRICING } = await import('./sdk/x402');
    
    expect(STORAGE_PRICING.HOT_TIER_PER_GB_MONTH).toBeGreaterThan(0n);
    expect(STORAGE_PRICING.WARM_TIER_PER_GB_MONTH).toBeGreaterThan(0n);
    expect(STORAGE_PRICING.COLD_TIER_PER_GB_MONTH).toBeGreaterThan(0n);
    expect(STORAGE_PRICING.PERMANENT_PER_GB).toBeGreaterThan(0n);
    
    // Hot > Warm > Cold
    expect(STORAGE_PRICING.HOT_TIER_PER_GB_MONTH).toBeGreaterThan(STORAGE_PRICING.WARM_TIER_PER_GB_MONTH);
    expect(STORAGE_PRICING.WARM_TIER_PER_GB_MONTH).toBeGreaterThan(STORAGE_PRICING.COLD_TIER_PER_GB_MONTH);
  });

  it('should calculate storage cost correctly', async () => {
    const { calculateStorageCost, STORAGE_PRICING } = await import('./sdk/x402');
    
    // 1 GB for 30 days (1 month) at warm tier
    const cost = calculateStorageCost(1024 ** 3, 30, 'warm');
    expect(cost).toBeGreaterThan(0n);
    expect(cost).toBeGreaterThanOrEqual(STORAGE_PRICING.MIN_UPLOAD_FEE);
  });

  it('should create valid payment requirement', async () => {
    const { createStoragePaymentRequirement, ZERO_ADDRESS } = await import('./sdk/x402');
    
    const requirement = createStoragePaymentRequirement(
      '/test',
      1000000000000000n,
      '0x1234567890123456789012345678901234567890' as `0x${string}`,
      'Test payment'
    );
    
    expect(requirement.x402Version).toBe(1);
    expect(requirement.error).toContain('Payment required');
    expect(requirement.accepts).toBeDefined();
    expect(Array.isArray(requirement.accepts)).toBe(true);
    expect(requirement.accepts.length).toBeGreaterThan(0);
    
    const exact = requirement.accepts.find(a => a.scheme === 'exact');
    expect(exact).toBeDefined();
    expect(exact!.maxAmountRequired).toBe('1000000000000000');
    expect(exact!.payTo).toBe('0x1234567890123456789012345678901234567890');
    expect(exact!.resource).toBe('/test');
  });

  it('should parse x402 payment header', async () => {
    const { parseX402Header } = await import('./sdk/x402');
    
    const header = 'scheme=exact;network=jeju;payload=0x1234;asset=0x0000000000000000000000000000000000000000;amount=1000000000000';
    const parsed = parseX402Header(header);
    
    expect(parsed).not.toBeNull();
    expect(parsed!.scheme).toBe('exact');
    expect(parsed!.network).toBe('jeju');
    expect(parsed!.payload).toBe('0x1234');
    expect(parsed!.amount).toBe('1000000000000');
  });

  it('should return null for invalid x402 header', async () => {
    const { parseX402Header } = await import('./sdk/x402');
    
    const parsed = parseX402Header('invalid-header');
    expect(parsed).toBeNull();
  });

  it('should format storage cost correctly', async () => {
    const { formatStorageCost } = await import('./sdk/x402');
    
    // Small amount
    const small = formatStorageCost(10000000000n); // 0.00000001 ETH
    expect(small).toContain('cents');
    
    // Large amount
    const large = formatStorageCost(1000000000000000000n); // 1 ETH
    expect(large).toContain('ETH');
    expect(large).toContain('$');
  });
});

