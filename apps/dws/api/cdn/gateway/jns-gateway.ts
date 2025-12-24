/**
 * JNS Gateway
 * Resolves JNS names and serves content from IPFS
 */

import type { Address, PublicClient } from 'viem'

export interface JNSGatewayConfig {
  jnsResolver: Address
  storageManager: Address
  workerRegistry: Address
  cdnRegistry: Address
  rpcUrl: string
  ipfsGateway: string
  ipfsApiUrl: string
  publicClient?: PublicClient
}

export class JNSGateway {
  private config: JNSGatewayConfig

  constructor(config: JNSGatewayConfig) {
    this.config = config
  }

  async resolve(_name: string): Promise<string | null> {
    // Stub - JNS resolution logic would go here
    return null
  }

  async handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const hostname = request.headers.get('host') || url.hostname

    // Extract app name from subdomain
    const appName = hostname.split('.')[0]
    if (!appName) {
      return new Response('Not found', { status: 404 })
    }

    // Resolve JNS name to content hash
    const contentHash = await this.resolve(`${appName}.jeju`)
    if (!contentHash) {
      return new Response(`No content found for ${appName}`, { status: 404 })
    }

    // Fetch from IPFS
    const ipfsUrl = `${this.config.ipfsGateway}/ipfs/${contentHash}${url.pathname}`
    const response = await fetch(ipfsUrl)
    return response
  }
}
