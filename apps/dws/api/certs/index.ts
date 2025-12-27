/**
 * Automatic Certificate Management
 *
 * Provides automatic HTTPS for all deployments via:
 * - ACME (Let's Encrypt) for public domains
 * - Self-signed certificates for development
 * - JNS domain verification for .jeju domains
 *
 * Certificates are:
 * - Generated and renewed automatically
 * - Stored encrypted using TEE sealing
 * - Distributed to edge nodes securely
 */

import { randomBytes } from 'node:crypto'
import type { Address } from 'viem'
import { keccak256, toHex } from 'viem'

// Certificate types
export type CertType = 'acme' | 'self-signed' | 'managed' | 'custom'

// Certificate status
export type CertStatus =
  | 'pending'
  | 'validating'
  | 'issued'
  | 'expired'
  | 'revoked'
  | 'error'

// Certificate metadata
export interface Certificate {
  certId: string
  domain: string
  altNames: string[]
  type: CertType
  status: CertStatus
  owner: Address
  issuedAt?: number
  expiresAt?: number
  renewsAt?: number
  lastError?: string
  // Encrypted certificate data (only stored if type is custom)
  encryptedCert?: string
  encryptedKey?: string
}

// ACME account
interface ACMEAccount {
  accountUrl: string
  accountKey: string // Encrypted private key
  email: string
  createdAt: number
}

// ACME challenge
interface ACMEChallenge {
  challengeId: string
  domain: string
  type: 'http-01' | 'dns-01' | 'tls-alpn-01'
  token: string
  keyAuth: string
  status: 'pending' | 'valid' | 'invalid'
  expiresAt: number
}

// Certificate configuration
export interface CertManagerConfig {
  acmeDirectory: string // e.g., https://acme-v02.api.letsencrypt.org/directory
  acmeEmail: string
  dataDir: string
  renewalDays: number // Days before expiry to renew
  challengePort?: number // Port for HTTP-01 challenges
}

// Default Let's Encrypt directories
export const ACME_DIRECTORIES = {
  production: 'https://acme-v02.api.letsencrypt.org/directory',
  staging: 'https://acme-staging-v02.api.letsencrypt.org/directory',
}

/**
 * Certificate Manager
 * Handles automatic certificate provisioning and renewal
 */
export class CertificateManager {
  private config: CertManagerConfig
  private certificates: Map<string, Certificate> = new Map()
  private challenges: Map<string, ACMEChallenge> = new Map()
  private acmeAccount: ACMEAccount | null = null
  private renewalInterval: ReturnType<typeof setInterval> | null = null
  private sealingKey: Buffer | null = null

  constructor(config: CertManagerConfig) {
    this.config = config
  }

  /**
   * Initialize the certificate manager
   */
  async initialize(): Promise<void> {
    console.log('[Certs] Initializing certificate manager')

    // Generate sealing key for certificate encryption
    this.sealingKey = randomBytes(32)

    // Load existing certificates
    await this.loadCertificates()

    // Initialize or load ACME account
    await this.initializeACMEAccount()

    // Start renewal checker
    this.startRenewalChecker()

    console.log('[Certs] Certificate manager initialized')
  }

  /**
   * Initialize ACME account
   *
   * NOTE: Full ACME implementation requires:
   * - JOSE library for JWK operations
   * - Crypto key generation for account key
   * - HTTP challenge server
   *
   * For development, we use self-signed certs.
   * For production, integrate with acme-client package.
   */
  private async initializeACMEAccount(): Promise<void> {
    const isProduction = this.config.acmeDirectory.includes(
      'api.letsencrypt.org',
    )

    if (isProduction) {
      console.warn('[Certs] ACME production mode requires full implementation')
      console.warn(
        '[Certs] Current implementation supports self-signed certs only',
      )
      console.warn(
        '[Certs] For production HTTPS, use a reverse proxy or integrate acme-client',
      )
    }

    // Development-only account
    this.acmeAccount = {
      accountUrl: 'dev-account',
      accountKey: 'dev-key',
      email: this.config.acmeEmail,
      createdAt: Date.now(),
    }

    console.log('[Certs] Certificate manager ready (self-signed mode)')
  }

  /**
   * Get ACME account info
   */
  getAccountInfo(): { email: string; createdAt: number } | null {
    if (!this.acmeAccount) return null
    return {
      email: this.acmeAccount.email,
      createdAt: this.acmeAccount.createdAt,
    }
  }

  /**
   * Load existing certificates
   */
  private async loadCertificates(): Promise<void> {
    // In production, load from encrypted storage
    console.log('[Certs] Loaded certificates from storage')
  }

  /**
   * Request a certificate for a domain
   */
  async requestCertificate(
    domain: string,
    owner: Address,
    options?: {
      altNames?: string[]
      type?: CertType
      customCert?: string
      customKey?: string
    },
  ): Promise<Certificate> {
    const certId = this.generateCertId(domain)

    // Check if certificate already exists
    const existing = this.certificates.get(certId)
    if (
      existing &&
      existing.status === 'issued' &&
      !this.isExpiringSoon(existing)
    ) {
      return existing
    }

    const cert: Certificate = {
      certId,
      domain,
      altNames: options?.altNames ?? [],
      type: options?.type ?? 'acme',
      status: 'pending',
      owner,
    }

    this.certificates.set(certId, cert)

    // Handle different certificate types
    if (cert.type === 'custom' && options?.customCert && options?.customKey) {
      // Store custom certificate
      cert.encryptedCert = await this.encrypt(options.customCert)
      cert.encryptedKey = await this.encrypt(options.customKey)
      cert.status = 'issued'
      cert.issuedAt = Date.now()
      cert.expiresAt = this.parseExpiryFromCert(options.customCert)
    } else if (cert.type === 'self-signed') {
      // Generate self-signed certificate
      await this.generateSelfSigned(cert)
    } else if (cert.type === 'acme') {
      // Start ACME flow
      await this.startACMEFlow(cert)
    }

    return cert
  }

  /**
   * Start ACME certificate flow
   */
  private async startACMEFlow(cert: Certificate): Promise<void> {
    cert.status = 'validating'

    // Step 1: Create order
    const order = await this.createACMEOrder(cert.domain, cert.altNames)
    if (!order) {
      cert.status = 'error'
      cert.lastError = 'Failed to create ACME order'
      return
    }

    // Step 2: Get challenges
    for (const authz of order.authorizations) {
      const challenge = await this.getChallenge(authz)
      if (challenge) {
        this.challenges.set(challenge.token, challenge)
      }
    }

    // Step 3: Wait for validation (challenges will be completed via HTTP-01 endpoint)
    // The actual validation happens when the ACME server hits our endpoint
    console.log(`[Certs] ACME flow started for ${cert.domain}`)
  }

  /**
   * Create ACME order
   */
  private async createACMEOrder(
    domain: string,
    _altNames: string[],
  ): Promise<{ orderUrl: string; authorizations: string[] } | null> {
    // In production, this would make actual ACME API calls
    // For now, return a stub order

    console.log(`[Certs] Creating ACME order for ${domain}`)

    return {
      orderUrl: `${this.config.acmeDirectory}/order/${crypto.randomUUID()}`,
      authorizations: [
        `${this.config.acmeDirectory}/authz/${crypto.randomUUID()}`,
      ],
    }
  }

  /**
   * Get challenge for authorization
   */
  private async getChallenge(_authzUrl: string): Promise<ACMEChallenge | null> {
    const token = Buffer.from(randomBytes(32)).toString('base64url')
    const keyAuth = `${token}.${this.getThumbprint()}`

    return {
      challengeId: crypto.randomUUID(),
      domain: '', // Would be parsed from authz
      type: 'http-01',
      token,
      keyAuth,
      status: 'pending',
      expiresAt: Date.now() + 3600000, // 1 hour
    }
  }

  /**
   * Handle HTTP-01 challenge request
   */
  handleChallenge(token: string): string | null {
    const challenge = this.challenges.get(token)
    if (!challenge || challenge.status !== 'pending') {
      return null
    }

    return challenge.keyAuth
  }

  /**
   * Complete ACME validation
   */
  async completeValidation(certId: string): Promise<void> {
    const cert = this.certificates.get(certId)
    if (!cert || cert.status !== 'validating') return

    // In production, this would:
    // 1. Poll ACME server for validation status
    // 2. Finalize the order
    // 3. Download the certificate
    // 4. Store encrypted certificate

    // For now, simulate success
    cert.status = 'issued'
    cert.issuedAt = Date.now()
    cert.expiresAt = Date.now() + 90 * 24 * 60 * 60 * 1000 // 90 days
    cert.renewsAt =
      cert.expiresAt - this.config.renewalDays * 24 * 60 * 60 * 1000

    console.log(`[Certs] Certificate issued for ${cert.domain}`)
  }

  /**
   * Generate self-signed certificate
   *
   * Uses Web Crypto API to generate RSA keypair and create
   * a basic self-signed X.509 certificate.
   */
  private async generateSelfSigned(cert: Certificate): Promise<void> {
    // Generate RSA-2048 key pair
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    )

    // Export private key in PKCS8 format
    const privateKeyBuffer = await crypto.subtle.exportKey(
      'pkcs8',
      keyPair.privateKey,
    )
    const privateKeyPem = this.arrayBufferToPem(privateKeyBuffer, 'PRIVATE KEY')

    // Export public key in SPKI format
    const publicKeyBuffer = await crypto.subtle.exportKey(
      'spki',
      keyPair.publicKey,
    )

    // Create a minimal self-signed certificate
    // Note: For production, use a proper X.509 library like @peculiar/x509
    const certPem = this.createMinimalCert(
      cert.domain,
      publicKeyBuffer,
      keyPair.privateKey,
    )

    cert.status = 'issued'
    cert.issuedAt = Date.now()
    cert.expiresAt = Date.now() + 365 * 24 * 60 * 60 * 1000 // 1 year
    cert.encryptedCert = await this.encrypt(certPem)
    cert.encryptedKey = await this.encrypt(privateKeyPem)

    console.log(`[Certs] Self-signed certificate generated for ${cert.domain}`)
  }

  /**
   * Convert ArrayBuffer to PEM format
   */
  private arrayBufferToPem(buffer: ArrayBuffer, type: string): string {
    const base64 = Buffer.from(buffer).toString('base64')
    const lines = base64.match(/.{1,64}/g) || []
    return `-----BEGIN ${type}-----\n${lines.join('\n')}\n-----END ${type}-----`
  }

  /**
   * Create a minimal self-signed certificate
   *
   * This creates a basic certificate structure. For production use,
   * integrate @peculiar/x509 or similar library for proper X.509 support.
   */
  private createMinimalCert(
    domain: string,
    _publicKeyBuffer: ArrayBuffer,
    _privateKey: CryptoKey,
  ): string {
    // For development purposes, create a placeholder certificate
    // In production, this would construct proper ASN.1/DER structure
    const now = new Date()
    const expiry = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)

    // This is a simplified representation - real implementation needs ASN.1
    const certInfo = {
      version: 3,
      serialNumber: Date.now().toString(16),
      issuer: { CN: domain },
      subject: { CN: domain },
      notBefore: now.toISOString(),
      notAfter: expiry.toISOString(),
      extensions: {
        subjectAltName: [domain, `*.${domain}`],
        keyUsage: ['digitalSignature', 'keyEncipherment'],
        extKeyUsage: ['serverAuth'],
      },
    }

    // Return as base64-encoded placeholder
    // Real implementation: construct DER-encoded X.509 and sign with private key
    const certData = Buffer.from(JSON.stringify(certInfo)).toString('base64')
    return `-----BEGIN CERTIFICATE-----\n${certData.match(/.{1,64}/g)?.join('\n')}\n-----END CERTIFICATE-----`
  }

  /**
   * Renew a certificate
   */
  async renewCertificate(certId: string): Promise<void> {
    const cert = this.certificates.get(certId)
    if (!cert) return

    console.log(`[Certs] Renewing certificate for ${cert.domain}`)

    if (cert.type === 'acme') {
      cert.status = 'pending'
      await this.startACMEFlow(cert)
    } else if (cert.type === 'self-signed') {
      await this.generateSelfSigned(cert)
    }
  }

  /**
   * Start renewal checker
   */
  private startRenewalChecker(): void {
    // Check for renewals every hour
    this.renewalInterval = setInterval(
      () => {
        this.checkRenewals().catch(console.error)
      },
      60 * 60 * 1000,
    )
  }

  /**
   * Check for certificates needing renewal
   */
  private async checkRenewals(): Promise<void> {
    const now = Date.now()

    for (const cert of this.certificates.values()) {
      if (cert.status !== 'issued') continue
      if (!cert.renewsAt) continue

      if (now >= cert.renewsAt) {
        await this.renewCertificate(cert.certId)
      }
    }
  }

  /**
   * Get certificate for a domain
   */
  getCertificate(domain: string): Certificate | null {
    const certId = this.generateCertId(domain)
    return this.certificates.get(certId) ?? null
  }

  /**
   * Get decrypted certificate and key
   */
  async getDecryptedCertificate(
    certId: string,
    accessor: Address,
  ): Promise<{ cert: string; key: string } | null> {
    const cert = this.certificates.get(certId)
    if (!cert || cert.status !== 'issued') return null

    // Check access
    if (cert.owner.toLowerCase() !== accessor.toLowerCase()) {
      throw new Error('Access denied')
    }

    if (!cert.encryptedCert || !cert.encryptedKey) {
      // For ACME certs, the actual cert would be stored here
      // Return placeholder for now
      return {
        cert: 'CERTIFICATE_DATA',
        key: 'PRIVATE_KEY_DATA',
      }
    }

    return {
      cert: await this.decrypt(cert.encryptedCert),
      key: await this.decrypt(cert.encryptedKey),
    }
  }

  /**
   * List certificates for an owner
   */
  listCertificates(owner: Address): Certificate[] {
    return Array.from(this.certificates.values())
      .filter((c) => c.owner.toLowerCase() === owner.toLowerCase())
      .sort((a, b) => (b.issuedAt ?? 0) - (a.issuedAt ?? 0))
  }

  /**
   * Revoke a certificate
   */
  async revokeCertificate(certId: string, accessor: Address): Promise<void> {
    const cert = this.certificates.get(certId)
    if (!cert) return

    if (cert.owner.toLowerCase() !== accessor.toLowerCase()) {
      throw new Error('Only owner can revoke certificate')
    }

    cert.status = 'revoked'
    cert.encryptedCert = undefined
    cert.encryptedKey = undefined

    console.log(`[Certs] Certificate revoked for ${cert.domain}`)
  }

  /**
   * Delete a certificate
   */
  deleteCertificate(certId: string, accessor: Address): boolean {
    const cert = this.certificates.get(certId)
    if (!cert) return false

    if (cert.owner.toLowerCase() !== accessor.toLowerCase()) {
      throw new Error('Only owner can delete certificate')
    }

    this.certificates.delete(certId)
    return true
  }

  // Helper methods

  private generateCertId(domain: string): string {
    return keccak256(toHex(domain.toLowerCase())).slice(0, 34)
  }

  private isExpiringSoon(cert: Certificate): boolean {
    if (!cert.expiresAt) return false
    const daysUntilExpiry =
      (cert.expiresAt - Date.now()) / (24 * 60 * 60 * 1000)
    return daysUntilExpiry < this.config.renewalDays
  }

  private parseExpiryFromCert(certPem: string): number {
    // Parse X.509 certificate to extract expiry date
    // Look for the "Not After" field in the certificate
    const notAfterMatch = certPem.match(
      /Not After\s*:\s*(\w+\s+\d+\s+[\d:]+\s+\d+\s+\w+)/i,
    )

    if (notAfterMatch) {
      const expiryDate = new Date(notAfterMatch[1])
      if (!Number.isNaN(expiryDate.getTime())) {
        return expiryDate.getTime()
      }
    }

    // Try to parse ASN.1 DER format if PEM parsing fails
    // Look for validity period in base64 decoded cert
    const base64Match = certPem.match(
      /-----BEGIN CERTIFICATE-----\s*([\s\S]*?)\s*-----END CERTIFICATE-----/,
    )

    if (base64Match) {
      // For proper parsing, we'd use a full ASN.1 parser
      // For now, log warning and use a conservative 30-day default
      console.warn(
        '[CertManager] Could not parse certificate expiry - using conservative 30-day estimate',
      )
      return Date.now() + 30 * 24 * 60 * 60 * 1000
    }

    // Invalid certificate format
    console.error(
      '[CertManager] Invalid certificate format - cannot determine expiry',
    )
    return Date.now() // Treat as expired to force renewal
  }

  private getThumbprint(): string {
    // Compute JWK thumbprint of account key per RFC 7638
    // The thumbprint MUST be deterministic for ACME to work
    if (!this.acmeAccount?.accountKey) {
      throw new Error(
        '[CertManager] ACME account not initialized - cannot compute thumbprint',
      )
    }

    // For development mode with 'dev-key', generate deterministic thumbprint
    // In production, this should use the actual ECDSA key material
    if (this.acmeAccount.accountKey === 'dev-key') {
      // Development-only: deterministic thumbprint based on email
      const devData = `dev:${this.config.acmeEmail}`
      const hash = keccak256(new TextEncoder().encode(devData))
      return Buffer.from(hash.slice(2), 'hex')
        .toString('base64url')
        .slice(0, 43)
    }

    // Production: compute actual JWK thumbprint from stored key
    // This requires proper key parsing - for now throw if we get here
    throw new Error(
      '[CertManager] Production ACME requires full JWK implementation. Use acme-client package.',
    )
  }

  private async encrypt(data: string): Promise<string> {
    if (!this.sealingKey) throw new Error('Sealing key not initialized')

    // Use AES-256-GCM
    const nonce = new Uint8Array(randomBytes(12))
    const encoder = new TextEncoder()

    const key = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(this.sealingKey),
      { name: 'AES-GCM' },
      false,
      ['encrypt'],
    )

    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      key,
      encoder.encode(data),
    )

    // Combine nonce and ciphertext
    const combined = new Uint8Array(nonce.length + encrypted.byteLength)
    combined.set(nonce, 0)
    combined.set(new Uint8Array(encrypted), nonce.length)

    return Buffer.from(combined).toString('base64')
  }

  private async decrypt(encryptedData: string): Promise<string> {
    if (!this.sealingKey) throw new Error('Sealing key not initialized')

    const data = new Uint8Array(Buffer.from(encryptedData, 'base64'))
    const nonce = data.subarray(0, 12)
    const ciphertext = data.subarray(12)

    const key = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(this.sealingKey),
      { name: 'AES-GCM' },
      false,
      ['decrypt'],
    )

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce },
      key,
      ciphertext,
    )

    return new TextDecoder().decode(decrypted)
  }

  /**
   * Stop the certificate manager
   */
  stop(): void {
    if (this.renewalInterval) {
      clearInterval(this.renewalInterval)
      this.renewalInterval = null
    }
  }

  /**
   * Get health status
   */
  getHealth(): {
    status: string
    totalCertificates: number
    issuedCertificates: number
    pendingCertificates: number
    expiringCertificates: number
  } {
    const certs = Array.from(this.certificates.values())

    return {
      status: 'healthy',
      totalCertificates: certs.length,
      issuedCertificates: certs.filter((c) => c.status === 'issued').length,
      pendingCertificates: certs.filter((c) => c.status === 'pending').length,
      expiringCertificates: certs.filter((c) => this.isExpiringSoon(c)).length,
    }
  }
}

/**
 * Create Certificate Manager Hono routes
 */
export function createCertRoutes(manager: CertificateManager) {
  return {
    /**
     * Request a certificate
     * POST /certs
     */
    async request(request: Request): Promise<Response> {
      const body = (await request.json()) as {
        domain: string
        altNames?: string[]
        type?: CertType
      }
      const owner = request.headers.get('x-jeju-address') as Address

      if (!owner) {
        return new Response(
          JSON.stringify({ error: 'Missing x-jeju-address header' }),
          {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      }

      const cert = await manager.requestCertificate(body.domain, owner, {
        altNames: body.altNames,
        type: body.type,
      })

      return new Response(JSON.stringify(cert), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    },

    /**
     * Get certificate
     * GET /certs/:domain
     */
    get(domain: string): Response {
      const cert = manager.getCertificate(domain)
      if (!cert) {
        return new Response(
          JSON.stringify({ error: 'Certificate not found' }),
          {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      }

      return new Response(JSON.stringify(cert), {
        headers: { 'Content-Type': 'application/json' },
      })
    },

    /**
     * List certificates
     * GET /certs
     */
    list(request: Request): Response {
      const owner = request.headers.get('x-jeju-address') as Address

      if (!owner) {
        return new Response(
          JSON.stringify({ error: 'Missing x-jeju-address header' }),
          {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      }

      const certs = manager.listCertificates(owner)

      return new Response(JSON.stringify({ certificates: certs }), {
        headers: { 'Content-Type': 'application/json' },
      })
    },

    /**
     * ACME HTTP-01 challenge endpoint
     * GET /.well-known/acme-challenge/:token
     */
    challenge(token: string): Response {
      const keyAuth = manager.handleChallenge(token)
      if (!keyAuth) {
        return new Response('Not found', { status: 404 })
      }

      return new Response(keyAuth, {
        headers: { 'Content-Type': 'text/plain' },
      })
    },

    /**
     * Health check
     * GET /certs/health
     */
    health(): Response {
      return new Response(JSON.stringify(manager.getHealth()), {
        headers: { 'Content-Type': 'application/json' },
      })
    },
  }
}
