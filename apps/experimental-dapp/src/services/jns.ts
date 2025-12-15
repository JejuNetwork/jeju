/**
 * JNS Service for dapp naming
 * 
 * Registers and manages the todo.jeju domain for the dApp.
 * Links the dApp to its decentralized endpoints.
 */

import type { Address, Hex } from 'viem';

const GATEWAY_API = process.env.GATEWAY_API || 'http://localhost:4020';
const JNS_NAME = process.env.JNS_NAME || 'todo.jeju';

interface JNSRecords {
  address?: Address;
  contentHash?: string;
  a2aEndpoint?: string;
  mcpEndpoint?: string;
  restEndpoint?: string;
  avatar?: string;
  url?: string;
  description?: string;
}

interface JNSService {
  isNameAvailable(name: string): Promise<boolean>;
  register(name: string, owner: Address, durationYears: number): Promise<{ txHash: Hex; name: string }>;
  setRecords(name: string, records: JNSRecords): Promise<{ txHash: Hex }>;
  getRecords(name: string): Promise<JNSRecords>;
  resolve(name: string): Promise<Address | null>;
  getRegistrationPrice(name: string, durationYears: number): Promise<bigint>;
}

class JNSServiceImpl implements JNSService {
  async isNameAvailable(name: string): Promise<boolean> {
    const normalized = this.normalizeName(name);
    const response = await fetch(`${GATEWAY_API}/jns/available/${normalized}`).catch(() => null);
    if (!response || !response.ok) return false;
    const data = await response.json() as { available: boolean };
    return data.available;
  }

  async register(name: string, owner: Address, durationYears: number): Promise<{ txHash: Hex; name: string }> {
    const normalized = this.normalizeName(name);
    const price = await this.getRegistrationPrice(name, durationYears);

    const response = await fetch(`${GATEWAY_API}/jns/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: normalized,
        owner,
        durationYears,
        price: price.toString(),
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to register name: ${await response.text()}`);
    }

    const data = await response.json() as { txHash: Hex };
    return { txHash: data.txHash, name: normalized };
  }

  async setRecords(name: string, records: JNSRecords): Promise<{ txHash: Hex }> {
    const normalized = this.normalizeName(name);

    const response = await fetch(`${GATEWAY_API}/jns/records/${normalized}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(records),
    });

    if (!response.ok) {
      throw new Error(`Failed to set records: ${await response.text()}`);
    }

    return await response.json() as { txHash: Hex };
  }

  async getRecords(name: string): Promise<JNSRecords> {
    const normalized = this.normalizeName(name);
    const response = await fetch(`${GATEWAY_API}/jns/records/${normalized}`).catch(() => null);
    if (!response || !response.ok) return {};
    return await response.json() as JNSRecords;
  }

  async resolve(name: string): Promise<Address | null> {
    const normalized = this.normalizeName(name);
    const response = await fetch(`${GATEWAY_API}/jns/resolve/${normalized}`).catch(() => null);
    if (!response || !response.ok) return null;
    const data = await response.json() as { address: Address };
    return data.address;
  }

  async getRegistrationPrice(name: string, durationYears: number): Promise<bigint> {
    const normalized = this.normalizeName(name);
    const response = await fetch(`${GATEWAY_API}/jns/price/${normalized}?years=${durationYears}`).catch(() => null);
    if (!response || !response.ok) {
      // Default pricing based on name length
      const label = normalized.replace('.jeju', '');
      const basePrice = label.length <= 3 ? 0.1 : label.length <= 5 ? 0.05 : 0.01;
      return BigInt(Math.floor(basePrice * durationYears * 1e18));
    }
    const data = await response.json() as { price: string };
    return BigInt(data.price);
  }

  private normalizeName(name: string): string {
    return name.endsWith('.jeju') ? name : `${name}.jeju`;
  }
}

let jnsService: JNSService | null = null;

export function getJNSService(): JNSService {
  if (!jnsService) {
    jnsService = new JNSServiceImpl();
  }
  return jnsService;
}

// Helper to setup the dApp's JNS configuration
export async function setupDAppJNS(
  owner: Address,
  config: {
    name: string;
    backendUrl: string;
    frontendCid: string;
    description?: string;
  }
): Promise<JNSRecords> {
  const jns = getJNSService();
  
  // Check if name is available or already owned
  const existing = await jns.getRecords(config.name);
  
  const records: JNSRecords = {
    address: owner,
    contentHash: config.frontendCid ? `ipfs://${config.frontendCid}` : undefined,
    a2aEndpoint: `${config.backendUrl}/a2a`,
    mcpEndpoint: `${config.backendUrl}/mcp`,
    restEndpoint: `${config.backendUrl}/api/v1`,
    description: config.description || 'Decentralized Todo Application',
  };

  // If name not registered, register it
  if (!existing.address) {
    await jns.register(config.name, owner, 1);
  }

  // Update records
  await jns.setRecords(config.name, records);

  return records;
}

export { JNS_NAME };
