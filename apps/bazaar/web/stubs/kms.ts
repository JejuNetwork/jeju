/**
 * @jejunetwork/kms browser stub
 * 
 * KMS functionality is not available in browser.
 * All signing/key operations happen server-side or via wallet.
 */

// FROST (threshold MPC signing) - not needed in browser
export const FROSTCoordinator = class {
  constructor() {
    throw new Error('FROSTCoordinator is not available in browser')
  }
}

export function generateKeyShares(): never {
  throw new Error('generateKeyShares is not available in browser')
}

export function createMPCClient(): never {
  throw new Error('createMPCClient is not available in browser')
}

export function createPrivateKey(): never {
  throw new Error('createPrivateKey is not available in browser')
}

export function createPublicKey(): never {
  throw new Error('createPublicKey is not available in browser')
}

export function createKeyPair(): never {
  throw new Error('createKeyPair is not available in browser')
}

export function sign(): never {
  throw new Error('sign is not available in browser')
}

export function verify(): never {
  throw new Error('verify is not available in browser')
}

// Types as empty objects
export type FROSTKeyShare = Record<string, never>
export type FROSTSignature = Record<string, never>
export type MPCClient = Record<string, never>
