/**
 * TEE types for network
 */

export interface AttestationQuote {
  /** Hex-encoded TDX quote */
  quote: string
  /** Event log for verification */
  eventLog: string
  /** Whether this is from a simulator */
  isSimulated: boolean
  /** Report data that was included */
  reportData: string
}

export interface DerivedKey {
  /** Hex-encoded private key */
  privateKey: string
  /** Hex-encoded public key */
  publicKey: string
  /** Key derivation path */
  path: string
  /** Signature proving TEE origin */
  signature: string
}

export interface TLSCertificate {
  /** PEM-encoded certificate */
  certificate: string
  /** PEM-encoded private key */
  privateKey: string
  /** Certificate chain */
  chain: string[]
}

export interface TEEInfo {
  /** Whether connected to simulator or real TEE */
  isSimulator: boolean
  /** App ID */
  appId: string
  /** Instance ID */
  instanceId: string
  /** OS image hash */
  osImageHash: string
  /** Compose hash */
  composeHash: string
}

