/**
 * Dstack TEE Client for network
 * 
 * Provides a unified interface for interacting with Dstack TEE
 * Works with both simulator (development) and production TDX hardware
 */

import type { AttestationQuote, DerivedKey, TLSCertificate, TEEInfo } from './types'

interface TappdQuoteResponse {
  quote: string
  event_log: string
}

interface TappdKeyResponse {
  key: string
  certificate_chain: string[]
}

interface TappdDeriveKeyResponse {
  asBytes: () => Uint8Array
  toJSON: () => { key: string; signature: string }
}

interface TappdInfoResponse {
  app_id: string
  instance_id: string
  os_image_hash: string
  compose_hash: string
  tcb_info: Record<string, unknown>
}

/**
 * Configuration for Dstack client
 */
export interface DstackClientConfig {
  /** Endpoint URL or Unix socket path */
  endpoint?: string
  /** Force simulator mode even if real TEE is available */
  forceSimulator?: boolean
  /** Timeout for requests in milliseconds */
  timeout?: number
}

/**
 * Dstack TEE Client
 * 
 * Usage:
 * ```typescript
 * const client = new DstackClient()
 * 
 * // Get attestation quote
 * const quote = await client.getAttestation('0x1234')
 * 
 * // Derive a key for signing
 * const key = await client.deriveKey('signing')
 * 
 * // Get TLS certificate
 * const cert = await client.getTLSCertificate('my-domain.com')
 * ```
 */
export class DstackClient {
  private endpoint: string
  private isSimulator: boolean
  private timeout: number

  constructor(config: DstackClientConfig = {}) {
    // Default to Unix socket, fall back to simulator endpoint
    this.endpoint = config.endpoint 
      || process.env.DSTACK_ENDPOINT 
      || 'unix:/var/run/dstack.sock'
    
    this.isSimulator = config.forceSimulator 
      || process.env.DSTACK_SIMULATOR === 'true'
      || this.endpoint.includes('simulator')
    
    this.timeout = config.timeout || 30000
  }

  /**
   * Check if connected to a simulator or real TEE
   */
  isSimulatorMode(): boolean {
    return this.isSimulator
  }

  /**
   * Get TEE information
   */
  async getInfo(): Promise<TEEInfo> {
    const response = await this.request<TappdInfoResponse>('/info')
    return {
      isSimulator: this.isSimulator,
      appId: response.app_id,
      instanceId: response.instance_id,
      osImageHash: response.os_image_hash,
      composeHash: response.compose_hash
    }
  }

  /**
   * Get an attestation quote with custom report data
   * 
   * @param reportData - Hex-encoded data to include in the quote (max 64 bytes)
   * @returns Attestation quote that can be verified
   */
  async getAttestation(reportData: string): Promise<AttestationQuote> {
    const cleanData = reportData.startsWith('0x') ? reportData : `0x${reportData}`
    
    const response = await this.request<TappdQuoteResponse>(
      `/GetQuote?report_data=${cleanData}`
    )

    return {
      quote: response.quote,
      eventLog: response.event_log,
      isSimulated: this.isSimulator,
      reportData: cleanData
    }
  }

  /**
   * Derive a key for a specific purpose
   * 
   * @param purpose - Purpose of the key (e.g., 'signing', 'encryption')
   * @param path - Optional derivation path
   * @returns Derived key with signature chain
   */
  async deriveKey(purpose: string, path?: string): Promise<DerivedKey> {
    const derivationPath = path || `/jeju/${purpose}`
    
    const response = await this.request<TappdDeriveKeyResponse>(
      '/DeriveKey',
      {
        method: 'POST',
        body: JSON.stringify({ path: derivationPath, purpose })
      }
    )

    const keyData = response.toJSON()
    const keyBytes = response.asBytes()
    
    // Derive public key from private key
    // In production, this would use proper elliptic curve operations
    const privateKeyHex = Buffer.from(keyBytes).toString('hex')
    
    return {
      privateKey: privateKeyHex,
      publicKey: keyData.key, // The response includes the public key
      path: derivationPath,
      signature: keyData.signature
    }
  }

  /**
   * Get a TLS certificate signed by the TEE
   * 
   * @param domain - Domain name for the certificate
   * @param altNames - Optional alternative names
   * @returns TLS certificate and private key
   */
  async getTLSCertificate(domain: string, altNames?: string[]): Promise<TLSCertificate> {
    const response = await this.request<TappdKeyResponse>(
      '/GetTlsKey',
      {
        method: 'POST',
        body: JSON.stringify({ 
          domain,
          alt_names: altNames || [],
          // Request RA-TLS certificate if in production mode
          ra_tls: !this.isSimulator
        })
      }
    )

    return {
      certificate: response.certificate_chain[0],
      privateKey: response.key,
      chain: response.certificate_chain.slice(1)
    }
  }

  /**
   * Make a request to the Dstack endpoint
   */
  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = this.buildUrl(path)
    
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        }
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`Dstack request failed: ${response.status} - ${error}`)
      }

      return response.json() as Promise<T>
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Build URL from endpoint and path
   */
  private buildUrl(path: string): string {
    if (this.endpoint.startsWith('unix:')) {
      // Unix socket - would need special handling in Node.js
      // For now, assume there's an HTTP bridge or use the HTTP endpoint
      const httpEndpoint = process.env.DSTACK_HTTP_ENDPOINT || 'http://localhost:8090'
      return `${httpEndpoint}${path}`
    }
    
    return `${this.endpoint}${path}`
  }
}

/**
 * Create a Dstack client with default configuration
 */
export function createDstackClient(config?: DstackClientConfig): DstackClient {
  return new DstackClient(config)
}

/**
 * Check if running in a TEE environment
 */
export function isInTEE(): boolean {
  // Check for Dstack socket
  if (process.env.DSTACK_ENDPOINT) return true
  
  // Check for common TEE indicators
  try {
    const fs = require('fs')
    return fs.existsSync('/var/run/dstack.sock') || fs.existsSync('/dev/tdx_guest')
  } catch {
    return false
  }
}

