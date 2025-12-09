/**
 * IPFS Client for JejuDA
 */

import type { IPFSAddResponse, IPFSIDResponse } from './types';

export class IPFSClient {
  private apiUrl: string;
  private gatewayUrl: string;

  constructor(apiUrl: string, gatewayUrl: string) {
    this.apiUrl = apiUrl;
    this.gatewayUrl = gatewayUrl;
  }

  /**
   * Store data in IPFS and pin it
   */
  async add(data: Buffer): Promise<string> {
    const formData = new FormData();
    formData.append('file', new Blob([data]));

    const response = await fetch(`${this.apiUrl}/api/v0/add?pin=true`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`IPFS add failed: ${response.status} ${text}`);
    }

    const result = (await response.json()) as IPFSAddResponse;
    return result.Hash;
  }

  /**
   * Fetch data from IPFS by CID
   */
  async get(cid: string): Promise<Buffer | null> {
    const response = await fetch(`${this.gatewayUrl}/ipfs/${cid}`);

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`IPFS get failed: ${response.status}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * Pin a CID to ensure it's retained
   */
  async pin(cid: string): Promise<boolean> {
    const response = await fetch(`${this.apiUrl}/api/v0/pin/add?arg=${cid}`, {
      method: 'POST',
    });

    return response.ok;
  }

  /**
   * Unpin a CID
   */
  async unpin(cid: string): Promise<boolean> {
    const response = await fetch(`${this.apiUrl}/api/v0/pin/rm?arg=${cid}`, {
      method: 'POST',
    });

    return response.ok;
  }

  /**
   * Check if IPFS node is healthy
   */
  async isHealthy(): Promise<boolean> {
    const response = await fetch(`${this.apiUrl}/api/v0/id`, {
      method: 'POST',
    }).catch(() => null);

    return response?.ok ?? false;
  }

  /**
   * Get IPFS node info
   */
  async getNodeInfo(): Promise<IPFSIDResponse | null> {
    const response = await fetch(`${this.apiUrl}/api/v0/id`, {
      method: 'POST',
    }).catch(() => null);

    if (!response?.ok) {
      return null;
    }

    return (await response.json()) as IPFSIDResponse;
  }
}


