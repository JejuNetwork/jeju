/**
 * DWS SDK
 */

import type { Account, WalletClient } from 'viem'
import type {
  AuthHeaders,
  InferenceRequest,
  InferenceResponse,
  UploadResult,
} from '../types'

export interface DWSSDKConfig {
  baseUrl: string
  account?: Account
  walletClient?: WalletClient
}

export class DWSSDK {
  private baseUrl: string
  private account?: Account
  private walletClient?: WalletClient
  private address?: string

  constructor(config: DWSSDKConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
    this.account = config.account
    this.walletClient = config.walletClient
    if (this.account) this.address = this.account.address
  }

  async connect(): Promise<void> {
    if (this.account) this.address = this.account.address
  }

  async generateAuthHeaders(): Promise<AuthHeaders> {
    if (!this.walletClient || !this.account)
      throw new Error('WalletClient and Account required')
    if (!this.address) this.address = this.account.address

    const timestamp = Date.now().toString()
    const nonce = Math.random().toString(36).slice(2)
    const signature = await this.walletClient.signMessage({
      account: this.account,
      message: `DWS Auth\nTimestamp: ${timestamp}\nNonce: ${nonce}`,
    })

    return {
      'x-jeju-address': this.address,
      'x-jeju-nonce': nonce,
      'x-jeju-signature': signature,
      'x-jeju-timestamp': timestamp,
    }
  }

  async uploadFile(
    file: File | Blob | ArrayBuffer,
    options?: { filename?: string; permanent?: boolean },
  ): Promise<UploadResult> {
    const formData = new FormData()
    const blob =
      file instanceof ArrayBuffer ? new Blob([new Uint8Array(file)]) : file
    formData.append('file', blob, options?.filename || 'file')
    if (options?.permanent) formData.append('permanent', 'true')

    const headers: Record<string, string> = {}
    if (this.account) Object.assign(headers, await this.generateAuthHeaders())

    const response = await fetch(`${this.baseUrl}/storage/upload`, {
      method: 'POST',
      headers,
      body: formData,
    })
    if (!response.ok) throw new Error(`Upload failed: ${response.statusText}`)
    return response.json()
  }

  async downloadFile(cid: string): Promise<Buffer> {
    const response = await fetch(`${this.baseUrl}/storage/download/${cid}`)
    if (!response.ok) throw new Error(`Download failed: ${response.statusText}`)
    return Buffer.from(await response.arrayBuffer())
  }

  async inference(request: InferenceRequest): Promise<InferenceResponse> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (this.account) Object.assign(headers, await this.generateAuthHeaders())

    const response = await fetch(`${this.baseUrl}/compute/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    })
    if (!response.ok)
      throw new Error(`Inference failed: ${response.statusText}`)
    return response.json()
  }

  async resolveJNS(
    name: string,
  ): Promise<{ name: string; contentHash: string | null }> {
    const response = await fetch(`${this.baseUrl}/cdn/resolve/${name}`)
    if (!response.ok) throw new Error(`Resolve failed: ${response.statusText}`)
    return response.json()
  }
}

export function createDWSSDK(config: DWSSDKConfig): DWSSDK {
  return new DWSSDK(config)
}
