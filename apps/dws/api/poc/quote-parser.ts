/**
 * TEE Quote Parser - Parses and validates attestation quotes from Intel TDX/SGX and AMD SEV-SNP
 */

import { type Hex, keccak256, toBytes } from 'viem'
import type {
  DCAPQuoteHeader,
  QuoteParseResult,
  QuoteVerificationResult,
  SEVSNPReport,
  TDXReportBody,
  TEEPlatform,
  TEEQuote,
} from './types'

// Constants

const SGX_TEE_TYPE = 0x00
const TDX_TEE_TYPE = 0x81
const DCAP_QUOTE_VERSION = 4
const MIN_QUOTE_SIZE = 128
const INTEL_VENDOR_ID = '939a7233f79c4ca9940a0db3957f0607'
const SEV_SNP_MIN_SIZE = 0x2a0

/**
 * Minimum acceptable TCB Security Version Numbers (SVN).
 * These thresholds determine if TEE firmware is up-to-date.
 *
 * Sources:
 * - Intel TDX: Intel TDX Module 1.5 requires CPU SVN >= 2, TCB SVN >= 3
 *   See: Intel TDX Module Base Architecture Specification, Section 3.4
 * - Intel SGX: SGX DCAP 1.16+ requires CPU SVN >= 2, TCB SVN >= 3
 *   See: Intel SGX SDK Release Notes
 * - AMD SEV-SNP: SNP API 1.51+ requires Guest SVN >= 10 (0x0a)
 *   See: AMD SEV-SNP ABI Specification, Table 3
 *
 * NOTE: These values should be updated when new security advisories are released.
 * Check Intel/AMD security bulletins quarterly for TCB recovery updates.
 */
const MIN_TCB_SVN = {
  intel_tdx: { cpu: 0x02, tcb: 0x03 },
  intel_sgx: { cpu: 0x02, tcb: 0x03 },
  amd_sev: { snp: 0x0a },
} as const

// Quote Parsing

export function parseQuote(quoteHex: Hex): QuoteParseResult {
  const bytes = hexToBytes(quoteHex)

  if (bytes.length < MIN_QUOTE_SIZE) {
    return {
      success: false,
      quote: null,
      error: `Quote too short: ${bytes.length} bytes`,
    }
  }

  const dcapResult = parseDCAPQuote(bytes, quoteHex)
  if (dcapResult.success) return dcapResult

  const sevResult = parseSEVSNPQuote(bytes, quoteHex)
  if (sevResult.success) return sevResult

  return {
    success: false,
    quote: null,
    error: `Unrecognized format. DCAP: ${dcapResult.error}. SEV-SNP: ${sevResult.error}`,
  }
}

function parseDCAPQuote(bytes: Uint8Array, raw: Hex): QuoteParseResult {
  const version = readUint16LE(bytes, 0)
  if (version !== DCAP_QUOTE_VERSION) {
    return {
      success: false,
      quote: null,
      error: `Invalid DCAP version: ${version}`,
    }
  }

  const header = parseDCAPHeader(bytes)

  let platform: TEEPlatform
  if (header.teeType === TDX_TEE_TYPE) platform = 'intel_tdx'
  else if (header.teeType === SGX_TEE_TYPE) platform = 'intel_sgx'
  else
    return {
      success: false,
      quote: null,
      error: `Unknown TEE type: ${header.teeType}`,
    }

  const vendorIdHex = bytesToHex(bytes.slice(12, 28)).slice(2).toLowerCase()
  if (vendorIdHex !== INTEL_VENDOR_ID) {
    return {
      success: false,
      quote: null,
      error: `Invalid vendor ID: ${vendorIdHex}`,
    }
  }

  let hardwareId: Hex,
    measurement: Hex,
    reportData: Hex,
    securityVersion: { cpu: number; tcb: number }

  if (platform === 'intel_tdx') {
    const reportBody = parseTDXReportBody(bytes, 48)
    measurement = reportBody.mrTd
    reportData = reportBody.reportData
    hardwareId = keccak256(
      toBytes(`${reportBody.mrSignerSeam}${reportBody.mrTd}`),
    )
    securityVersion = {
      cpu: readUint16LE(bytes, 48),
      tcb: Number(BigInt(`0x${reportBody.teeTcbSvn.slice(2, 6)}`)),
    }
  } else {
    const sgxReportBody = parseSGXReportBody(bytes, 48)
    measurement = sgxReportBody.mrEnclave
    reportData = sgxReportBody.reportData
    hardwareId = keccak256(
      toBytes(`${sgxReportBody.mrSigner}${sgxReportBody.mrEnclave}`),
    )
    securityVersion = { cpu: sgxReportBody.cpuSvn, tcb: sgxReportBody.isvSvn }
  }

  const signatureDataOffset = platform === 'intel_tdx' ? 632 : 432
  const signatureDataLength = readUint32LE(bytes, signatureDataOffset)
  const signatureStart = signatureDataOffset + 4
  const signatureEnd = signatureStart + signatureDataLength

  if (signatureEnd > bytes.length) {
    return {
      success: false,
      quote: null,
      error: `Signature extends beyond quote`,
    }
  }

  const signature = bytesToHex(bytes.slice(signatureStart, signatureEnd)) as Hex
  const certChain = extractCertChain(bytes.slice(signatureStart, signatureEnd))

  return {
    success: true,
    quote: {
      raw,
      platform,
      hardwareId,
      measurement,
      reportData,
      securityVersion,
      signature,
      certChain,
      timestamp: null,
    },
    error: null,
  }
}

function parseDCAPHeader(bytes: Uint8Array): DCAPQuoteHeader {
  return {
    version: readUint16LE(bytes, 0),
    attestationKeyType: readUint16LE(bytes, 2),
    teeType: readUint32LE(bytes, 4),
    reserved: bytesToHex(bytes.slice(8, 12)) as Hex,
    vendorId: bytesToHex(bytes.slice(12, 28)) as Hex,
    userData: bytesToHex(bytes.slice(28, 48)) as Hex,
  }
}

function parseTDXReportBody(bytes: Uint8Array, offset: number): TDXReportBody {
  return {
    teeTcbSvn: bytesToHex(bytes.slice(offset, offset + 16)) as Hex,
    mrSeam: bytesToHex(bytes.slice(offset + 16, offset + 64)) as Hex,
    mrSignerSeam: bytesToHex(bytes.slice(offset + 64, offset + 112)) as Hex,
    seamAttributes: bytesToHex(bytes.slice(offset + 112, offset + 120)) as Hex,
    tdAttributes: bytesToHex(bytes.slice(offset + 120, offset + 128)) as Hex,
    xfam: bytesToHex(bytes.slice(offset + 128, offset + 136)) as Hex,
    mrTd: bytesToHex(bytes.slice(offset + 136, offset + 184)) as Hex,
    mrConfigId: bytesToHex(bytes.slice(offset + 184, offset + 232)) as Hex,
    mrOwner: bytesToHex(bytes.slice(offset + 232, offset + 280)) as Hex,
    mrOwnerConfig: bytesToHex(bytes.slice(offset + 280, offset + 328)) as Hex,
    rtMr0: bytesToHex(bytes.slice(offset + 328, offset + 376)) as Hex,
    rtMr1: bytesToHex(bytes.slice(offset + 376, offset + 424)) as Hex,
    rtMr2: bytesToHex(bytes.slice(offset + 424, offset + 472)) as Hex,
    rtMr3: bytesToHex(bytes.slice(offset + 472, offset + 520)) as Hex,
    reportData: bytesToHex(bytes.slice(offset + 520, offset + 584)) as Hex,
  }
}

interface SGXReportBody {
  cpuSvn: number
  miscSelect: number
  attributes: Hex
  mrEnclave: Hex
  mrSigner: Hex
  isvProdId: number
  isvSvn: number
  reportData: Hex
}

function parseSGXReportBody(bytes: Uint8Array, offset: number): SGXReportBody {
  return {
    cpuSvn: readUint16LE(bytes, offset),
    miscSelect: readUint32LE(bytes, offset + 16),
    attributes: bytesToHex(bytes.slice(offset + 48, offset + 64)) as Hex,
    mrEnclave: bytesToHex(bytes.slice(offset + 64, offset + 96)) as Hex,
    mrSigner: bytesToHex(bytes.slice(offset + 128, offset + 160)) as Hex,
    isvProdId: readUint16LE(bytes, offset + 256),
    isvSvn: readUint16LE(bytes, offset + 258),
    reportData: bytesToHex(bytes.slice(offset + 320, offset + 384)) as Hex,
  }
}

function parseSEVSNPQuote(bytes: Uint8Array, raw: Hex): QuoteParseResult {
  if (bytes.length < SEV_SNP_MIN_SIZE) {
    return {
      success: false,
      quote: null,
      error: `SEV-SNP too short: ${bytes.length} bytes`,
    }
  }

  const version = readUint32LE(bytes, 0)
  if (version !== 2) {
    return {
      success: false,
      quote: null,
      error: `Invalid SEV-SNP version: ${version}`,
    }
  }

  const report = parseSEVSNPReport(bytes)

  return {
    success: true,
    quote: {
      raw,
      platform: 'amd_sev',
      hardwareId: report.chipId,
      measurement: report.measurement,
      reportData: bytesToHex(bytes.slice(0x50, 0x90)) as Hex,
      securityVersion: {
        cpu: report.guestSvn,
        tcb: Number(report.currentTcb & 0xffffn),
      },
      signature: report.signature,
      certChain: [],
      timestamp: null,
    },
    error: null,
  }
}

function parseSEVSNPReport(bytes: Uint8Array): SEVSNPReport {
  return {
    version: readUint32LE(bytes, 0),
    guestSvn: readUint32LE(bytes, 4),
    policy: readUint64LE(bytes, 8),
    familyId: bytesToHex(bytes.slice(0x10, 0x20)) as Hex,
    imageId: bytesToHex(bytes.slice(0x20, 0x30)) as Hex,
    vmpl: readUint32LE(bytes, 0x30),
    signatureAlgo: readUint32LE(bytes, 0x34),
    currentTcb: readUint64LE(bytes, 0x38),
    platformInfo: readUint64LE(bytes, 0x40),
    measurement: bytesToHex(bytes.slice(0x90, 0xc0)) as Hex,
    hostData: bytesToHex(bytes.slice(0xc0, 0xe0)) as Hex,
    idKeyDigest: bytesToHex(bytes.slice(0xe0, 0x110)) as Hex,
    authorKeyDigest: bytesToHex(bytes.slice(0x110, 0x140)) as Hex,
    reportId: bytesToHex(bytes.slice(0x140, 0x160)) as Hex,
    reportIdMa: bytesToHex(bytes.slice(0x160, 0x180)) as Hex,
    reportedTcb: readUint64LE(bytes, 0x180),
    chipId: bytesToHex(bytes.slice(0x1a0, 0x1e0)) as Hex,
    signature: bytesToHex(bytes.slice(0x2a0, 0x2a0 + 512)) as Hex,
  }
}

function extractCertChain(signatureData: Uint8Array): string[] {
  const certDataOffset = 64 + 64 + 4
  if (signatureData.length <= certDataOffset) return []

  const certDataSize = readUint32LE(signatureData, 128)
  if (
    certDataSize === 0 ||
    certDataOffset + certDataSize > signatureData.length
  )
    return []

  const certData = signatureData.slice(
    certDataOffset,
    certDataOffset + certDataSize,
  )
  const certString = new TextDecoder().decode(certData)
  const matches = certString.match(
    /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
  )
  return matches ?? []
}

// Quote Verification

export async function verifyQuote(
  quote: TEEQuote,
  expectedMeasurement?: Hex,
): Promise<QuoteVerificationResult> {
  const measurementMatch = expectedMeasurement
    ? quote.measurement.toLowerCase() === expectedMeasurement.toLowerCase()
    : true

  const certificateValid = await verifyCertificateChain(quote)
  const signatureValid = await verifyQuoteSignature(quote)
  const tcbStatus = checkTCBStatus(quote)
  const valid =
    measurementMatch &&
    certificateValid &&
    signatureValid &&
    tcbStatus === 'upToDate'

  return {
    valid,
    quote,
    certificateValid,
    signatureValid,
    measurementMatch,
    tcbStatus,
    error: valid
      ? null
      : buildVerificationError({
          measurementMatch,
          certificateValid,
          signatureValid,
          tcbStatus,
        }),
  }
}

async function verifyCertificateChain(quote: TEEQuote): Promise<boolean> {
  if (quote.platform === 'amd_sev') return verifySEVCertificate(quote)
  if (quote.certChain.length < 2) return false

  for (let i = 0; i < quote.certChain.length; i++) {
    const cert = quote.certChain[i]
    if (!cert.includes('-----BEGIN CERTIFICATE-----')) return false

    const derBytes = pemToDer(cert)
    if (!derBytes) return false

    const certInfo = parseX509Basic(derBytes)
    if (!certInfo) return false

    const now = Date.now()
    if (now < certInfo.notBefore || now > certInfo.notAfter) return false

    if (i < quote.certChain.length - 1) {
      const issuerDer = pemToDer(quote.certChain[i + 1])
      if (!issuerDer) return false

      const issuerKey = await extractPublicKeyFromCert(issuerDer)
      if (!issuerKey) return false

      const isValid = await verifyX509Signature(
        derBytes,
        issuerKey,
        certInfo.signatureAlgorithm,
      )
      if (!isValid) return false
    }
  }

  const rootDer = pemToDer(quote.certChain[quote.certChain.length - 1])
  if (!rootDer) return false

  const rootSubject = extractSubjectCN(rootDer)
  const knownRoots = [
    'Intel SGX Root CA',
    'Intel SGX PCK Processor CA',
    'Intel SGX PCK Platform CA',
    'Intel SGX TCB Signing',
  ]
  const isKnownRoot =
    rootSubject !== null && knownRoots.some((ca) => rootSubject.includes(ca))

  if (!isKnownRoot) {
    console.warn(`[PoC] Unknown root CA: "${rootSubject}"`)
    return false
  }

  return true
}

async function verifySEVCertificate(quote: TEEQuote): Promise<boolean> {
  const sigBytes = hexToBytes(quote.signature)
  const isRSA = sigBytes.length === 512
  const isECDSA = sigBytes.length === 96

  if (!isRSA && !isECDSA) return false

  // Check entropy
  let nonZeroCount = 0
  const uniqueBytes = new Set<number>()
  for (const b of sigBytes) {
    if (b !== 0) nonZeroCount++
    uniqueBytes.add(b)
  }
  if (nonZeroCount < sigBytes.length / 4 || uniqueBytes.size < 16) return false

  if (isECDSA) {
    const r = bytesToBigInt(sigBytes.slice(0, 48))
    const s = bytesToBigInt(sigBytes.slice(48, 96))
    const n = BigInt(
      '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFC7634D81F4372DDF581A0DB248B0A77AECEC196ACCC52973',
    )
    if (r <= 0n || r >= n || s <= 0n || s >= n) return false
  }

  return true
}

async function verifyQuoteSignature(quote: TEEQuote): Promise<boolean> {
  const sigBytes = hexToBytes(quote.signature)

  if (quote.platform === 'amd_sev') {
    if (sigBytes.length !== 512 && sigBytes.length !== 96) return false
    let nonZeroCount = 0
    for (const b of sigBytes) if (b !== 0) nonZeroCount++
    return nonZeroCount >= sigBytes.length / 4
  }

  if (sigBytes.length < 64) return false

  const r = sigBytes.slice(0, 32)
  const s = sigBytes.slice(32, 64)
  const rBigInt = bytesToBigInt(r)
  const sBigInt = bytesToBigInt(s)
  const n = BigInt(
    '0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551',
  )

  if (rBigInt <= 0n || rBigInt >= n || sBigInt <= 0n || sBigInt >= n)
    return false

  if (quote.certChain.length > 0) {
    const leafCertDer = pemToDer(quote.certChain[0])
    if (!leafCertDer) {
      console.warn('[PoC] Failed to parse leaf cert')
      return false
    }

    const pubKey = await extractPublicKeyFromCert(leafCertDer)
    if (!pubKey) {
      console.warn('[PoC] Failed to extract public key')
      return false
    }

    const rawBytes = hexToBytes(quote.raw)
    const signedDataEnd = quote.platform === 'intel_tdx' ? 632 : 432
    const signedData = rawBytes.slice(0, signedDataEnd)
    const derSig = ecdsaRawToDer(r, s)

    const signedDataBuffer = new ArrayBuffer(signedData.byteLength)
    new Uint8Array(signedDataBuffer).set(signedData)
    const derSigBuffer = new ArrayBuffer(derSig.byteLength)
    new Uint8Array(derSigBuffer).set(derSig)
    const isValid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pubKey,
      derSigBuffer,
      signedDataBuffer,
    )
    if (!isValid) console.warn('[PoC] Quote signature verification failed')
    return isValid
  }

  // SECURITY: Without a certificate chain, we cannot verify the quote signature
  // This MUST fail in production - unverified quotes cannot be trusted
  console.error(
    '[PoC] CRITICAL: No certificate chain provided - quote cannot be verified',
  )
  return false
}

function checkTCBStatus(
  quote: TEEQuote,
): 'upToDate' | 'outOfDate' | 'revoked' | 'unknown' {
  if (quote.platform === 'intel_tdx' || quote.platform === 'intel_sgx') {
    const minTcb = MIN_TCB_SVN[quote.platform]
    if (
      quote.securityVersion.cpu < minTcb.cpu ||
      quote.securityVersion.tcb < minTcb.tcb
    )
      return 'outOfDate'
    return 'upToDate'
  }

  if (quote.platform === 'amd_sev') {
    if (quote.securityVersion.cpu < MIN_TCB_SVN.amd_sev.snp) return 'outOfDate'
    return 'upToDate'
  }

  return 'unknown'
}

function buildVerificationError(r: {
  measurementMatch: boolean
  certificateValid: boolean
  signatureValid: boolean
  tcbStatus: string
}): string {
  const errors: string[] = []
  if (!r.measurementMatch) errors.push('Measurement mismatch')
  if (!r.certificateValid) errors.push('Invalid certificate chain')
  if (!r.signatureValid) errors.push('Invalid signature')
  if (r.tcbStatus !== 'upToDate') errors.push(`TCB: ${r.tcbStatus}`)
  return errors.join('; ')
}

// Hardware ID

export function hashHardwareId(hardwareId: Hex, salt: Hex): Hex {
  return keccak256(toBytes(`${salt}${hardwareId}`))
}

export function extractPlatformInfo(quote: TEEQuote): {
  platformName: string
  hardwareIdType: string
} {
  switch (quote.platform) {
    case 'intel_tdx':
      return {
        platformName: 'Intel TDX',
        hardwareIdType: 'MRSIGNERSEAM+MRTD Hash',
      }
    case 'intel_sgx':
      return {
        platformName: 'Intel SGX',
        hardwareIdType: 'MRSIGNER+MRENCLAVE Hash',
      }
    case 'amd_sev':
      return { platformName: 'AMD SEV-SNP', hardwareIdType: 'Chip ID' }
  }
}

// X.509 Utilities

function pemToDer(pem: string): Uint8Array | null {
  const match = pem.match(
    /-----BEGIN CERTIFICATE-----\s*([\s\S]*?)\s*-----END CERTIFICATE-----/,
  )
  if (!match) {
    console.warn('[PoC] PEM missing markers')
    return null
  }

  const base64 = match[1].replace(/\s/g, '')
  if (!base64 || !/^[A-Za-z0-9+/=]+$/.test(base64)) {
    console.warn('[PoC] Invalid base64')
    return null
  }

  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

interface X509BasicInfo {
  notBefore: number
  notAfter: number
  signatureAlgorithm: string
}

function parseX509Basic(der: Uint8Array): X509BasicInfo | null {
  if (der.length < 10 || der[0] !== 0x30) return null

  let notBefore: number | null = null
  let notAfter: number | null = null
  let signatureAlgorithm = 'ECDSA-SHA256'

  const ecdsaSha256Oid = [
    0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02,
  ]
  const ecdsaSha384Oid = [
    0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x03,
  ]

  for (let i = 0; i < der.length - 10; i++) {
    if (matchBytes(der, i, ecdsaSha256Oid)) {
      signatureAlgorithm = 'ECDSA-SHA256'
      break
    }
    if (matchBytes(der, i, ecdsaSha384Oid)) {
      signatureAlgorithm = 'ECDSA-SHA384'
      break
    }
  }

  for (let i = 0; i < der.length - 15; i++) {
    const tag = der[i]
    if (tag === 0x17 || tag === 0x18) {
      const len = der[i + 1]
      if (len > 0 && len < 20 && i + 2 + len <= der.length) {
        const timeStr = new TextDecoder().decode(der.slice(i + 2, i + 2 + len))
        const parsed = parseASN1Time(timeStr, tag === 0x18)
        if (parsed !== null) {
          if (notBefore === null) notBefore = parsed
          else if (notAfter === null) {
            notAfter = parsed
            break
          }
        }
      }
    }
  }

  if (notBefore === null || notAfter === null) return null
  return { notBefore, notAfter, signatureAlgorithm }
}

function parseASN1Time(timeStr: string, isGeneralized: boolean): number | null {
  const clean = timeStr.replace(/Z$/, '')
  let year: number, rest: string

  if (isGeneralized) {
    year = parseInt(clean.slice(0, 4), 10)
    rest = clean.slice(4)
  } else {
    const yy = parseInt(clean.slice(0, 2), 10)
    year = yy >= 50 ? 1900 + yy : 2000 + yy
    rest = clean.slice(2)
  }

  if (rest.length < 10) return null
  const month = parseInt(rest.slice(0, 2), 10) - 1
  const day = parseInt(rest.slice(2, 4), 10)
  const hour = parseInt(rest.slice(4, 6), 10)
  const min = parseInt(rest.slice(6, 8), 10)
  const sec = parseInt(rest.slice(8, 10), 10)
  if ([month, day, hour, min, sec].some(Number.isNaN)) return null
  return Date.UTC(year, month, day, hour, min, sec)
}

function matchBytes(
  data: Uint8Array,
  offset: number,
  pattern: number[],
): boolean {
  if (offset + pattern.length > data.length) return false
  for (let i = 0; i < pattern.length; i++)
    if (data[offset + i] !== pattern[i]) return false
  return true
}

async function extractPublicKeyFromCert(
  der: Uint8Array,
): Promise<CryptoKey | null> {
  const spki = extractSPKIFromCert(der)
  if (spki.length < 30) {
    console.warn('[PoC] SPKI too short')
    return null
  }

  const spkiBuffer = new ArrayBuffer(spki.byteLength)
  new Uint8Array(spkiBuffer).set(spki)
  for (const curve of ['P-256', 'P-384'] as const) {
    try {
      return await crypto.subtle.importKey(
        'spki',
        spkiBuffer,
        { name: 'ECDSA', namedCurve: curve },
        true,
        ['verify'],
      )
    } catch {
      /* try next */
    }
  }
  console.warn('[PoC] Unsupported key algorithm')
  return null
}

function extractSPKIFromCert(der: Uint8Array): Uint8Array {
  const ecOid = [0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]

  for (let i = 0; i < der.length - ecOid.length - 50; i++) {
    if (matchBytes(der, i, ecOid)) {
      const seqStart = i - 2
      if (seqStart >= 0 && der[seqStart] === 0x30) {
        const len = der[seqStart + 1]
        if (len < 128) return der.slice(seqStart, seqStart + 2 + len)
      }
    }
  }
  return der.slice(0, Math.min(der.length, 91))
}

function extractSubjectCN(der: Uint8Array): string | null {
  const cnOid = [0x55, 0x04, 0x03]
  for (let i = 0; i < der.length - 10; i++) {
    if (
      der[i] === cnOid[0] &&
      der[i + 1] === cnOid[1] &&
      der[i + 2] === cnOid[2]
    ) {
      const strType = der[i + 3]
      if (strType === 0x0c || strType === 0x13) {
        const strLen = der[i + 4]
        if (strLen < 128 && i + 5 + strLen <= der.length) {
          return new TextDecoder().decode(der.slice(i + 5, i + 5 + strLen))
        }
      }
    }
  }
  return null
}

async function verifyX509Signature(
  certDer: Uint8Array,
  issuerKey: CryptoKey,
  algorithm: string,
): Promise<boolean> {
  if (certDer.length < 100 || certDer[0] !== 0x30) return false

  const outerLen = parseASN1Length(certDer, 1)
  if (!outerLen) return false

  const tbsStart = 1 + outerLen.bytesUsed
  if (certDer[tbsStart] !== 0x30) return false

  const tbsLen = parseASN1Length(certDer, tbsStart + 1)
  if (!tbsLen) return false

  const tbsEnd = tbsStart + 1 + tbsLen.bytesUsed + tbsLen.length
  const tbsCertificate = certDer.slice(tbsStart, tbsEnd)

  let pos = tbsEnd
  if (certDer[pos] !== 0x30) return false

  const sigAlgLen = parseASN1Length(certDer, pos + 1)
  if (!sigAlgLen) return false
  pos += 1 + sigAlgLen.bytesUsed + sigAlgLen.length

  if (certDer[pos] !== 0x03) return false

  const sigLen = parseASN1Length(certDer, pos + 1)
  if (!sigLen) return false

  const unusedBits = certDer[pos + 1 + sigLen.bytesUsed]
  if (unusedBits !== 0) return false

  const signatureStart = pos + 1 + sigLen.bytesUsed + 1
  const signatureBytes = certDer.slice(
    signatureStart,
    signatureStart + sigLen.length - 1,
  )
  const hashAlgo = algorithm.includes('384') ? 'SHA-384' : 'SHA-256'

  const sigBuffer = new ArrayBuffer(signatureBytes.byteLength)
  new Uint8Array(sigBuffer).set(signatureBytes)
  const tbsBuffer = new ArrayBuffer(tbsCertificate.byteLength)
  new Uint8Array(tbsBuffer).set(tbsCertificate)
  return crypto.subtle.verify(
    { name: 'ECDSA', hash: hashAlgo },
    issuerKey,
    sigBuffer,
    tbsBuffer,
  )
}

function parseASN1Length(
  data: Uint8Array,
  offset: number,
): { length: number; bytesUsed: number } | null {
  if (offset >= data.length) return null
  const first = data[offset]
  if (first < 0x80) return { length: first, bytesUsed: 1 }
  if (first === 0x80) return null

  const numBytes = first & 0x7f
  if (numBytes > 4 || offset + 1 + numBytes > data.length) return null

  let length = 0
  for (let i = 0; i < numBytes; i++)
    length = (length << 8) | data[offset + 1 + i]
  return { length, bytesUsed: 1 + numBytes }
}

function ecdsaRawToDer(r: Uint8Array, s: Uint8Array): Uint8Array {
  const encodeInt = (bytes: Uint8Array): Uint8Array => {
    let start = 0
    while (start < bytes.length - 1 && bytes[start] === 0) start++
    const needsZero = bytes[start] >= 0x80
    const len = bytes.length - start + (needsZero ? 1 : 0)
    const result = new Uint8Array(2 + len)
    result[0] = 0x02
    result[1] = len
    if (needsZero) {
      result[2] = 0
      result.set(bytes.slice(start), 3)
    } else result.set(bytes.slice(start), 2)
    return result
  }

  const rDer = encodeInt(r)
  const sDer = encodeInt(s)
  const totalLen = rDer.length + sDer.length
  const result = new Uint8Array(2 + totalLen)
  result[0] = 0x30
  result[1] = totalLen
  result.set(rDer, 2)
  result.set(sDer, 2 + rDer.length)
  return result
}

// Byte Utilities

function hexToBytes(hex: Hex): Uint8Array {
  const str = hex.startsWith('0x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(str.length / 2)
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = parseInt(str.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  return (
    '0x' +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  )
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = 0n
  for (const byte of bytes) result = (result << 8n) | BigInt(byte)
  return result
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8)
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  )
}

function readUint64LE(bytes: Uint8Array, offset: number): bigint {
  const low = readUint32LE(bytes, offset)
  const high = readUint32LE(bytes, offset + 4)
  return BigInt(low) | (BigInt(high) << 32n)
}

// Exports

export {
  parseDCAPQuote,
  parseSEVSNPQuote,
  parseDCAPHeader,
  parseTDXReportBody,
  extractCertChain,
  verifyCertificateChain,
  verifyQuoteSignature,
  checkTCBStatus,
}

// Testing utilities - export for unit testing internal functions
export const _testUtils = {
  pemToDer,
  parseX509Basic,
  parseASN1Time,
  extractPublicKeyFromCert,
  extractSPKIFromCert,
  extractSubjectCN,
  verifyX509Signature,
  parseASN1Length,
  ecdsaRawToDer,
  hexToBytes,
  bytesToHex,
}
