/**
 * W3C Verifiable Credentials Implementation
 *
 * Full implementation of W3C VC Data Model 1.1 for OAuth3 identity attestations.
 * Uses EcdsaSecp256k1Signature2019 for Ethereum-compatible proofs.
 *
 * @see https://www.w3.org/TR/vc-data-model/
 */

import {
  type Address,
  createPublicClient,
  type Hex,
  http,
  keccak256,
  recoverMessageAddress,
  toBytes,
} from 'viem'
import { type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts'
import { toBase64Url } from '../polyfills.js'
import type {
  AuthProvider,
  CredentialProof,
  VerifiableCredential,
} from '../types.js'

// Credential Registry ABI for revocation checks
const CREDENTIAL_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'isRevoked',
    inputs: [{ name: 'credentialHash', type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getRevocationStatus',
    inputs: [{ name: 'credentialHash', type: 'bytes32' }],
    outputs: [
      { name: 'revoked', type: 'bool' },
      { name: 'revokedAt', type: 'uint256' },
      { name: 'revoker', type: 'address' },
      { name: 'reason', type: 'string' },
    ],
    stateMutability: 'view',
  },
] as const

const VC_CONTEXT = 'https://www.w3.org/2018/credentials/v1'
const OAUTH3_CONTEXT = 'https://jejunetwork.org/credentials/oauth3/v1'

export interface CredentialSchema {
  id: string
  type: string
}

export interface CredentialStatus {
  id: string
  type: string
  statusListIndex: number
  statusListCredential: string
}

export interface CredentialIssuanceParams {
  issuerDid: string
  issuerName: string
  subjectDid: string
  provider: AuthProvider
  providerId: string
  providerHandle: string
  walletAddress: Address
  expirationDays?: number
  additionalTypes?: string[]
  additionalContext?: string[]
  credentialSchema?: CredentialSchema
  credentialStatus?: CredentialStatus
}

export interface CredentialVerificationResult {
  valid: boolean
  checks: {
    signature: boolean
    expiration: boolean
    issuer: boolean
    schema: boolean
    revocation: boolean
  }
  errors: string[]
  credential: VerifiableCredential
}

export interface CredentialPresentation {
  '@context': string[]
  type: string[]
  holder: string
  verifiableCredential: VerifiableCredential[]
  proof: CredentialProof
}

export class VerifiableCredentialIssuer {
  private issuerAccount: PrivateKeyAccount
  private issuerDid: string
  private issuerName: string
  private chainId: number

  constructor(privateKey: Hex, issuerName: string, chainId: number) {
    this.issuerAccount = privateKeyToAccount(privateKey)
    this.chainId = chainId
    this.issuerDid = `did:ethr:${chainId}:${this.issuerAccount.address}`
    this.issuerName = issuerName
  }

  async issueCredential(
    params: CredentialIssuanceParams,
  ): Promise<VerifiableCredential> {
    const now = new Date()
    const expirationDate = new Date(
      now.getTime() + (params.expirationDays ?? 365) * 24 * 60 * 60 * 1000,
    )

    const credentialId = `urn:uuid:${crypto.randomUUID()}`

    const contexts = [VC_CONTEXT, OAUTH3_CONTEXT]
    if (params.additionalContext) {
      contexts.push(...params.additionalContext)
    }

    const types = ['VerifiableCredential', 'OAuth3IdentityCredential']
    if (params.additionalTypes) {
      types.push(...params.additionalTypes)
    }

    const credential: VerifiableCredential = {
      '@context': contexts,
      type: types,
      id: credentialId,
      issuer: {
        id: params.issuerDid ?? this.issuerDid,
        name: params.issuerName ?? this.issuerName,
      },
      issuanceDate: now.toISOString(),
      expirationDate: expirationDate.toISOString(),
      credentialSubject: {
        id: params.subjectDid,
        provider: params.provider,
        providerId: params.providerId,
        providerHandle: params.providerHandle,
        walletAddress: params.walletAddress,
        verifiedAt: now.toISOString(),
      },
      proof: {
        type: 'EcdsaSecp256k1Signature2019',
        created: now.toISOString(),
        verificationMethod: `${this.issuerDid}#controller`,
        proofPurpose: 'assertionMethod',
        proofValue: '0x' as Hex,
      },
    }

    const proofValue = await this.signCredential(credential)
    credential.proof.proofValue = proofValue

    return credential
  }

  async issueProviderCredential(
    provider: AuthProvider,
    providerId: string,
    providerHandle: string,
    walletAddress: Address,
    _additionalClaims?: Record<string, unknown>,
  ): Promise<VerifiableCredential> {
    const credentialType = this.getCredentialTypeForProvider(provider)

    return this.issueCredential({
      issuerDid: this.issuerDid,
      issuerName: this.issuerName,
      subjectDid: `did:ethr:${this.chainId}:${walletAddress}`,
      provider,
      providerId,
      providerHandle,
      walletAddress,
      additionalTypes: [credentialType],
    })
  }

  async createPresentation(
    credentials: VerifiableCredential[],
    holderDid: string,
    challenge?: string,
    domain?: string,
  ): Promise<CredentialPresentation> {
    const now = new Date()

    const presentation: CredentialPresentation = {
      '@context': [VC_CONTEXT],
      type: ['VerifiablePresentation'],
      holder: holderDid,
      verifiableCredential: credentials,
      proof: {
        type: 'EcdsaSecp256k1Signature2019',
        created: now.toISOString(),
        verificationMethod: `${this.issuerDid}#controller`,
        proofPurpose: 'authentication',
        proofValue: '0x' as Hex,
      },
    }

    const dataToSign = {
      ...presentation,
      proof: { ...presentation.proof, proofValue: undefined },
      challenge,
      domain,
    }

    const hash = keccak256(toBytes(JSON.stringify(dataToSign)))
    const signature = await this.issuerAccount.signMessage({
      message: { raw: toBytes(hash) },
    })
    presentation.proof.proofValue = signature

    if (challenge) {
      presentation.proof.jws = this.createJWS(hash, challenge, domain)
    }

    return presentation
  }

  private async signCredential(credential: VerifiableCredential): Promise<Hex> {
    const credentialWithoutProof = {
      ...credential,
      proof: { ...credential.proof, proofValue: undefined },
    }

    const canonicalized = JSON.stringify(credentialWithoutProof)
    const hash = keccak256(toBytes(canonicalized))

    const signature = await this.issuerAccount.signMessage({
      message: { raw: toBytes(hash) },
    })

    return signature
  }

  private getCredentialTypeForProvider(provider: AuthProvider): string {
    const typeMap: Record<AuthProvider, string> = {
      wallet: 'WalletOwnershipCredential',
      farcaster: 'FarcasterAccountCredential',
      google: 'GoogleAccountCredential',
      apple: 'AppleAccountCredential',
      twitter: 'TwitterAccountCredential',
      github: 'GitHubAccountCredential',
      discord: 'DiscordAccountCredential',
      email: 'EmailAccountCredential',
      phone: 'PhoneAccountCredential',
    }

    return typeMap[provider] ?? 'OAuth3IdentityCredential'
  }

  private createJWS(hash: Hex, challenge: string, domain?: string): string {
    const header = { alg: 'ES256K', typ: 'JWT' }
    const payload = {
      iss: this.issuerDid,
      sub: hash,
      nonce: challenge,
      aud: domain,
      iat: Math.floor(Date.now() / 1000),
    }

    const headerB64 = toBase64Url(JSON.stringify(header))
    const payloadB64 = toBase64Url(JSON.stringify(payload))

    return `${headerB64}.${payloadB64}.`
  }

  getIssuerDid(): string {
    return this.issuerDid
  }

  getIssuerAddress(): Address {
    return this.issuerAccount.address
  }
}

export interface VerifierConfig {
  chainId: number
  rpcUrl?: string
  credentialRegistryAddress?: Address
  trustedIssuers?: string[]
}

export class VerifiableCredentialVerifier {
  private trustedIssuers: Set<string>
  private rpcUrl: string | null
  private credentialRegistryAddress: Address | null

  constructor(
    chainIdOrConfig: number | VerifierConfig,
    trustedIssuers?: string[],
  ) {
    if (typeof chainIdOrConfig === 'number') {
      this.rpcUrl = null
      this.credentialRegistryAddress = null
      this.trustedIssuers = new Set(trustedIssuers ?? [])
    } else {
      this.rpcUrl = chainIdOrConfig.rpcUrl ?? null
      this.credentialRegistryAddress =
        chainIdOrConfig.credentialRegistryAddress ?? null
      this.trustedIssuers = new Set(chainIdOrConfig.trustedIssuers ?? [])
    }
  }

  addTrustedIssuer(issuerDid: string): void {
    this.trustedIssuers.add(issuerDid)
  }

  removeTrustedIssuer(issuerDid: string): void {
    this.trustedIssuers.delete(issuerDid)
  }

  async verify(
    credential: VerifiableCredential,
  ): Promise<CredentialVerificationResult> {
    const errors: string[] = []
    const checks = {
      signature: false,
      expiration: false,
      issuer: false,
      schema: false,
      revocation: false,
    }

    checks.signature = await this.verifySignature(credential)
    if (!checks.signature) {
      errors.push('Invalid credential signature')
    }

    checks.expiration = this.verifyExpiration(credential)
    if (!checks.expiration) {
      errors.push('Credential has expired')
    }

    checks.issuer = this.verifyIssuer(credential)
    if (!checks.issuer) {
      errors.push('Issuer not trusted')
    }

    checks.schema = this.verifySchema(credential)
    if (!checks.schema) {
      errors.push('Invalid credential schema')
    }

    checks.revocation = await this.checkRevocation(credential)
    if (!checks.revocation) {
      errors.push('Credential has been revoked')
    }

    return {
      valid: Object.values(checks).every((c) => c),
      checks,
      errors,
      credential,
    }
  }

  async verifyPresentation(
    presentation: CredentialPresentation,
    _challenge?: string,
    _domain?: string,
  ): Promise<{
    valid: boolean
    errors: string[]
    credentialResults: CredentialVerificationResult[]
  }> {
    const errors: string[] = []
    const credentialResults: CredentialVerificationResult[] = []

    for (const credential of presentation.verifiableCredential) {
      const result = await this.verify(credential)
      credentialResults.push(result)

      if (!result.valid) {
        errors.push(
          `Credential ${credential.id} is invalid: ${result.errors.join(', ')}`,
        )
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      credentialResults,
    }
  }

  private async verifySignature(
    credential: VerifiableCredential,
  ): Promise<boolean> {
    // SECURITY: Actually verify the signature against the credential hash
    const issuerAddress = this.extractAddressFromDid(credential.issuer.id)
    if (!issuerAddress) {
      return false
    }

    // Verify the proof value exists and is a valid signature
    if (!credential.proof.proofValue || credential.proof.proofValue === '0x') {
      return false
    }

    // Recreate the credential hash the same way it was signed
    const credentialWithoutProof = {
      ...credential,
      proof: { ...credential.proof, proofValue: undefined },
    }

    const canonicalized = JSON.stringify(credentialWithoutProof)
    const hash = keccak256(toBytes(canonicalized))

    // Recover the signer address from the signature
    try {
      const recoveredAddress = await recoverMessageAddress({
        message: { raw: toBytes(hash) },
        signature: credential.proof.proofValue,
      })

      // Compare addresses (case-insensitive)
      return recoveredAddress.toLowerCase() === issuerAddress.toLowerCase()
    } catch {
      // Signature recovery failed - invalid signature
      return false
    }
  }

  private verifyExpiration(credential: VerifiableCredential): boolean {
    const expirationDate = new Date(credential.expirationDate)
    return expirationDate > new Date()
  }

  private verifyIssuer(credential: VerifiableCredential): boolean {
    if (this.trustedIssuers.size === 0) {
      return true
    }
    return this.trustedIssuers.has(credential.issuer.id)
  }

  private verifySchema(credential: VerifiableCredential): boolean {
    if (
      !credential['@context'] ||
      !credential['@context'].includes(VC_CONTEXT)
    ) {
      return false
    }

    if (!credential.type || !credential.type.includes('VerifiableCredential')) {
      return false
    }

    if (!credential.credentialSubject) {
      return false
    }

    return true
  }

  private async checkRevocation(
    credential: VerifiableCredential,
  ): Promise<boolean> {
    // If no registry configured, skip revocation check (return valid)
    if (!this.credentialRegistryAddress || !this.rpcUrl) {
      return true
    }

    const credentialHash = createCredentialHash(credential)

    const client = createPublicClient({
      transport: http(this.rpcUrl),
    })

    const isRevoked = await client.readContract({
      address: this.credentialRegistryAddress,
      abi: CREDENTIAL_REGISTRY_ABI,
      functionName: 'isRevoked',
      args: [credentialHash],
    })

    // Return true if NOT revoked (credential is valid)
    return !isRevoked
  }

  /**
   * Get detailed revocation status for a credential
   */
  async getRevocationStatus(credential: VerifiableCredential): Promise<{
    revoked: boolean
    revokedAt: number
    revoker: Address | null
    reason: string
  }> {
    if (!this.credentialRegistryAddress || !this.rpcUrl) {
      return { revoked: false, revokedAt: 0, revoker: null, reason: '' }
    }

    const credentialHash = createCredentialHash(credential)

    const client = createPublicClient({
      transport: http(this.rpcUrl),
    })

    const [revoked, revokedAt, revoker, reason] = await client.readContract({
      address: this.credentialRegistryAddress,
      abi: CREDENTIAL_REGISTRY_ABI,
      functionName: 'getRevocationStatus',
      args: [credentialHash],
    })

    return {
      revoked,
      revokedAt: Number(revokedAt),
      revoker: revoked ? revoker : null,
      reason,
    }
  }

  private extractAddressFromDid(did: string): Address | null {
    const match = did.match(/did:ethr:\d+:(0x[a-fA-F0-9]{40})/)
    return match ? (match[1] as Address) : null
  }
}

export function createCredentialHash(credential: VerifiableCredential): Hex {
  const essential = {
    type: credential.type,
    issuer: credential.issuer.id,
    subject: credential.credentialSubject,
    issuanceDate: credential.issuanceDate,
  }
  return keccak256(toBytes(JSON.stringify(essential)))
}

export function credentialToOnChainAttestation(
  credential: VerifiableCredential,
): {
  provider: number
  providerId: Hex
  credentialHash: Hex
  issuedAt: number
  expiresAt: number
} {
  const providerMap: Record<AuthProvider, number> = {
    wallet: 0,
    farcaster: 1,
    google: 2,
    apple: 3,
    twitter: 4,
    github: 5,
    discord: 6,
    email: 7,
    phone: 8,
  }

  return {
    provider: providerMap[credential.credentialSubject.provider],
    providerId: keccak256(toBytes(credential.credentialSubject.providerId)),
    credentialHash: createCredentialHash(credential),
    issuedAt: Math.floor(new Date(credential.issuanceDate).getTime() / 1000),
    expiresAt: Math.floor(new Date(credential.expirationDate).getTime() / 1000),
  }
}

export function didFromAddress(address: Address, chainId: number): string {
  return `did:ethr:${chainId}:${address}`
}

export function addressFromDid(did: string): Address | null {
  const match = did.match(/did:ethr:\d+:(0x[a-fA-F0-9]{40})/)
  return match ? (match[1] as Address) : null
}
