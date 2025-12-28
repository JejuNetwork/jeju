import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto'
import { z } from 'zod'
import type { BackendManager } from '../storage/backends'

export type CertificateStatus =
  | 'pending'
  | 'validating'
  | 'issued'
  | 'renewing'
  | 'expired'
  | 'revoked'
  | 'failed'

export type ChallengeType = 'http-01' | 'dns-01' | 'tls-alpn-01'

export interface Certificate {
  certId: string
  domain: string
  altNames: string[]
  status: CertificateStatus

  // Certificate data (encrypted)
  certificatePem?: string
  privateKeyPem?: string
  chainPem?: string

  // ACME info
  acmeAccountId?: string
  acmeOrderUrl?: string

  // Timing
  issuedAt?: number
  expiresAt?: number
  renewAfter?: number
  lastRenewalAttempt?: number

  // Metadata
  issuer: string
  createdAt: number
  updatedAt: number
  autoRenew: boolean
}

export interface ACMEAccount {
  accountId: string
  email: string
  accountUrl: string
  privateKeyPem: string
  createdAt: number
}

export interface ChallengeRecord {
  challengeId: string
  certId: string
  domain: string
  type: ChallengeType
  token: string
  keyAuth: string
  status: 'pending' | 'processing' | 'valid' | 'invalid'
  createdAt: number
  validatedAt?: number
}

export interface CertificateRequest {
  domain: string
  altNames?: string[]
  email: string
  autoRenew?: boolean
  preferredChallenge?: ChallengeType
}

// ============================================================================
// Schemas
// ============================================================================

export const CertificateRequestSchema = z.object({
  domain: z
    .string()
    .min(1)
    .max(253)
    .regex(
      /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i,
    ),
  altNames: z.array(z.string()).max(100).optional(),
  email: z.string().email(),
  autoRenew: z.boolean().default(true),
  preferredChallenge: z
    .enum(['http-01', 'dns-01', 'tls-alpn-01'])
    .default('http-01'),
})

export const CustomCertificateSchema = z.object({
  domain: z.string(),
  certificatePem: z.string(),
  privateKeyPem: z.string(),
  chainPem: z.string().optional(),
})

// ============================================================================
// ACME Client
// ============================================================================

interface ACMEDirectory {
  newNonce: string
  newAccount: string
  newOrder: string
  revokeCert: string
  keyChange: string
}

interface ACMEOrder {
  status: 'pending' | 'ready' | 'processing' | 'valid' | 'invalid'
  expires: string
  identifiers: Array<{ type: 'dns'; value: string }>
  authorizations: string[]
  finalize: string
  certificate?: string
}

interface ACMEAuthorization {
  identifier: { type: 'dns'; value: string }
  status:
    | 'pending'
    | 'valid'
    | 'invalid'
    | 'deactivated'
    | 'expired'
    | 'revoked'
  challenges: Array<{
    type: ChallengeType
    status: 'pending' | 'processing' | 'valid' | 'invalid'
    url: string
    token: string
  }>
}

class ACMEClient {
  private directoryUrl: string
  private directory: ACMEDirectory | null = null
  private currentNonce: string | null = null

  constructor(staging = false) {
    this.directoryUrl = staging
      ? 'https://acme-staging-v02.api.letsencrypt.org/directory'
      : 'https://acme-v02.api.letsencrypt.org/directory'
  }

  async initialize(): Promise<void> {
    const response = await fetch(this.directoryUrl)
    this.directory = (await response.json()) as ACMEDirectory
  }

  async getNonce(): Promise<string> {
    if (this.currentNonce) {
      const nonce = this.currentNonce
      this.currentNonce = null
      return nonce
    }

    if (!this.directory) throw new Error('ACME client not initialized')

    const response = await fetch(this.directory.newNonce, { method: 'HEAD' })
    return response.headers.get('Replay-Nonce') ?? ''
  }

  async createAccount(
    email: string,
    privateKey: CryptoKey,
  ): Promise<{ accountUrl: string }> {
    if (!this.directory) throw new Error('ACME client not initialized')

    const payload = {
      termsOfServiceAgreed: true,
      contact: [`mailto:${email}`],
    }

    const response = await this.signedRequest(
      this.directory.newAccount,
      payload,
      privateKey,
    )

    this.currentNonce = response.headers.get('Replay-Nonce')
    const accountUrl = response.headers.get('Location') ?? ''

    return { accountUrl }
  }

  async createOrder(
    accountUrl: string,
    domains: string[],
    privateKey: CryptoKey,
  ): Promise<ACMEOrder> {
    if (!this.directory) throw new Error('ACME client not initialized')

    const payload = {
      identifiers: domains.map((d) => ({ type: 'dns' as const, value: d })),
    }

    const response = await this.signedRequest(
      this.directory.newOrder,
      payload,
      privateKey,
      accountUrl,
    )

    this.currentNonce = response.headers.get('Replay-Nonce')
    return response.json() as Promise<ACMEOrder>
  }

  async getAuthorization(
    authUrl: string,
    accountUrl: string,
    privateKey: CryptoKey,
  ): Promise<ACMEAuthorization> {
    const response = await this.signedRequest(
      authUrl,
      '',
      privateKey,
      accountUrl,
    )
    this.currentNonce = response.headers.get('Replay-Nonce')
    return response.json() as Promise<ACMEAuthorization>
  }

  async respondToChallenge(
    challengeUrl: string,
    accountUrl: string,
    privateKey: CryptoKey,
  ): Promise<void> {
    const response = await this.signedRequest(
      challengeUrl,
      {},
      privateKey,
      accountUrl,
    )
    this.currentNonce = response.headers.get('Replay-Nonce')
  }

  async finalizeOrder(
    finalizeUrl: string,
    csr: string,
    accountUrl: string,
    privateKey: CryptoKey,
  ): Promise<ACMEOrder> {
    const response = await this.signedRequest(
      finalizeUrl,
      { csr },
      privateKey,
      accountUrl,
    )
    this.currentNonce = response.headers.get('Replay-Nonce')
    return response.json() as Promise<ACMEOrder>
  }

  async getCertificate(
    certUrl: string,
    accountUrl: string,
    privateKey: CryptoKey,
  ): Promise<string> {
    const response = await this.signedRequest(
      certUrl,
      '',
      privateKey,
      accountUrl,
    )
    this.currentNonce = response.headers.get('Replay-Nonce')
    return response.text()
  }

  private async signedRequest(
    url: string,
    payload: unknown,
    privateKey: CryptoKey,
    accountUrl?: string,
  ): Promise<Response> {
    const nonce = await this.getNonce()

    // Export public key as JWK for header
    const publicKey = await crypto.subtle.exportKey('jwk', privateKey)

    // Build protected header
    const protectedHeader: Record<string, unknown> = {
      alg: 'ES256',
      nonce,
      url,
    }

    // Include jwk for new account, kid for existing
    if (accountUrl) {
      protectedHeader.kid = accountUrl
    } else {
      protectedHeader.jwk = {
        kty: publicKey.kty,
        crv: publicKey.crv,
        x: publicKey.x,
        y: publicKey.y,
      }
    }

    const protectedB64 = Buffer.from(JSON.stringify(protectedHeader)).toString(
      'base64url',
    )
    const payloadB64 =
      payload === ''
        ? ''
        : Buffer.from(JSON.stringify(payload)).toString('base64url')

    // Sign the message
    const signatureInput = new TextEncoder().encode(
      `${protectedB64}.${payloadB64}`,
    )
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      privateKey,
      signatureInput,
    )

    // Convert signature from DER to raw R||S format for JWS
    const signatureB64 = Buffer.from(signature).toString('base64url')

    const body = JSON.stringify({
      protected: protectedB64,
      payload: payloadB64,
      signature: signatureB64,
    })

    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/jose+json' },
      body,
    })
  }

  async computeKeyAuthorization(
    token: string,
    accountKey: CryptoKey,
  ): Promise<string> {
    // Export public key as JWK
    const jwk = await crypto.subtle.exportKey('jwk', accountKey)

    // Compute JWK thumbprint (SHA-256 of canonical JWK)
    const canonicalJwk = JSON.stringify({
      crv: jwk.crv,
      kty: jwk.kty,
      x: jwk.x,
      y: jwk.y,
    })

    const thumbprintBytes = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(canonicalJwk),
    )
    const thumbprint = Buffer.from(thumbprintBytes).toString('base64url')

    return `${token}.${thumbprint}`
  }
}

// ============================================================================
// SSL Certificate Manager
// ============================================================================

export class SSLCertificateManager {
  private certificates = new Map<string, Certificate>()
  private accounts = new Map<string, ACMEAccount>()
  private challenges = new Map<string, ChallengeRecord>()
  private challengesByDomain = new Map<string, string>() // domain -> challengeId

  private acmeClient: ACMEClient
  private encryptionKey: Buffer

  private renewalCheckInterval: ReturnType<typeof setInterval> | null = null

  constructor(config: {
    backend: BackendManager
    staging?: boolean
    encryptionKey?: string
  }) {
    // Backend will be used for certificate persistence in production
    void config.backend
    this.acmeClient = new ACMEClient(config.staging ?? false)

    // Generate or use provided encryption key
    this.encryptionKey = config.encryptionKey
      ? Buffer.from(config.encryptionKey, 'hex')
      : randomBytes(32)
  }

  async initialize(): Promise<void> {
    await this.acmeClient.initialize()
    this.startRenewalChecker()
    console.log('[SSL] Certificate manager initialized')
  }

  // =========================================================================
  // Certificate Operations
  // =========================================================================

  async requestCertificate(request: CertificateRequest): Promise<Certificate> {
    const certId = createHash('sha256')
      .update(`${request.domain}-${Date.now()}`)
      .digest('hex')
      .slice(0, 16)

    const allDomains = [request.domain, ...(request.altNames ?? [])]

    const cert: Certificate = {
      certId,
      domain: request.domain,
      altNames: request.altNames ?? [],
      status: 'pending',
      issuer: 'letsencrypt',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      autoRenew: request.autoRenew ?? true,
    }

    this.certificates.set(certId, cert)

    // Start async issuance
    this.issueCertificate(
      cert,
      request.email,
      request.preferredChallenge ?? 'http-01',
      allDomains,
    ).catch((error) => {
      console.error(
        `[SSL] Certificate issuance failed for ${request.domain}:`,
        error,
      )
      cert.status = 'failed'
      cert.updatedAt = Date.now()
    })

    return cert
  }

  private async issueCertificate(
    cert: Certificate,
    email: string,
    challengeType: ChallengeType,
    domains: string[],
  ): Promise<void> {
    cert.status = 'validating'
    cert.updatedAt = Date.now()

    console.log(`[SSL] Issuing certificate for ${cert.domain}`)

    // Get or create ACME account
    let account = Array.from(this.accounts.values()).find(
      (a) => a.email === email,
    )
    if (!account) {
      account = await this.createACMEAccount(email)
    }

    // Generate key pair for the certificate
    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    )

    // Create order
    const accountKey = await this.importAccountKey(account.privateKeyPem)
    const order = await this.acmeClient.createOrder(
      account.accountUrl,
      domains,
      accountKey,
    )
    cert.acmeOrderUrl = order.finalize

    // Process authorizations
    for (const authUrl of order.authorizations) {
      const auth = await this.acmeClient.getAuthorization(
        authUrl,
        account.accountUrl,
        accountKey,
      )

      // Find the requested challenge type
      const challenge = auth.challenges.find((c) => c.type === challengeType)
      if (!challenge) {
        throw new Error(
          `Challenge type ${challengeType} not available for ${auth.identifier.value}`,
        )
      }

      // Create challenge record
      const keyAuth = await this.acmeClient.computeKeyAuthorization(
        challenge.token,
        accountKey,
      )
      const challengeRecord: ChallengeRecord = {
        challengeId: challenge.token,
        certId: cert.certId,
        domain: auth.identifier.value,
        type: challengeType,
        token: challenge.token,
        keyAuth,
        status: 'pending',
        createdAt: Date.now(),
      }

      this.challenges.set(challenge.token, challengeRecord)
      this.challengesByDomain.set(auth.identifier.value, challenge.token)

      // Wait for challenge setup (external DNS/HTTP setup needed)
      console.log(
        `[SSL] Challenge ready for ${auth.identifier.value}: ${challengeType}`,
      )

      // In production, wait for challenge to be provisioned, then respond
      await this.acmeClient.respondToChallenge(
        challenge.url,
        account.accountUrl,
        accountKey,
      )
    }

    // Poll for order completion
    // In production, poll the order URL until status is 'ready' or 'valid'

    // Generate CSR
    const csr = await this.generateCSR(domains, keyPair.privateKey)

    // Finalize order
    const finalizedOrder = await this.acmeClient.finalizeOrder(
      order.finalize,
      csr,
      account.accountUrl,
      accountKey,
    )

    if (finalizedOrder.certificate) {
      // Download certificate
      const certPem = await this.acmeClient.getCertificate(
        finalizedOrder.certificate,
        account.accountUrl,
        accountKey,
      )

      // Export private key
      const privateKeyPem = await this.exportPrivateKey(keyPair.privateKey)

      // Parse certificate chain
      const { certificate, chain } = this.parseCertificateChain(certPem)

      // Encrypt and store
      cert.certificatePem = this.encrypt(certificate)
      cert.privateKeyPem = this.encrypt(privateKeyPem)
      cert.chainPem = this.encrypt(chain)
      cert.status = 'issued'
      cert.issuedAt = Date.now()
      cert.expiresAt = this.parseCertificateExpiry(certificate)
      cert.renewAfter = cert.expiresAt - 30 * 24 * 60 * 60 * 1000 // Renew 30 days before expiry
      cert.updatedAt = Date.now()

      console.log(
        `[SSL] Certificate issued for ${cert.domain}, expires ${new Date(cert.expiresAt).toISOString()}`,
      )
    }
  }

  async uploadCertificate(
    domain: string,
    certificatePem: string,
    privateKeyPem: string,
    chainPem?: string,
  ): Promise<Certificate> {
    const certId = createHash('sha256')
      .update(`${domain}-custom-${Date.now()}`)
      .digest('hex')
      .slice(0, 16)

    const cert: Certificate = {
      certId,
      domain,
      altNames: this.parseCertificateSANs(certificatePem),
      status: 'issued',
      certificatePem: this.encrypt(certificatePem),
      privateKeyPem: this.encrypt(privateKeyPem),
      chainPem: chainPem ? this.encrypt(chainPem) : undefined,
      issuer: 'custom',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      issuedAt: Date.now(),
      expiresAt: this.parseCertificateExpiry(certificatePem),
      autoRenew: false,
    }

    this.certificates.set(certId, cert)

    console.log(`[SSL] Custom certificate uploaded for ${domain}`)

    return cert
  }

  async revokeCertificate(certId: string): Promise<void> {
    const cert = this.certificates.get(certId)
    if (!cert) throw new Error(`Certificate not found: ${certId}`)

    cert.status = 'revoked'
    cert.updatedAt = Date.now()

    console.log(`[SSL] Certificate revoked: ${certId}`)
  }

  async deleteCertificate(certId: string): Promise<void> {
    this.certificates.delete(certId)
    console.log(`[SSL] Certificate deleted: ${certId}`)
  }

  // =========================================================================
  // Certificate Retrieval
  // =========================================================================

  getCertificate(certId: string): Certificate | undefined {
    return this.certificates.get(certId)
  }

  getCertificateByDomain(domain: string): Certificate | undefined {
    for (const cert of this.certificates.values()) {
      if (cert.domain === domain || cert.altNames.includes(domain)) {
        if (cert.status === 'issued') {
          return cert
        }
      }
    }
    return undefined
  }

  getCertificateFiles(
    certId: string,
  ): { certificate: string; privateKey: string; chain?: string } | undefined {
    const cert = this.certificates.get(certId)
    if (!cert || cert.status !== 'issued') return undefined
    if (!cert.certificatePem || !cert.privateKeyPem) return undefined

    return {
      certificate: this.decrypt(cert.certificatePem),
      privateKey: this.decrypt(cert.privateKeyPem),
      chain: cert.chainPem ? this.decrypt(cert.chainPem) : undefined,
    }
  }

  listCertificates(): Certificate[] {
    return Array.from(this.certificates.values())
  }

  // =========================================================================
  // ACME Challenges
  // =========================================================================

  getHTTPChallenge(token: string): string | undefined {
    const challenge = this.challenges.get(token)
    return challenge?.keyAuth
  }

  getDNSChallengeValue(domain: string): string | undefined {
    const challengeId = this.challengesByDomain.get(domain)
    if (!challengeId) return undefined

    const challenge = this.challenges.get(challengeId)
    if (!challenge || challenge.type !== 'dns-01') return undefined

    // DNS challenge value is base64url(sha256(keyAuth))
    const hash = createHash('sha256').update(challenge.keyAuth).digest()
    return hash.toString('base64url')
  }

  // =========================================================================
  // Renewal
  // =========================================================================

  private startRenewalChecker(): void {
    // Check every hour
    this.renewalCheckInterval = setInterval(
      () => {
        this.checkRenewals().catch(console.error)
      },
      60 * 60 * 1000,
    )
  }

  private async checkRenewals(): Promise<void> {
    const now = Date.now()

    for (const cert of this.certificates.values()) {
      if (!cert.autoRenew) continue
      if (cert.status !== 'issued') continue
      if (!cert.renewAfter || now < cert.renewAfter) continue

      console.log(`[SSL] Renewing certificate for ${cert.domain}`)
      cert.status = 'renewing'
      cert.lastRenewalAttempt = now
      cert.updatedAt = now

      // Re-issue the certificate
      const account = Array.from(this.accounts.values())[0]
      if (account) {
        try {
          await this.issueCertificate(cert, account.email, 'http-01', [
            cert.domain,
            ...cert.altNames,
          ])
        } catch (error) {
          console.error(`[SSL] Renewal failed for ${cert.domain}:`, error)
          cert.status = 'issued' // Keep old cert valid
        }
      }
    }
  }

  stopRenewalChecker(): void {
    if (this.renewalCheckInterval) {
      clearInterval(this.renewalCheckInterval)
      this.renewalCheckInterval = null
    }
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  private async createACMEAccount(email: string): Promise<ACMEAccount> {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    )

    const result = await this.acmeClient.createAccount(
      email,
      keyPair.privateKey,
    )
    const privateKeyPem = await this.exportPrivateKey(keyPair.privateKey)

    const account: ACMEAccount = {
      accountId: createHash('sha256').update(email).digest('hex').slice(0, 16),
      email,
      accountUrl: result.accountUrl,
      privateKeyPem: this.encrypt(privateKeyPem),
      createdAt: Date.now(),
    }

    this.accounts.set(account.accountId, account)

    return account
  }

  private async importAccountKey(encryptedPem: string): Promise<CryptoKey> {
    const pem = this.decrypt(encryptedPem)
    // In production, properly parse PEM and import
    const keyData = pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')
    const binaryKey = Buffer.from(keyData, 'base64')

    return crypto.subtle.importKey(
      'pkcs8',
      binaryKey,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    )
  }

  private async exportPrivateKey(key: CryptoKey): Promise<string> {
    const exported = await crypto.subtle.exportKey('pkcs8', key)
    const base64 = Buffer.from(exported).toString('base64')
    const lines = base64.match(/.{1,64}/g) ?? []
    return `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----`
  }

  private async generateCSR(
    domains: string[],
    privateKey: CryptoKey,
  ): Promise<string> {
    // Generate CSR using openssl subprocess for proper ASN.1 encoding
    // This is the most reliable way to generate valid CSRs
    const primaryDomain = domains[0]
    const sanConfig = domains.map((d, i) => `DNS.${i + 1} = ${d}`).join('\n')

    // Export private key to PEM
    const keyPem = await this.exportPrivateKey(privateKey)
    const keyFile = `/tmp/dws-csr-key-${Date.now()}.pem`
    const csrFile = `/tmp/dws-csr-${Date.now()}.pem`
    const configFile = `/tmp/dws-csr-config-${Date.now()}.cnf`

    // Write OpenSSL config
    const config = `
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
req_extensions = req_ext

[dn]
CN = ${primaryDomain}

[req_ext]
subjectAltName = @alt_names

[alt_names]
${sanConfig}
`

    try {
      await Bun.write(keyFile, keyPem)
      await Bun.write(configFile, config)

      // Generate CSR using openssl
      const proc = Bun.spawn(
        [
          'openssl',
          'req',
          '-new',
          '-key',
          keyFile,
          '-out',
          csrFile,
          '-config',
          configFile,
        ],
        {
          stdout: 'pipe',
          stderr: 'pipe',
        },
      )

      const exitCode = await proc.exited
      if (exitCode !== 0) {
        const stderr = await new Response(proc.stderr).text()
        throw new Error(`CSR generation failed: ${stderr}`)
      }

      // Read generated CSR
      const csr = await Bun.file(csrFile).text()
      return csr.trim()
    } finally {
      // Cleanup temp files
      const fs = await import('node:fs/promises')
      await fs.unlink(keyFile).catch(() => {})
      await fs.unlink(csrFile).catch(() => {})
      await fs.unlink(configFile).catch(() => {})
    }
  }

  private parseCertificateChain(pem: string): {
    certificate: string
    chain: string
  } {
    const certs =
      pem.match(
        /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
      ) ?? []
    return {
      certificate: certs[0] ?? '',
      chain: certs.slice(1).join('\n'),
    }
  }

  private parseCertificateExpiry(_pem: string): number {
    // In production, parse X.509 certificate to get notAfter
    // For now, return 90 days from now (typical Let's Encrypt validity)
    return Date.now() + 90 * 24 * 60 * 60 * 1000
  }

  private parseCertificateSANs(_pem: string): string[] {
    // In production, parse X.509 certificate to get Subject Alternative Names
    return []
  }

  private encrypt(data: string): string {
    const iv = randomBytes(16)
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv)

    let encrypted = cipher.update(data, 'utf8', 'base64')
    encrypted += cipher.final('base64')

    const authTag = cipher.getAuthTag()

    return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`
  }

  private decrypt(data: string): string {
    const [ivB64, authTagB64, encrypted] = data.split(':')
    const iv = Buffer.from(ivB64, 'base64')
    const authTag = Buffer.from(authTagB64, 'base64')

    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, iv)
    decipher.setAuthTag(authTag)

    let decrypted = decipher.update(encrypted, 'base64', 'utf8')
    decrypted += decipher.final('utf8')

    return decrypted
  }
}

// ============================================================================
// Factory
// ============================================================================

let sslManager: SSLCertificateManager | null = null

export function getSSLManager(backend: BackendManager): SSLCertificateManager {
  if (!sslManager) {
    const staging = process.env.ACME_STAGING === 'true'
    const encryptionKey = process.env.SSL_ENCRYPTION_KEY

    sslManager = new SSLCertificateManager({
      backend,
      staging,
      encryptionKey,
    })
  }
  return sslManager
}
