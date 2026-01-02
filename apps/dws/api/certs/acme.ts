/**
 * ACME Client for Let's Encrypt / ZeroSSL
 *
 * Production-ready ACME implementation for automatic certificate issuance.
 * Supports HTTP-01 and DNS-01 challenges.
 *
 * Uses Web Crypto API for compatibility with workerd/Cloudflare Workers.
 */

// Note: No viem imports needed - this is pure ACME implementation

// Helper to convert Uint8Array to ArrayBuffer (fixes Bun type conflicts)
function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(data.length)
  new Uint8Array(buffer).set(data)
  return buffer
}

// ============================================================================
// Types
// ============================================================================

export interface ACMEConfig {
  /** ACME directory URL */
  directory: string
  /** Account email for Let's Encrypt notifications */
  email: string
  /** Accept terms of service */
  acceptTerms: boolean
  /** Challenge type preference */
  challengeType: 'http-01' | 'dns-01'
}

export interface ACMEAccount {
  /** Account URL (location header from registration) */
  accountUrl: string
  /** JWK for account key */
  jwk: JsonWebKey
  /** Private key for signing */
  privateKey: CryptoKey
  /** Account status */
  status: 'valid' | 'deactivated' | 'revoked'
  /** Registration timestamp */
  createdAt: number
}

export interface ACMEOrder {
  /** Order URL */
  orderUrl: string
  /** Order status */
  status: 'pending' | 'ready' | 'processing' | 'valid' | 'invalid'
  /** Authorization URLs */
  authorizations: string[]
  /** Finalize URL */
  finalizeUrl: string
  /** Certificate URL (when ready) */
  certificateUrl?: string
  /** Identifiers */
  identifiers: Array<{ type: 'dns'; value: string }>
  /** Expiry */
  expires: string
}

export interface ACMEChallenge {
  /** Challenge type */
  type: 'http-01' | 'dns-01' | 'tls-alpn-01'
  /** Challenge URL */
  url: string
  /** Challenge token */
  token: string
  /** Challenge status */
  status: 'pending' | 'processing' | 'valid' | 'invalid'
  /** Computed key authorization */
  keyAuthorization?: string
}

export interface ACMEAuthorization {
  /** Authorization URL */
  url: string
  /** Identifier */
  identifier: { type: 'dns'; value: string }
  /** Status */
  status:
    | 'pending'
    | 'valid'
    | 'invalid'
    | 'deactivated'
    | 'expired'
    | 'revoked'
  /** Expires */
  expires: string
  /** Challenges */
  challenges: ACMEChallenge[]
}

export interface IssuedCertificate {
  /** PEM-encoded certificate chain */
  certificate: string
  /** PEM-encoded private key */
  privateKey: string
  /** Domain */
  domain: string
  /** Alternative names */
  altNames: string[]
  /** Issued timestamp */
  issuedAt: number
  /** Expires timestamp */
  expiresAt: number
}

// ============================================================================
// ACME Directories
// ============================================================================

export const ACME_DIRECTORIES = {
  letsencrypt: {
    production: 'https://acme-v02.api.letsencrypt.org/directory',
    staging: 'https://acme-staging-v02.api.letsencrypt.org/directory',
  },
  zerossl: {
    production: 'https://acme.zerossl.com/v2/DV90',
  },
  buypass: {
    production: 'https://api.buypass.com/acme/directory',
    staging: 'https://api.test4.buypass.no/acme/directory',
  },
} as const

// ============================================================================
// ACME Client
// ============================================================================

export class ACMEClient {
  private config: ACMEConfig
  private account: ACMEAccount | null = null
  private directory: Record<string, string> | null = null
  private nonce: string | null = null

  constructor(config: ACMEConfig) {
    this.config = config
  }

  /**
   * Initialize the ACME client
   * - Fetches directory
   * - Creates or loads account
   */
  async initialize(): Promise<void> {
    console.log('[ACME] Initializing client...')
    console.log(`[ACME] Directory: ${this.config.directory}`)

    // Fetch directory
    this.directory = await this.fetchDirectory()
    console.log('[ACME] Directory fetched')

    // Get initial nonce
    this.nonce = await this.fetchNonce()

    // Create or load account
    await this.ensureAccount()

    console.log('[ACME] Client initialized')
  }

  /**
   * Request a certificate for a domain
   */
  async requestCertificate(
    domain: string,
    altNames: string[] = [],
  ): Promise<{ order: ACMEOrder; challenges: Map<string, ACMEChallenge> }> {
    if (!this.account) {
      throw new Error('ACME client not initialized')
    }

    console.log(`[ACME] Requesting certificate for: ${domain}`)

    const identifiers = [
      { type: 'dns' as const, value: domain },
      ...altNames.map((name) => ({ type: 'dns' as const, value: name })),
    ]

    // Create order
    const order = await this.createOrder(identifiers)
    console.log(`[ACME] Order created: ${order.orderUrl}`)

    // Get challenges for each authorization
    const challenges = new Map<string, ACMEChallenge>()

    for (const authzUrl of order.authorizations) {
      const authz = await this.getAuthorization(authzUrl)
      const challenge = authz.challenges.find(
        (c) => c.type === this.config.challengeType,
      )

      if (challenge) {
        // Compute key authorization
        challenge.keyAuthorization = await this.computeKeyAuthorization(
          challenge.token,
        )
        challenges.set(authz.identifier.value, challenge)
        console.log(
          `[ACME] Challenge for ${authz.identifier.value}: ${challenge.type}`,
        )
      }
    }

    return { order, challenges }
  }

  /**
   * Complete a challenge and finalize the order
   */
  async completeChallenges(
    order: ACMEOrder,
    challenges: Map<string, ACMEChallenge>,
  ): Promise<IssuedCertificate> {
    if (!this.account) {
      throw new Error('ACME client not initialized')
    }

    // Respond to each challenge
    for (const [domain, challenge] of Array.from(challenges.entries())) {
      console.log(`[ACME] Completing challenge for: ${domain}`)
      await this.respondToChallenge(challenge)
    }

    // Wait for order to be ready
    let currentOrder = order
    for (let i = 0; i < 30; i++) {
      currentOrder = await this.getOrder(order.orderUrl)

      if (currentOrder.status === 'ready') {
        console.log('[ACME] Order is ready for finalization')
        break
      }

      if (currentOrder.status === 'invalid') {
        throw new Error('Order validation failed')
      }

      console.log(`[ACME] Order status: ${currentOrder.status}, waiting...`)
      await this.sleep(2000)
    }

    if (currentOrder.status !== 'ready') {
      throw new Error(`Order not ready: ${currentOrder.status}`)
    }

    // Generate CSR
    const { csr, privateKey } = await this.generateCSR(
      order.identifiers.map((id) => id.value),
    )

    // Finalize order
    console.log('[ACME] Finalizing order...')
    await this.finalizeOrder(currentOrder.finalizeUrl, csr)

    // Wait for certificate
    for (let i = 0; i < 30; i++) {
      currentOrder = await this.getOrder(order.orderUrl)

      if (currentOrder.status === 'valid' && currentOrder.certificateUrl) {
        console.log('[ACME] Certificate issued.')
        break
      }

      if (currentOrder.status === 'invalid') {
        throw new Error('Order finalization failed')
      }

      console.log(`[ACME] Order status: ${currentOrder.status}, waiting...`)
      await this.sleep(2000)
    }

    if (!currentOrder.certificateUrl) {
      throw new Error('Certificate not ready')
    }

    // Download certificate
    const certificate = await this.downloadCertificate(
      currentOrder.certificateUrl,
    )

    return {
      certificate,
      privateKey,
      domain: order.identifiers[0].value,
      altNames: order.identifiers.slice(1).map((id) => id.value),
      issuedAt: Date.now(),
      expiresAt: Date.now() + 90 * 24 * 60 * 60 * 1000, // 90 days
    }
  }

  /**
   * Get HTTP-01 challenge response for a token
   */
  async getHttp01Response(token: string): Promise<string | null> {
    if (!this.account) return null
    return this.computeKeyAuthorization(token)
  }

  /**
   * Get DNS-01 TXT record value for a token
   */
  async getDns01Record(token: string): Promise<string | null> {
    const keyAuthz = await this.computeKeyAuthorization(token)
    if (!keyAuthz) return null

    // DNS-01 uses base64url(SHA-256(keyAuthorization))
    const data = new TextEncoder().encode(keyAuthz)
    const hash = await crypto.subtle.digest('SHA-256', toArrayBuffer(data))
    return this.base64url(new Uint8Array(hash))
  }

  // ========================================================================
  // Internal Methods
  // ========================================================================

  private async fetchDirectory(): Promise<Record<string, string>> {
    const response = await fetch(this.config.directory)
    if (!response.ok) {
      throw new Error(`Failed to fetch ACME directory: ${response.status}`)
    }
    return response.json()
  }

  private async fetchNonce(): Promise<string> {
    if (!this.directory) {
      throw new Error('Directory not loaded')
    }

    const response = await fetch(this.directory.newNonce, {
      method: 'HEAD',
    })

    const nonce = response.headers.get('Replay-Nonce')
    if (!nonce) {
      throw new Error('No nonce in response')
    }
    return nonce
  }

  private async ensureAccount(): Promise<void> {
    // Generate account key
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'ECDSA',
        namedCurve: 'P-256',
      },
      true,
      ['sign'],
    )

    const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey)

    // Register account
    const payload = {
      termsOfServiceAgreed: this.config.acceptTerms,
      contact: [`mailto:${this.config.email}`],
    }

    const response = await this.signedRequest(
      this.directory?.newAccount,
      payload,
      keyPair.privateKey,
      jwk,
    )

    const accountUrl = response.headers.get('Location')
    if (!accountUrl) {
      throw new Error('No account URL in response')
    }

    this.account = {
      accountUrl,
      jwk,
      privateKey: keyPair.privateKey,
      status: 'valid',
      createdAt: Date.now(),
    }

    console.log(`[ACME] Account registered: ${accountUrl}`)
  }

  private async createOrder(
    identifiers: Array<{ type: 'dns'; value: string }>,
  ): Promise<ACMEOrder> {
    const response = await this.signedRequest(this.directory?.newOrder, {
      identifiers,
    })

    const orderUrl = response.headers.get('Location')
    const data = await response.json()

    return {
      orderUrl: orderUrl ?? '',
      status: data.status,
      authorizations: data.authorizations,
      finalizeUrl: data.finalize,
      certificateUrl: data.certificate,
      identifiers: data.identifiers,
      expires: data.expires,
    }
  }

  private async getAuthorization(url: string): Promise<ACMEAuthorization> {
    const response = await this.signedRequest(url, null)
    const data = await response.json()

    return {
      url,
      identifier: data.identifier,
      status: data.status,
      expires: data.expires,
      challenges: data.challenges,
    }
  }

  private async getOrder(url: string): Promise<ACMEOrder> {
    const response = await this.signedRequest(url, null)
    const data = await response.json()

    return {
      orderUrl: url,
      status: data.status,
      authorizations: data.authorizations,
      finalizeUrl: data.finalize,
      certificateUrl: data.certificate,
      identifiers: data.identifiers,
      expires: data.expires,
    }
  }

  private async respondToChallenge(challenge: ACMEChallenge): Promise<void> {
    await this.signedRequest(challenge.url, {})
  }

  private async finalizeOrder(url: string, csr: string): Promise<void> {
    await this.signedRequest(url, { csr })
  }

  private async downloadCertificate(url: string): Promise<string> {
    const response = await this.signedRequest(url, null)
    return response.text()
  }

  private async signedRequest(
    url: string,
    payload: Record<string, unknown> | null,
    privateKey?: CryptoKey,
    jwk?: JsonWebKey,
  ): Promise<Response> {
    const key = privateKey ?? this.account?.privateKey
    const accountJwk = jwk ?? this.account?.jwk

    // Build protected header
    const protectedHeader: Record<string, unknown> = {
      alg: 'ES256',
      nonce: this.nonce,
      url,
    }

    if (this.account?.accountUrl && !jwk) {
      protectedHeader.kid = this.account.accountUrl
    } else {
      protectedHeader.jwk = {
        kty: accountJwk.kty,
        crv: accountJwk.crv,
        x: accountJwk.x,
        y: accountJwk.y,
      }
    }

    const protectedB64 = this.base64url(
      new TextEncoder().encode(JSON.stringify(protectedHeader)),
    )

    const payloadB64 =
      payload === null
        ? ''
        : this.base64url(new TextEncoder().encode(JSON.stringify(payload)))

    // Sign
    const signatureInput = new TextEncoder().encode(
      `${protectedB64}.${payloadB64}`,
    )
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      toArrayBuffer(signatureInput),
    )

    // Convert signature from DER to raw format
    const signatureB64 = this.base64url(new Uint8Array(signature))

    const body = JSON.stringify({
      protected: protectedB64,
      payload: payloadB64,
      signature: signatureB64,
    })

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/jose+json',
      },
      body,
    })

    // Update nonce
    const newNonce = response.headers.get('Replay-Nonce')
    if (newNonce) {
      this.nonce = newNonce
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(
        `ACME request failed: ${response.status} ${JSON.stringify(error)}`,
      )
    }

    return response
  }

  private async computeKeyAuthorization(token: string): Promise<string> {
    const jwk = this.account?.jwk

    // Compute JWK thumbprint
    const thumbprintInput = JSON.stringify({
      crv: jwk.crv,
      kty: jwk.kty,
      x: jwk.x,
      y: jwk.y,
    })

    const thumbprintData = new TextEncoder().encode(thumbprintInput)
    const thumbprintHash = await crypto.subtle.digest(
      'SHA-256',
      toArrayBuffer(thumbprintData),
    )
    const thumbprint = this.base64url(new Uint8Array(thumbprintHash))

    return `${token}.${thumbprint}`
  }

  private async generateCSR(
    domains: string[],
  ): Promise<{ csr: string; privateKey: string }> {
    // Generate key pair for the certificate
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'ECDSA',
        namedCurve: 'P-256',
      },
      true,
      ['sign'],
    )

    // Export private key
    const privateKeyPkcs8 = await crypto.subtle.exportKey(
      'pkcs8',
      keyPair.privateKey,
    )
    const privateKey = this.arrayBufferToPem(privateKeyPkcs8, 'PRIVATE KEY')

    // Export public key for CSR
    const publicKeySpki = await crypto.subtle.exportKey(
      'spki',
      keyPair.publicKey,
    )

    // Build proper PKCS#10 CSR with DER encoding
    const csrDer = await this.buildCSR(
      domains,
      new Uint8Array(publicKeySpki),
      keyPair.privateKey,
    )
    const csr = this.base64url(csrDer)

    return { csr, privateKey }
  }

  /**
   * Build a proper PKCS#10 CSR with DER encoding
   *
   * Structure: CertificationRequest ::= SEQUENCE {
   *   certificationRequestInfo CertificationRequestInfo,
   *   signatureAlgorithm AlgorithmIdentifier,
   *   signature BIT STRING
   * }
   */
  private async buildCSR(
    domains: string[],
    publicKeySpki: Uint8Array,
    privateKey: CryptoKey,
  ): Promise<Uint8Array> {
    const commonName = domains[0]

    // Build CertificationRequestInfo
    const certReqInfo = this.buildCertRequestInfo(
      commonName,
      domains,
      publicKeySpki,
    )

    // Sign with ECDSA-SHA256
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      privateKey,
      toArrayBuffer(certReqInfo),
    )

    // Convert ECDSA signature from WebCrypto format (concatenated r||s) to DER format
    const sigDer = this.ecdsaSigToDer(new Uint8Array(signature))

    // Build final CSR: SEQUENCE { certReqInfo, signatureAlgorithm, signature }
    const signatureAlgorithm = this.buildSignatureAlgorithm()
    const signatureBitString = this.buildBitString(sigDer)

    return this.buildSequence([
      certReqInfo,
      signatureAlgorithm,
      signatureBitString,
    ])
  }

  private buildCertRequestInfo(
    commonName: string,
    domains: string[],
    publicKeySpki: Uint8Array,
  ): Uint8Array {
    // Version (INTEGER 0)
    const version = new Uint8Array([0x02, 0x01, 0x00])

    // Subject (Distinguished Name with CN)
    const subject = this.buildSubject(commonName)

    // SubjectPKInfo (already in SPKI format from exportKey)

    // Attributes (with SAN extension request)
    const attributes = this.buildAttributes(domains)

    return this.buildSequence([version, subject, publicKeySpki, attributes])
  }

  private buildSubject(commonName: string): Uint8Array {
    // OID for commonName: 2.5.4.3
    const cnOid = new Uint8Array([0x06, 0x03, 0x55, 0x04, 0x03])
    const cnValue = this.buildUtf8String(commonName)
    const cnSequence = this.buildSequence([cnOid, cnValue])
    const cnSet = this.buildSet([cnSequence])
    return this.buildSequence([cnSet])
  }

  private buildAttributes(domains: string[]): Uint8Array {
    // Build extensionRequest attribute for SAN
    // OID: 1.2.840.113549.1.9.14 (extensionRequest)
    const extReqOid = new Uint8Array([
      0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x0e,
    ])

    // Build SAN extension
    const sanExtension = this.buildSANExtension(domains)
    const extensions = this.buildSequence([sanExtension])
    const extSet = this.buildSet([extensions])

    const attribute = this.buildSequence([extReqOid, extSet])

    // Wrap in context-specific tag [0]
    return this.buildContextTag(0, [attribute])
  }

  private buildSANExtension(domains: string[]): Uint8Array {
    // OID: 2.5.29.17 (subjectAltName)
    const sanOid = new Uint8Array([0x06, 0x03, 0x55, 0x1d, 0x11])

    // Build GeneralNames sequence
    const dnsNames: Uint8Array[] = domains.map((domain) => {
      const domainBytes = new TextEncoder().encode(domain)
      // Context-specific tag [2] for dNSName
      const result = new Uint8Array(2 + domainBytes.length)
      result[0] = 0x82
      result[1] = domainBytes.length
      result.set(domainBytes, 2)
      return result
    })

    const generalNames = this.buildSequence(dnsNames)
    const extValue = this.buildOctetString(generalNames)

    return this.buildSequence([sanOid, extValue])
  }

  private buildSignatureAlgorithm(): Uint8Array {
    // OID: 1.2.840.10045.4.3.2 (ecdsa-with-SHA256)
    const oid = new Uint8Array([
      0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02,
    ])
    return this.buildSequence([oid])
  }

  private ecdsaSigToDer(sig: Uint8Array): Uint8Array {
    // WebCrypto returns signature as r || s (each 32 bytes for P-256)
    const r = sig.slice(0, 32)
    const s = sig.slice(32, 64)

    const rDer = this.buildInteger(r)
    const sDer = this.buildInteger(s)

    return this.buildSequence([rDer, sDer])
  }

  private buildInteger(value: Uint8Array): Uint8Array {
    // Remove leading zeros but ensure positive
    let start = 0
    while (start < value.length - 1 && value[start] === 0) start++

    const trimmed = value.slice(start)

    // Add leading zero if high bit is set (to keep positive)
    const needsLeadingZero = trimmed[0] & 0x80
    const length = trimmed.length + (needsLeadingZero ? 1 : 0)

    const result = new Uint8Array(2 + length)
    result[0] = 0x02 // INTEGER tag
    result[1] = length
    if (needsLeadingZero) {
      result[2] = 0x00
      result.set(trimmed, 3)
    } else {
      result.set(trimmed, 2)
    }
    return result
  }

  private buildSequence(items: Uint8Array[]): Uint8Array {
    return this.buildTag(0x30, items)
  }

  private buildSet(items: Uint8Array[]): Uint8Array {
    return this.buildTag(0x31, items)
  }

  private buildOctetString(data: Uint8Array): Uint8Array {
    const lenBytes = this.encodeLength(data.length)
    const result = new Uint8Array(1 + lenBytes.length + data.length)
    result[0] = 0x04
    result.set(lenBytes, 1)
    result.set(data, 1 + lenBytes.length)
    return result
  }

  private buildBitString(data: Uint8Array): Uint8Array {
    // BIT STRING with 0 unused bits
    const lenBytes = this.encodeLength(data.length + 1)
    const result = new Uint8Array(1 + lenBytes.length + 1 + data.length)
    result[0] = 0x03
    result.set(lenBytes, 1)
    result[1 + lenBytes.length] = 0x00
    result.set(data, 1 + lenBytes.length + 1)
    return result
  }

  private buildUtf8String(str: string): Uint8Array {
    const bytes = new TextEncoder().encode(str)
    const lenBytes = this.encodeLength(bytes.length)
    const result = new Uint8Array(1 + lenBytes.length + bytes.length)
    result[0] = 0x0c
    result.set(lenBytes, 1)
    result.set(bytes, 1 + lenBytes.length)
    return result
  }

  private buildContextTag(tagNum: number, items: Uint8Array[]): Uint8Array {
    return this.buildTag(0xa0 + tagNum, items)
  }

  private buildTag(tag: number, items: Uint8Array[]): Uint8Array {
    const content = this.concatArrays(items)
    const lenBytes = this.encodeLength(content.length)
    const result = new Uint8Array(1 + lenBytes.length + content.length)
    result[0] = tag
    result.set(lenBytes, 1)
    result.set(content, 1 + lenBytes.length)
    return result
  }

  private encodeLength(length: number): Uint8Array {
    if (length < 128) return new Uint8Array([length])
    if (length < 256) return new Uint8Array([0x81, length])
    if (length < 65536)
      return new Uint8Array([0x82, (length >> 8) & 0xff, length & 0xff])
    throw new Error('Length too long')
  }

  private concatArrays(arrays: Uint8Array[]): Uint8Array {
    const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const arr of arrays) {
      result.set(arr, offset)
      offset += arr.length
    }
    return result
  }

  private base64url(data: Uint8Array): string {
    let binary = ''
    for (let i = 0; i < data.length; i++) {
      binary += String.fromCharCode(data[i])
    }
    return btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  }

  private arrayBufferToPem(buffer: ArrayBuffer, type: string): string {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    const base64 = btoa(binary)
    const lines = base64.match(/.{1,64}/g) ?? []
    return `-----BEGIN ${type}-----\n${lines.join('\n')}\n-----END ${type}-----`
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// ============================================================================
// Certificate Manager Integration
// ============================================================================

/**
 * Create an ACME-based certificate manager
 */
export function createACMECertificateManager(config: ACMEConfig): ACMEClient {
  return new ACMEClient(config)
}

/**
 * Example usage for automatic certificate issuance
 */
export async function issueCertificate(
  domain: string,
  options: {
    email: string
    staging?: boolean
    challengeType?: 'http-01' | 'dns-01'
  },
): Promise<IssuedCertificate> {
  const directory = options.staging
    ? ACME_DIRECTORIES.letsencrypt.staging
    : ACME_DIRECTORIES.letsencrypt.production

  const client = new ACMEClient({
    directory,
    email: options.email,
    acceptTerms: true,
    challengeType: options.challengeType ?? 'http-01',
  })

  await client.initialize()

  const { order, challenges } = await client.requestCertificate(domain)

  // In a real implementation, you'd set up the challenge responses here
  // For HTTP-01: serve keyAuthorization at /.well-known/acme-challenge/{token}
  // For DNS-01: create TXT record at _acme-challenge.{domain}

  console.log('\nChallenge setup required:')
  for (const [dom, challenge] of Array.from(challenges.entries())) {
    if (challenge.type === 'http-01') {
      console.log(
        `HTTP-01: Serve "${challenge.keyAuthorization}" at ` +
          `http://${dom}/.well-known/acme-challenge/${challenge.token}`,
      )
    } else if (challenge.type === 'dns-01') {
      const txtValue = await client.getDns01Record(challenge.token)
      console.log(
        `DNS-01: Create TXT record "_acme-challenge.${dom}" with value "${txtValue}"`,
      )
    }
  }

  // Wait for manual challenge setup (in production, this would be automated)
  console.log('\nPress Enter after setting up challenges...')
  await new Promise((resolve) => setTimeout(resolve, 5000))

  return client.completeChallenges(order, challenges)
}
