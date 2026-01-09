// Browser stub for @jejunetwork/kms
// KMS operations are server-side only

export class KMSSigner {
  async initialize(): Promise<void> {
    throw new Error('KMS is not available in browser')
  }
  async signMessage(_message: string): Promise<{ signature: `0x${string}` }> {
    throw new Error('KMS is not available in browser')
  }
}

export function createKMSSigner(_config: {
  serviceId: string
  allowLocalDev?: boolean
}): KMSSigner {
  return new KMSSigner()
}

export type { KMSSigner as KMSSignerType }
