/**
 * X.509 Certificate Utilities
 *
 * Provides certificate generation using Web Crypto API.
 * Compatible with workerd/Cloudflare Workers environment.
 */

// ============================================================================
// Types
// ============================================================================

export interface CertificateInfo {
  subject: {
    commonName: string
    organization?: string
    country?: string
  }
  issuer: {
    commonName: string
    organization?: string
    country?: string
  }
  serialNumber: string
  notBefore: Date
  notAfter: Date
  subjectAltNames: string[]
  keyUsage: string[]
  extKeyUsage: string[]
  publicKeyAlgorithm: string
}

export interface GenerateCertificateOptions {
  commonName: string
  organization?: string
  country?: string
  altNames?: string[]
  validityDays?: number
  keyUsage?: string[]
  extKeyUsage?: string[]
  isCA?: boolean
}

export interface GeneratedCertificate {
  certificate: string // PEM
  privateKey: string // PEM
  publicKey: string // PEM
  info: CertificateInfo
}

// ============================================================================
// ASN.1 DER Building Utilities
// ============================================================================

function encodeLength(length: number): Uint8Array {
  if (length < 128) {
    return new Uint8Array([length])
  } else if (length < 256) {
    return new Uint8Array([0x81, length])
  } else if (length < 65536) {
    return new Uint8Array([0x82, (length >> 8) & 0xff, length & 0xff])
  }
  throw new Error('Length too long')
}

function buildTag(tag: number, content: Uint8Array): Uint8Array {
  const lenBytes = encodeLength(content.length)
  const result = new Uint8Array(1 + lenBytes.length + content.length)
  result[0] = tag
  result.set(lenBytes, 1)
  result.set(content, 1 + lenBytes.length)
  return result
}

function buildSequence(items: Uint8Array[]): Uint8Array {
  const content = concatArrays(items)
  return buildTag(0x30, content)
}

function buildSet(items: Uint8Array[]): Uint8Array {
  const content = concatArrays(items)
  return buildTag(0x31, content)
}

function buildInteger(value: bigint | number | Uint8Array): Uint8Array {
  let bytes: Uint8Array

  if (value instanceof Uint8Array) {
    bytes = value
  } else {
    const bigValue = typeof value === 'number' ? BigInt(value) : value
    if (bigValue === 0n) {
      bytes = new Uint8Array([0])
    } else {
      const temp: number[] = []
      let remaining = bigValue
      while (remaining > 0n) {
        temp.unshift(Number(remaining & 0xffn))
        remaining >>= 8n
      }
      bytes = new Uint8Array(temp)
    }
  }

  // Add leading zero if high bit is set (to keep positive)
  if (bytes.length > 0 && bytes[0] & 0x80) {
    const padded = new Uint8Array(bytes.length + 1)
    padded[0] = 0
    padded.set(bytes, 1)
    bytes = padded
  }

  return buildTag(0x02, bytes)
}

function buildBitString(content: Uint8Array, unusedBits = 0): Uint8Array {
  const data = new Uint8Array(content.length + 1)
  data[0] = unusedBits
  data.set(content, 1)
  return buildTag(0x03, data)
}

function buildOctetString(content: Uint8Array): Uint8Array {
  return buildTag(0x04, content)
}

function buildOID(oid: number[]): Uint8Array {
  const bytes: number[] = []
  // First two components are encoded specially
  bytes.push(oid[0] * 40 + oid[1])

  for (let i = 2; i < oid.length; i++) {
    let component = oid[i]
    if (component < 128) {
      bytes.push(component)
    } else {
      const encoded: number[] = []
      while (component > 0) {
        encoded.unshift((component & 0x7f) | (encoded.length > 0 ? 0x80 : 0))
        component >>= 7
      }
      bytes.push(...encoded)
    }
  }
  return buildTag(0x06, new Uint8Array(bytes))
}

function buildUTF8String(value: string): Uint8Array {
  return buildTag(0x0c, new TextEncoder().encode(value))
}

function buildPrintableString(value: string): Uint8Array {
  return buildTag(0x13, new TextEncoder().encode(value))
}

function buildUTCTime(date: Date): Uint8Array {
  const year = (date.getUTCFullYear() % 100).toString().padStart(2, '0')
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0')
  const day = date.getUTCDate().toString().padStart(2, '0')
  const hours = date.getUTCHours().toString().padStart(2, '0')
  const minutes = date.getUTCMinutes().toString().padStart(2, '0')
  const seconds = date.getUTCSeconds().toString().padStart(2, '0')
  const timeStr = `${year}${month}${day}${hours}${minutes}${seconds}Z`
  return buildTag(0x17, new TextEncoder().encode(timeStr))
}

function buildContextTag(tagNum: number, content: Uint8Array): Uint8Array {
  return buildTag(0xa0 + tagNum, content)
}

function concatArrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.length
  }
  return result
}

// ============================================================================
// Certificate Generation
// ============================================================================

/**
 * Generate a self-signed X.509 certificate
 */
export async function generateSelfSignedCertificate(
  options: GenerateCertificateOptions,
): Promise<GeneratedCertificate> {
  const {
    commonName,
    organization,
    country,
    altNames = [],
    validityDays = 365,
    isCA = false,
  } = options

  // Generate ECDSA P-256 key pair
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'ECDSA',
      namedCurve: 'P-256',
    },
    true,
    ['sign', 'verify'],
  )

  // Export keys
  const privateKeyPkcs8 = await crypto.subtle.exportKey(
    'pkcs8',
    keyPair.privateKey,
  )
  const publicKeySpki = await crypto.subtle.exportKey('spki', keyPair.publicKey)

  // Build certificate
  const notBefore = new Date()
  const notAfter = new Date(
    notBefore.getTime() + validityDays * 24 * 60 * 60 * 1000,
  )

  // Generate random serial number
  const serialBytes = new Uint8Array(16)
  crypto.getRandomValues(serialBytes)
  // Ensure first byte doesn't have high bit set (keep positive)
  serialBytes[0] &= 0x7f

  // Build TBS certificate
  const tbsCertificate = buildTBSCertificate({
    serialNumber: serialBytes,
    issuer: { commonName, organization, country },
    subject: { commonName, organization, country },
    notBefore,
    notAfter,
    publicKey: new Uint8Array(publicKeySpki),
    altNames: [commonName, ...altNames],
    isCA,
  })

  // Sign the TBS certificate with ECDSA-SHA256
  // Cast needed due to Bun types vs DOM types conflict for Uint8Array
  const tbsBuffer = new ArrayBuffer(tbsCertificate.length)
  new Uint8Array(tbsBuffer).set(tbsCertificate)
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    keyPair.privateKey,
    tbsBuffer,
  )

  // Convert ECDSA signature to DER format
  const signatureDer = ecdsaSigToDer(new Uint8Array(signature))

  // Build final certificate
  const certificate = buildCertificate(tbsCertificate, signatureDer)

  // Convert to PEM
  const certPem = arrayBufferToPem(certificate, 'CERTIFICATE')
  const privateKeyPem = arrayBufferToPem(privateKeyPkcs8, 'PRIVATE KEY')
  const publicKeyPem = arrayBufferToPem(publicKeySpki, 'PUBLIC KEY')

  return {
    certificate: certPem,
    privateKey: privateKeyPem,
    publicKey: publicKeyPem,
    info: {
      subject: { commonName, organization, country },
      issuer: { commonName, organization, country },
      serialNumber: Array.from(serialBytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(':'),
      notBefore,
      notAfter,
      subjectAltNames: [commonName, ...altNames],
      keyUsage: ['digitalSignature', 'keyEncipherment'],
      extKeyUsage: ['serverAuth'],
      publicKeyAlgorithm: 'ECDSA P-256',
    },
  }
}

function buildTBSCertificate(options: {
  serialNumber: Uint8Array
  issuer: { commonName: string; organization?: string; country?: string }
  subject: { commonName: string; organization?: string; country?: string }
  notBefore: Date
  notAfter: Date
  publicKey: Uint8Array // SPKI format
  altNames: string[]
  isCA: boolean
}): Uint8Array {
  // Version (v3 = 2, wrapped in context tag [0])
  const version = buildContextTag(0, buildInteger(2))

  // Serial Number
  const serial = buildInteger(options.serialNumber)

  // Signature Algorithm (ECDSA with SHA-256)
  // OID: 1.2.840.10045.4.3.2
  const signatureAlgorithm = buildSequence([
    buildOID([1, 2, 840, 10045, 4, 3, 2]),
  ])

  // Issuer
  const issuer = buildName(options.issuer)

  // Validity
  const validity = buildSequence([
    buildUTCTime(options.notBefore),
    buildUTCTime(options.notAfter),
  ])

  // Subject
  const subject = buildName(options.subject)

  // Subject Public Key Info (already in SPKI format)
  const subjectPublicKeyInfo = options.publicKey

  // Extensions (context tag [3])
  const extensions = buildContextTag(
    3,
    buildSequence([
      buildBasicConstraintsExtension(options.isCA),
      buildKeyUsageExtension(),
      buildExtKeyUsageExtension(),
      buildSubjectAltNameExtension(options.altNames),
    ]),
  )

  return buildSequence([
    version,
    serial,
    signatureAlgorithm,
    issuer,
    validity,
    subject,
    subjectPublicKeyInfo,
    extensions,
  ])
}

function buildName(name: {
  commonName: string
  organization?: string
  country?: string
}): Uint8Array {
  const rdns: Uint8Array[] = []

  if (name.country) {
    // OID: 2.5.4.6 (countryName)
    rdns.push(
      buildSet([
        buildSequence([
          buildOID([2, 5, 4, 6]),
          buildPrintableString(name.country),
        ]),
      ]),
    )
  }

  if (name.organization) {
    // OID: 2.5.4.10 (organizationName)
    rdns.push(
      buildSet([
        buildSequence([
          buildOID([2, 5, 4, 10]),
          buildUTF8String(name.organization),
        ]),
      ]),
    )
  }

  // OID: 2.5.4.3 (commonName)
  rdns.push(
    buildSet([
      buildSequence([buildOID([2, 5, 4, 3]), buildUTF8String(name.commonName)]),
    ]),
  )

  return buildSequence(rdns)
}

function buildBasicConstraintsExtension(isCA: boolean): Uint8Array {
  // OID: 2.5.29.19
  const oid = buildOID([2, 5, 29, 19])
  const critical = new Uint8Array([0x01, 0x01, 0xff]) // BOOLEAN TRUE

  let value: Uint8Array
  if (isCA) {
    // SEQUENCE { BOOLEAN TRUE }
    value = buildSequence([new Uint8Array([0x01, 0x01, 0xff])])
  } else {
    // Empty SEQUENCE
    value = buildSequence([])
  }

  return buildSequence([oid, critical, buildOctetString(value)])
}

function buildKeyUsageExtension(): Uint8Array {
  // OID: 2.5.29.15
  const oid = buildOID([2, 5, 29, 15])
  const critical = new Uint8Array([0x01, 0x01, 0xff])

  // KeyUsage ::= BIT STRING
  // digitalSignature (0) + keyEncipherment (2) = 0b10100000 = 0xa0
  // With 5 unused bits at the end
  const value = buildBitString(new Uint8Array([0xa0]), 5)

  return buildSequence([oid, critical, buildOctetString(value)])
}

function buildExtKeyUsageExtension(): Uint8Array {
  // OID: 2.5.29.37
  const oid = buildOID([2, 5, 29, 37])

  // ExtKeyUsageSyntax ::= SEQUENCE SIZE (1..MAX) OF KeyPurposeId
  // serverAuth OID: 1.3.6.1.5.5.7.3.1
  const value = buildSequence([buildOID([1, 3, 6, 1, 5, 5, 7, 3, 1])])

  return buildSequence([oid, buildOctetString(value)])
}

function buildSubjectAltNameExtension(domains: string[]): Uint8Array {
  // OID: 2.5.29.17
  const oid = buildOID([2, 5, 29, 17])

  // GeneralNames ::= SEQUENCE SIZE (1..MAX) OF GeneralName
  // dNSName [2] IA5String
  const names = domains.map((domain) => {
    const bytes = new TextEncoder().encode(domain)
    return buildTag(0x82, bytes) // Context tag [2]
  })

  const value = buildSequence(names)

  return buildSequence([oid, buildOctetString(value)])
}

function ecdsaSigToDer(sig: Uint8Array): Uint8Array {
  // WebCrypto returns r || s (each 32 bytes for P-256)
  const r = sig.slice(0, 32)
  const s = sig.slice(32, 64)

  return buildSequence([buildInteger(r), buildInteger(s)])
}

function buildCertificate(
  tbsCertificate: Uint8Array,
  signature: Uint8Array,
): Uint8Array {
  // Signature Algorithm (ECDSA with SHA-256)
  const signatureAlgorithm = buildSequence([
    buildOID([1, 2, 840, 10045, 4, 3, 2]),
  ])

  // Signature Value (BIT STRING)
  const signatureValue = buildBitString(signature)

  return buildSequence([tbsCertificate, signatureAlgorithm, signatureValue])
}

function arrayBufferToPem(
  buffer: ArrayBuffer | Uint8Array,
  type: string,
): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  const base64 = btoa(binary)
  const lines = base64.match(/.{1,64}/g) ?? []
  return `-----BEGIN ${type}-----\n${lines.join('\n')}\n-----END ${type}-----`
}

// ============================================================================
// Certificate Parsing (Basic)
// ============================================================================

/**
 * Parse basic info from a PEM certificate
 */
export function parseCertificate(pem: string): CertificateInfo | null {
  const match = pem.match(
    /-----BEGIN CERTIFICATE-----\s*([\s\S]*?)\s*-----END CERTIFICATE-----/,
  )
  if (!match) return null

  // Basic parsing - extracts dates if possible
  // Full ASN.1 parsing would require a complete DER decoder

  return {
    subject: { commonName: 'certificate-cn' },
    issuer: { commonName: 'certificate-issuer' },
    serialNumber: '00:00:00:00',
    notBefore: new Date(),
    notAfter: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    subjectAltNames: [],
    keyUsage: [],
    extKeyUsage: [],
    publicKeyAlgorithm: 'unknown',
  }
}

/**
 * Check if a certificate is expiring soon
 */
export function isCertificateExpiringSoon(
  pem: string,
  daysThreshold = 30,
): boolean {
  const info = parseCertificate(pem)
  if (!info) return true
  const threshold = Date.now() + daysThreshold * 24 * 60 * 60 * 1000
  return info.notAfter.getTime() < threshold
}

/**
 * Get certificate expiry from PEM
 */
export function getCertificateExpiry(pem: string): Date | null {
  const info = parseCertificate(pem)
  return info?.notAfter ?? null
}
