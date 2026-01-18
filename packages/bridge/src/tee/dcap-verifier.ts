/**
 * DCAP Quote Verification Library
 *
 * Implements Intel DCAP (Data Center Attestation Primitives) verification
 * for SGX and TDX quotes.
 *
 * DCAP Quote Structure (v4):
 * - Header (48 bytes)
 * - Body/Report (384 bytes for SGX, 584 bytes for TDX)
 * - Signature Data (variable)
 *
 * Verification steps:
 * 1. Parse quote structure
 * 2. Verify ECDSA signature over report
 * 3. Validate certificate chain to Intel root CA
 * 4. Check mrEnclave/mrSigner against whitelist
 * 5. Verify quote freshness
 *
 * ⚠️ IMPORTANT - TESTING REQUIREMENTS:
 *
 * This implementation follows the Intel DCAP v4 specification but has NOT been
 * tested against production SGX/TDX quotes from real hardware. Before using in
 * production:
 *
 * 1. Test with real SGX quotes from Intel SGX hardware
 * 2. Test with real TDX quotes from Intel TDX hardware
 * 3. Verify the Intel Root CA certificate is up-to-date
 * 4. Test certificate chain validation with production cert chains
 * 5. Verify ECDSA signature verification with known-good quotes
 *
 * The quote parsing and signature verification logic is based on:
 * - Intel SGX DCAP v4 Quote Format: https://download.01.org/intel-sgx/latest/dcap-latest/
 * - Intel SGX Developer Reference
 *
 * Known limitations:
 * - TCB (Trusted Computing Base) level verification not implemented
 * - Collateral verification (PCK certificates) not implemented
 * - Quote freshness relies on external timestamp in reportData
 */

import { createVerify, X509Certificate } from 'node:crypto'
import { z } from 'zod'

// ============================================================================
// Types
// ============================================================================

export type TEEPlatformType =
  | 'SGX'
  | 'TDX'
  | 'SEV_SNP'
  | 'PHALA'
  | 'DSTACK'
  | 'GCP_CONFIDENTIAL'

export interface QuoteHeader {
  version: number
  attestationKeyType: number
  teeType: TEEPlatformType
  reserved: Uint8Array
  qeVendorId: Uint8Array
  userData: Uint8Array
}

export interface SGXReportBody {
  cpuSvn: Uint8Array // 16 bytes
  miscSelect: number // 4 bytes
  reserved1: Uint8Array // 28 bytes
  attributes: Uint8Array // 16 bytes
  mrEnclave: Uint8Array // 32 bytes
  reserved2: Uint8Array // 32 bytes
  mrSigner: Uint8Array // 32 bytes
  reserved3: Uint8Array // 96 bytes
  isvProdId: number // 2 bytes
  isvSvn: number // 2 bytes
  reserved4: Uint8Array // 60 bytes
  reportData: Uint8Array // 64 bytes
}

export interface TDXReportBody {
  teeTcbSvn: Uint8Array // 16 bytes
  mrSeam: Uint8Array // 48 bytes
  mrSignerSeam: Uint8Array // 48 bytes
  seamAttributes: Uint8Array // 8 bytes
  tdAttributes: Uint8Array // 8 bytes
  xfam: Uint8Array // 8 bytes
  mrTd: Uint8Array // 48 bytes
  mrConfigId: Uint8Array // 48 bytes
  mrOwner: Uint8Array // 48 bytes
  mrOwnerConfig: Uint8Array // 48 bytes
  rtMr0: Uint8Array // 48 bytes
  rtMr1: Uint8Array // 48 bytes
  rtMr2: Uint8Array // 48 bytes
  rtMr3: Uint8Array // 48 bytes
  reportData: Uint8Array // 64 bytes
}

export interface QuoteSignature {
  signature: Uint8Array
  attestationPublicKey: Uint8Array
  certificationData: CertificationData
}

export interface CertificationData {
  certType: number
  certDataSize: number
  certChain: string[]
}

export interface ParsedQuote {
  header: QuoteHeader
  body: SGXReportBody | TDXReportBody
  signature: QuoteSignature
  rawQuote: Uint8Array
  rawHeader: Uint8Array
  rawBody: Uint8Array
}

export interface VerificationResult {
  valid: boolean
  platform: TEEPlatformType
  mrEnclave: string
  mrSigner: string
  reportData: string
  timestamp: number
  errors: string[]
  warnings: string[]
  details: {
    signatureValid: boolean
    certChainValid: boolean
    measurementTrusted: boolean
    quoteFresh: boolean
    tcbLevel?: string
  }
}

export interface TrustedMeasurement {
  mrEnclave: string
  mrSigner: string
  platform: TEEPlatformType
  description: string
}

export interface DCAPVerifierConfig {
  trustedMeasurements: TrustedMeasurement[]
  maxQuoteAge: number // seconds
  requireFreshQuote: boolean
  intelRootCaPem?: string
  allowTestMode: boolean
}

// ============================================================================
// Constants
// ============================================================================

const QUOTE_HEADER_SIZE = 48
const SGX_REPORT_BODY_SIZE = 384
const TDX_REPORT_BODY_SIZE = 584
const ECDSA_SIGNATURE_SIZE = 64
const ECDSA_PUBLIC_KEY_SIZE = 64

// TEE types in quote header
const TEE_TYPE_SGX = 0x00
const TEE_TYPE_TDX = 0x81

// Intel Root CA public key (production)
const INTEL_ROOT_CA_PEM = `-----BEGIN CERTIFICATE-----
MIICjzCCAjSgAwIBAgIUImUM1lqdNInzg7SVUr9QGzknBqwwCgYIKoZIzj0EAwIw
aDEaMBgGA1UEAwwRSW50ZWwgU0dYIFJvb3QgQ0ExGjAYBgNVBAoMEUludGVsIENv
cnBvcmF0aW9uMRQwEgYDVQQHDAtTYW50YSBDbGFyYTELMAkGA1UECAwCQ0ExCzAJ
BgNVBAYTAlVTMB4XDTE4MDUyMTEwNDUxMFoXDTQ5MTIzMTIzNTk1OVowaDEaMBgG
A1UEAwwRSW50ZWwgU0dYIFJvb3QgQ0ExGjAYBgNVBAoMEUludGVsIENvcnBvcmF0
aW9uMRQwEgYDVQQHDAtTYW50YSBDbGFyYTELMAkGA1UECAwCQ0ExCzAJBgNVBAYT
AlVTMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEC6nEwMDIYZOj/iPWsCzaEKi7
1OiOSLRFhWGjbnBVJfVnkY4u3IjkDYYL0MxO4mqsyYjlBalTVYxFP2sJBK5zlKOB
uzCBuDAfBgNVHSMEGDAWgBQiZQzWWp00ifODtJVSv1AbOScGrDBSBgNVHR8ESzBJ
MEegRaBDhkFodHRwczovL2NlcnRpZmljYXRlcy50cnVzdGVkc2VydmljZXMuaW50
ZWwuY29tL0ludGVsU0dYUm9vdENBLmRlcjAdBgNVHQ4EFgQUImUM1lqdNInzg7SV
Ur9QGzknBqwwDgYDVR0PAQH/BAQDAgEGMBIGA1UdEwEB/wQIMAYBAf8CAQEwCgYI
KoZIzj0EAwIDSQAwRgIhAOW/5QkR+S9CiSDcNoowLuPRLsWGf/Yi7GSX94BgwTwg
AiEA4J0lrHoMs+Xo5o/sX6O9QWxHRAvZUGOdRQ7cvqRXaqI=
-----END CERTIFICATE-----`

// ============================================================================
// Quote Parser
// ============================================================================

/**
 * Parse a DCAP quote into its components
 */
export function parseQuote(quoteBytes: Uint8Array): ParsedQuote {
  if (quoteBytes.length < QUOTE_HEADER_SIZE + SGX_REPORT_BODY_SIZE) {
    throw new Error(
      `Quote too short: ${quoteBytes.length} bytes, minimum ${QUOTE_HEADER_SIZE + SGX_REPORT_BODY_SIZE}`,
    )
  }

  const view = new DataView(
    quoteBytes.buffer,
    quoteBytes.byteOffset,
    quoteBytes.byteLength,
  )
  let offset = 0

  // Parse header (48 bytes)
  const version = view.getUint16(offset, true)
  offset += 2
  const attestationKeyType = view.getUint16(offset, true)
  offset += 2
  const teeTypeRaw = view.getUint32(offset, true)
  offset += 4
  const reserved = quoteBytes.slice(offset, offset + 2)
  offset += 2
  const qeVendorId = quoteBytes.slice(offset, offset + 16)
  offset += 16
  const userData = quoteBytes.slice(offset, offset + 20)
  offset += 20

  const teeType: TEEPlatformType =
    teeTypeRaw === TEE_TYPE_TDX
      ? 'TDX'
      : teeTypeRaw === TEE_TYPE_SGX
        ? 'SGX'
        : 'SGX'

  const header: QuoteHeader = {
    version,
    attestationKeyType,
    teeType,
    reserved,
    qeVendorId,
    userData,
  }

  // Parse body based on TEE type
  const bodySize =
    teeType === 'TDX' ? TDX_REPORT_BODY_SIZE : SGX_REPORT_BODY_SIZE
  const rawBody = quoteBytes.slice(
    QUOTE_HEADER_SIZE,
    QUOTE_HEADER_SIZE + bodySize,
  )
  const body = teeType === 'TDX' ? parseTDXBody(rawBody) : parseSGXBody(rawBody)

  // Parse signature data
  const signatureOffset = QUOTE_HEADER_SIZE + bodySize
  const signature = parseSignatureData(quoteBytes.slice(signatureOffset))

  return {
    header,
    body,
    signature,
    rawQuote: quoteBytes,
    rawHeader: quoteBytes.slice(0, QUOTE_HEADER_SIZE),
    rawBody,
  }
}

function parseSGXBody(bodyBytes: Uint8Array): SGXReportBody {
  if (bodyBytes.length < SGX_REPORT_BODY_SIZE) {
    throw new Error(`SGX body too short: ${bodyBytes.length}`)
  }

  const view = new DataView(
    bodyBytes.buffer,
    bodyBytes.byteOffset,
    bodyBytes.byteLength,
  )
  let offset = 0

  const cpuSvn = bodyBytes.slice(offset, offset + 16)
  offset += 16
  const miscSelect = view.getUint32(offset, true)
  offset += 4
  const reserved1 = bodyBytes.slice(offset, offset + 28)
  offset += 28
  const attributes = bodyBytes.slice(offset, offset + 16)
  offset += 16
  const mrEnclave = bodyBytes.slice(offset, offset + 32)
  offset += 32
  const reserved2 = bodyBytes.slice(offset, offset + 32)
  offset += 32
  const mrSigner = bodyBytes.slice(offset, offset + 32)
  offset += 32
  const reserved3 = bodyBytes.slice(offset, offset + 96)
  offset += 96
  const isvProdId = view.getUint16(offset, true)
  offset += 2
  const isvSvn = view.getUint16(offset, true)
  offset += 2
  const reserved4 = bodyBytes.slice(offset, offset + 60)
  offset += 60
  const reportData = bodyBytes.slice(offset, offset + 64)

  return {
    cpuSvn,
    miscSelect,
    reserved1,
    attributes,
    mrEnclave,
    reserved2,
    mrSigner,
    reserved3,
    isvProdId,
    isvSvn,
    reserved4,
    reportData,
  }
}

function parseTDXBody(bodyBytes: Uint8Array): TDXReportBody {
  if (bodyBytes.length < TDX_REPORT_BODY_SIZE) {
    throw new Error(`TDX body too short: ${bodyBytes.length}`)
  }

  let offset = 0

  const teeTcbSvn = bodyBytes.slice(offset, offset + 16)
  offset += 16
  const mrSeam = bodyBytes.slice(offset, offset + 48)
  offset += 48
  const mrSignerSeam = bodyBytes.slice(offset, offset + 48)
  offset += 48
  const seamAttributes = bodyBytes.slice(offset, offset + 8)
  offset += 8
  const tdAttributes = bodyBytes.slice(offset, offset + 8)
  offset += 8
  const xfam = bodyBytes.slice(offset, offset + 8)
  offset += 8
  const mrTd = bodyBytes.slice(offset, offset + 48)
  offset += 48
  const mrConfigId = bodyBytes.slice(offset, offset + 48)
  offset += 48
  const mrOwner = bodyBytes.slice(offset, offset + 48)
  offset += 48
  const mrOwnerConfig = bodyBytes.slice(offset, offset + 48)
  offset += 48
  const rtMr0 = bodyBytes.slice(offset, offset + 48)
  offset += 48
  const rtMr1 = bodyBytes.slice(offset, offset + 48)
  offset += 48
  const rtMr2 = bodyBytes.slice(offset, offset + 48)
  offset += 48
  const rtMr3 = bodyBytes.slice(offset, offset + 48)
  offset += 48
  const reportData = bodyBytes.slice(offset, offset + 64)

  return {
    teeTcbSvn,
    mrSeam,
    mrSignerSeam,
    seamAttributes,
    tdAttributes,
    xfam,
    mrTd,
    mrConfigId,
    mrOwner,
    mrOwnerConfig,
    rtMr0,
    rtMr1,
    rtMr2,
    rtMr3,
    reportData,
  }
}

function parseSignatureData(sigBytes: Uint8Array): QuoteSignature {
  if (sigBytes.length < 4) {
    throw new Error('Signature data too short')
  }

  const view = new DataView(
    sigBytes.buffer,
    sigBytes.byteOffset,
    sigBytes.byteLength,
  )

  // Signature data length
  const sigDataLen = view.getUint32(0, true)
  if (sigBytes.length < 4 + sigDataLen) {
    throw new Error(
      `Signature data truncated: expected ${sigDataLen}, got ${sigBytes.length - 4}`,
    )
  }

  let offset = 4

  // ECDSA signature (64 bytes for P-256)
  const signature = sigBytes.slice(offset, offset + ECDSA_SIGNATURE_SIZE)
  offset += ECDSA_SIGNATURE_SIZE

  // Attestation public key (64 bytes for P-256)
  const attestationPublicKey = sigBytes.slice(
    offset,
    offset + ECDSA_PUBLIC_KEY_SIZE,
  )
  offset += ECDSA_PUBLIC_KEY_SIZE

  // Certification data
  const certType = view.getUint16(offset, true)
  offset += 2
  const certDataSize = view.getUint32(offset, true)
  offset += 4

  const certDataRaw = sigBytes.slice(offset, offset + certDataSize)
  const certChain = parseCertChain(certDataRaw)

  return {
    signature,
    attestationPublicKey,
    certificationData: {
      certType,
      certDataSize,
      certChain,
    },
  }
}

function parseCertChain(certData: Uint8Array): string[] {
  const certString = new TextDecoder().decode(certData)
  const certs: string[] = []

  const pemRegex =
    /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g
  let match: RegExpExecArray | null = pemRegex.exec(certString)
  while (match !== null) {
    certs.push(match[0])
    match = pemRegex.exec(certString)
  }

  return certs
}

// ============================================================================
// Signature Verification
// ============================================================================

/**
 * Verify ECDSA P-256 signature over quote
 */
export function verifyQuoteSignature(quote: ParsedQuote): boolean {
  // Construct message to verify: header + body
  const messageLen = quote.rawHeader.length + quote.rawBody.length
  const message = new Uint8Array(messageLen)
  message.set(quote.rawHeader, 0)
  message.set(quote.rawBody, quote.rawHeader.length)

  // Convert attestation public key to DER format for Node.js crypto
  const publicKeyDer = encodeEcdsaPublicKeyDer(
    quote.signature.attestationPublicKey,
  )

  // Verify signature
  const verify = createVerify('SHA256')
  verify.update(message)

  // Convert signature from raw to DER format
  const signatureDer = encodeEcdsaSignatureDer(quote.signature.signature)

  return verify.verify(
    {
      key: publicKeyDer,
      format: 'der',
      type: 'spki',
    },
    signatureDer,
  )
}

function encodeEcdsaPublicKeyDer(rawKey: Uint8Array): Buffer {
  // SPKI format for P-256 public key
  // SEQUENCE {
  //   SEQUENCE {
  //     OID 1.2.840.10045.2.1 (ecPublicKey)
  //     OID 1.2.840.10045.3.1.7 (secp256r1)
  //   }
  //   BIT STRING (uncompressed point: 04 || x || y)
  // }

  const ecPublicKeyOid = Buffer.from([
    0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
  ])
  const secp256r1Oid = Buffer.from([
    0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07,
  ])

  // Uncompressed point format
  const point = Buffer.concat([Buffer.from([0x04]), Buffer.from(rawKey)])

  const algorithmId = Buffer.concat([
    Buffer.from([0x30, ecPublicKeyOid.length + secp256r1Oid.length]),
    ecPublicKeyOid,
    secp256r1Oid,
  ])

  const bitString = Buffer.concat([
    Buffer.from([0x03, point.length + 1, 0x00]), // BIT STRING with no unused bits
    point,
  ])

  return Buffer.concat([
    Buffer.from([0x30, algorithmId.length + bitString.length]),
    algorithmId,
    bitString,
  ])
}

function encodeEcdsaSignatureDer(rawSig: Uint8Array): Buffer {
  // DER format: SEQUENCE { INTEGER r, INTEGER s }
  const r = rawSig.slice(0, 32)
  const s = rawSig.slice(32, 64)

  const encodeInteger = (val: Uint8Array): Buffer => {
    // Remove leading zeros but keep one if high bit is set
    let start = 0
    while (start < val.length - 1 && val[start] === 0) start++

    const needsPadding = val[start] >= 0x80
    const len = val.length - start + (needsPadding ? 1 : 0)

    const encoded = Buffer.alloc(2 + len)
    encoded[0] = 0x02 // INTEGER tag
    encoded[1] = len
    if (needsPadding) {
      encoded[2] = 0x00
      encoded.set(val.slice(start), 3)
    } else {
      encoded.set(val.slice(start), 2)
    }

    return encoded
  }

  const rEncoded = encodeInteger(r)
  const sEncoded = encodeInteger(s)

  return Buffer.concat([
    Buffer.from([0x30, rEncoded.length + sEncoded.length]),
    rEncoded,
    sEncoded,
  ])
}

// ============================================================================
// Certificate Chain Validation
// ============================================================================

/**
 * Validate certificate chain against Intel Root CA
 */
export function validateCertChain(
  certChain: string[],
  intelRootCaPem?: string,
): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (certChain.length === 0) {
    return { valid: false, errors: ['No certificates in chain'] }
  }

  const rootCaPem = intelRootCaPem ?? INTEL_ROOT_CA_PEM

  // Parse certificates
  const certs: X509Certificate[] = []
  for (const pem of certChain) {
    const cert = new X509Certificate(pem)
    certs.push(cert)
  }

  // Add Intel Root CA
  const rootCa = new X509Certificate(rootCaPem)

  // Verify chain from leaf to root
  for (let i = 0; i < certs.length; i++) {
    const cert = certs[i]

    // Check validity period
    const now = new Date()
    if (now < new Date(cert.validFrom) || now > new Date(cert.validTo)) {
      errors.push(`Certificate ${i} is outside validity period`)
    }

    // Verify issuer
    const issuer = i < certs.length - 1 ? certs[i + 1] : rootCa
    if (!cert.verify(issuer.publicKey)) {
      errors.push(`Certificate ${i} signature verification failed`)
    }
  }

  // Verify last cert is signed by root CA
  const lastCert = certs[certs.length - 1]
  if (!lastCert.verify(rootCa.publicKey)) {
    errors.push('Certificate chain does not chain to Intel Root CA')
  }

  return { valid: errors.length === 0, errors }
}

// ============================================================================
// DCAP Verifier Class
// ============================================================================

const DCAPVerifierConfigSchema = z.object({
  trustedMeasurements: z.array(
    z.object({
      mrEnclave: z.string(),
      mrSigner: z.string(),
      platform: z.enum([
        'SGX',
        'TDX',
        'SEV_SNP',
        'PHALA',
        'DSTACK',
        'GCP_CONFIDENTIAL',
      ]),
      description: z.string(),
    }),
  ),
  maxQuoteAge: z.number().positive(),
  requireFreshQuote: z.boolean(),
  intelRootCaPem: z.string().optional(),
  allowTestMode: z.boolean(),
})

export class DCAPVerifier {
  private config: DCAPVerifierConfig
  private trustedMeasurementSet: Set<string>

  constructor(config: DCAPVerifierConfig) {
    DCAPVerifierConfigSchema.parse(config)
    this.config = config
    this.trustedMeasurementSet = new Set(
      config.trustedMeasurements.map((m) =>
        `${m.platform}:${m.mrEnclave}:${m.mrSigner}`.toLowerCase(),
      ),
    )
  }

  /**
   * Verify a DCAP quote
   */
  verify(
    quoteBytes: Uint8Array,
    expectedReportData?: Uint8Array,
  ): VerificationResult {
    const errors: string[] = []
    const warnings: string[] = []
    const timestamp = Date.now()

    let signatureValid = false
    let certChainValid = false
    let measurementTrusted = false
    const quoteFresh = true

    let platform: TEEPlatformType = 'SGX'
    let mrEnclave = ''
    let mrSigner = ''
    let reportData = ''

    // Parse quote
    let quote: ParsedQuote
    try {
      quote = parseQuote(quoteBytes)
      platform = quote.header.teeType
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      errors.push(`Failed to parse quote: ${errorMsg}`)
      return {
        valid: false,
        platform,
        mrEnclave,
        mrSigner,
        reportData,
        timestamp,
        errors,
        warnings,
        details: {
          signatureValid,
          certChainValid,
          measurementTrusted,
          quoteFresh,
        },
      }
    }

    // Extract measurements based on platform
    if (quote.header.teeType === 'TDX') {
      const tdxBody = quote.body as TDXReportBody
      mrEnclave = bytesToHex(tdxBody.mrTd)
      mrSigner = bytesToHex(tdxBody.mrSignerSeam)
      reportData = bytesToHex(tdxBody.reportData)
    } else {
      const sgxBody = quote.body as SGXReportBody
      mrEnclave = bytesToHex(sgxBody.mrEnclave)
      mrSigner = bytesToHex(sgxBody.mrSigner)
      reportData = bytesToHex(sgxBody.reportData)
    }

    // Verify expected report data if provided
    if (expectedReportData) {
      const actualReportData =
        quote.header.teeType === 'TDX'
          ? (quote.body as TDXReportBody).reportData
          : (quote.body as SGXReportBody).reportData

      if (!areEqual(actualReportData, expectedReportData)) {
        errors.push('Report data mismatch')
      }
    }

    // Verify signature
    try {
      signatureValid = verifyQuoteSignature(quote)
      if (!signatureValid) {
        errors.push('Quote signature verification failed')
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      errors.push(`Signature verification error: ${errorMsg}`)
    }

    // Validate certificate chain
    if (quote.signature.certificationData.certChain.length > 0) {
      const certResult = validateCertChain(
        quote.signature.certificationData.certChain,
        this.config.intelRootCaPem,
      )
      certChainValid = certResult.valid
      if (!certChainValid) {
        errors.push(...certResult.errors)
      }
    } else {
      if (this.config.allowTestMode) {
        warnings.push('No certificate chain - test mode allowed')
        certChainValid = true
      } else {
        errors.push('No certificate chain provided')
      }
    }

    // Check trusted measurements
    const measurementKey = `${platform}:${mrEnclave}:${mrSigner}`.toLowerCase()
    measurementTrusted = this.trustedMeasurementSet.has(measurementKey)
    if (!measurementTrusted) {
      errors.push(`Measurement not trusted: ${measurementKey}`)
    }

    // Check quote freshness (based on local time since quotes don't have timestamps)
    // In production, this would check against a timestamp embedded in reportData
    // or use a nonce-based freshness check
    if (this.config.requireFreshQuote) {
      warnings.push(
        'Quote freshness check relies on external timestamp verification',
      )
    }

    const valid =
      errors.length === 0 &&
      signatureValid &&
      (certChainValid || this.config.allowTestMode) &&
      measurementTrusted

    return {
      valid,
      platform,
      mrEnclave,
      mrSigner,
      reportData,
      timestamp,
      errors,
      warnings,
      details: {
        signatureValid,
        certChainValid,
        measurementTrusted,
        quoteFresh,
      },
    }
  }

  /**
   * Add a trusted measurement at runtime
   */
  addTrustedMeasurement(measurement: TrustedMeasurement): void {
    this.config.trustedMeasurements.push(measurement)
    const key =
      `${measurement.platform}:${measurement.mrEnclave}:${measurement.mrSigner}`.toLowerCase()
    this.trustedMeasurementSet.add(key)
  }

  /**
   * Remove a trusted measurement
   */
  removeTrustedMeasurement(
    mrEnclave: string,
    mrSigner: string,
    platform: TEEPlatformType,
  ): boolean {
    const key = `${platform}:${mrEnclave}:${mrSigner}`.toLowerCase()
    if (!this.trustedMeasurementSet.has(key)) {
      return false
    }

    this.trustedMeasurementSet.delete(key)
    this.config.trustedMeasurements = this.config.trustedMeasurements.filter(
      (m) =>
        !(
          m.mrEnclave.toLowerCase() === mrEnclave.toLowerCase() &&
          m.mrSigner.toLowerCase() === mrSigner.toLowerCase() &&
          m.platform === platform
        ),
    )
    return true
  }

  /**
   * Get all trusted measurements
   */
  getTrustedMeasurements(): TrustedMeasurement[] {
    return [...this.config.trustedMeasurements]
  }

  /**
   * Parse a quote without verification
   */
  parseOnly(quoteBytes: Uint8Array): ParsedQuote {
    return parseQuote(quoteBytes)
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function areEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a DCAP verifier with default configuration
 */
export function createDCAPVerifier(
  trustedMeasurements: TrustedMeasurement[] = [],
  options?: Partial<DCAPVerifierConfig>,
): DCAPVerifier {
  return new DCAPVerifier({
    trustedMeasurements,
    maxQuoteAge: options?.maxQuoteAge ?? 24 * 60 * 60, // 24 hours
    requireFreshQuote: options?.requireFreshQuote ?? true,
    intelRootCaPem: options?.intelRootCaPem,
    allowTestMode: options?.allowTestMode ?? false,
  })
}
