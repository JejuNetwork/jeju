/**
 * Dstack TEE Client for network
 *
 * Provides a unified interface for interacting with Dstack TEE
 * Works with both simulator (development) and production TDX hardware
 */

import { existsSync } from 'node:fs'
import { expectValid } from '@jejunetwork/types'
import { z } from 'zod'
import {
  TappdDeriveKeyResponseSchema,
  TappdInfoResponseSchema,
  TappdKeyResponseSchema,
  TappdQuoteResponseSchema,
} from '../schemas'
import type {
  AttestationQuote,
  DerivedKey,
  TEEInfo,
  TLSCertificate,
} from './types'

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
    // Determine endpoint from config or environment
    const endpoint = config.endpoint ?? process.env.DSTACK_ENDPOINT
    if (!endpoint) {
      // Check if we're in a TEE environment
      if (existsSync('/var/run/dstack.sock')) {
        this.endpoint = 'unix:/var/run/dstack.sock'
      } else {
        throw new Error(
          'DSTACK_ENDPOINT must be configured or running in a TEE environment',
        )
      }
    } else {
      this.endpoint = endpoint
    }

    this.isSimulator =
      config.forceSimulator === true ||
      process.env.DSTACK_SIMULATOR === 'true' ||
      this.endpoint.includes('simulator')

    this.timeout = config.timeout ?? 30000
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
    const response = await this.request(
      '/info',
      TappdInfoResponseSchema,
      'Dstack info',
    )
    return {
      isSimulator: this.isSimulator,
      appId: response.app_id,
      instanceId: response.instance_id,
      osImageHash: response.os_image_hash,
      composeHash: response.compose_hash,
    }
  }

  /**
   * Get an attestation quote with custom report data
   *
   * @param reportData - Hex-encoded data to include in the quote (max 64 bytes)
   * @returns Attestation quote that can be verified
   */
  async getAttestation(reportData: string): Promise<AttestationQuote> {
    const cleanData = reportData.startsWith('0x')
      ? reportData
      : `0x${reportData}`

    const response = await this.request(
      `/GetQuote?report_data=${cleanData}`,
      TappdQuoteResponseSchema,
      'Dstack quote',
    )

    return {
      quote: response.quote,
      eventLog: response.event_log,
      isSimulated: this.isSimulator,
      reportData: cleanData,
    }
  }

  /**
   * Derive a key for a specific purpose
   *
   * @param purpose - Purpose of the key (e.g., 'signing', 'encryption')
   * @param path - Optional derivation path (defaults to /jeju/{purpose})
   * @returns Derived key with signature chain
   */
  async deriveKey(purpose: string, path?: string): Promise<DerivedKey> {
    const derivationPath = path ?? `/jeju/${purpose}`

    const response = await this.request(
      '/DeriveKey',
      TappdDeriveKeyResponseSchema,
      'Dstack derive key',
      {
        method: 'POST',
        body: JSON.stringify({ path: derivationPath, purpose }),
      },
    )

    // The response is a JSON object with key and signature
    // The key field contains the hex-encoded key material
    return {
      privateKey: response.key,
      publicKey: response.key,
      path: derivationPath,
      signature: response.signature,
    }
  }

  /**
   * Get a TLS certificate signed by the TEE
   *
   * @param domain - Domain name for the certificate
   * @param altNames - Optional alternative names
   * @returns TLS certificate and private key
   */
  async getTLSCertificate(
    domain: string,
    altNames?: string[],
  ): Promise<TLSCertificate> {
    const response = await this.request(
      '/GetTlsKey',
      TappdKeyResponseSchema,
      'Dstack TLS key',
      {
        method: 'POST',
        body: JSON.stringify({
          domain,
          alt_names: altNames ?? [],
          // Request RA-TLS certificate if in production mode
          ra_tls: !this.isSimulator,
        }),
      },
    )

    return {
      certificate: response.certificate_chain[0],
      privateKey: response.key,
      chain: response.certificate_chain.slice(1),
    }
  }

  /**
   * Make a request to the Dstack endpoint with validated response
   */
  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    context: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = this.buildUrl(path)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`Dstack request failed: ${response.status} - ${error}`)
      }

      return expectValid(schema, await response.json(), context)
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
      // For now, assume there's an HTTP bridge
      const httpEndpoint = process.env.DSTACK_HTTP_ENDPOINT
      if (!httpEndpoint) {
        throw new Error(
          'DSTACK_HTTP_ENDPOINT must be set when using Unix socket',
        )
      }
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
  if (process.env.DSTACK_ENDPOINT) return true
  return existsSync('/var/run/dstack.sock') || existsSync('/dev/tdx_guest')
}
