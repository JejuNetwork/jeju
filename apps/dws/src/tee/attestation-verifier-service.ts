import {
  type Address,
  encodePacked,
  getContract,
  keccak256,
  type PublicClient,
  toHex,
  type WalletClient,
} from 'viem'

// DStack integration types (from vendor/babylon)
interface DStackVerificationResult {
  valid: boolean
  tcbValid?: boolean
  reason?: string
}

interface DStackClient {
  verifyAttestation(params: {
    quote: string
    mode: string
  }): Promise<DStackVerificationResult>
}

// TDX Quote parsing offsets (Intel TDX Quote structure)
const TDX_QUOTE_OFFSETS = {
  VERSION: 0,
  AK_TYPE: 2,
  TEE_TCB_SVN: 4,
  MR_ENCLAVE: 20,
  MR_SIGNER: 52,
  ATTRIBUTES: 84,
  REPORT_DATA: 100,
  MIN_QUOTE_LENGTH: 164,
} as const

// Attestation result structure
export interface AttestationResult {
  quoteHash: `0x${string}`
  mrEnclave: `0x${string}`
  mrSigner: `0x${string}`
  reportData: `0x${string}`
  isValid: boolean
  timestamp: number
  verificationDetails: {
    signatureValid: boolean
    measurementsTrusted: boolean
    reportDataMatches: boolean
    tcbValid: boolean
  }
}

export interface TrustedMeasurement {
  hash: `0x${string}`
  type: 'enclave' | 'signer'
  description: string
  addedAt: number
}

export interface VerificationRequest {
  quote: Uint8Array
  expectedReportData: `0x${string}`
  nodeAddress: Address
  requestId: string
}

// Contract ABI for TDXAttestationVerifier
const TDX_ATTESTATION_VERIFIER_ABI = [
  {
    inputs: [
      { internalType: 'bytes32', name: 'mrEnclaveHash', type: 'bytes32' },
    ],
    name: 'addTrustedMrEnclave',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'bytes32', name: 'mrSignerHash', type: 'bytes32' },
    ],
    name: 'addTrustedMrSigner',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'bytes32', name: 'mrEnclaveHash', type: 'bytes32' },
    ],
    name: 'removeTrustedMrEnclave',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'bytes32', name: 'mrSignerHash', type: 'bytes32' },
    ],
    name: 'removeTrustedMrSigner',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'bytes', name: 'quote', type: 'bytes' },
      { internalType: 'bytes32', name: 'expectedReportData', type: 'bytes32' },
    ],
    name: 'verifyTDXQuote',
    outputs: [{ internalType: 'bool', name: 'valid', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'bytes32', name: 'quoteHash', type: 'bytes32' },
      { internalType: 'bytes32', name: 'mrEnclave', type: 'bytes32' },
      { internalType: 'bytes32', name: 'mrSigner', type: 'bytes32' },
      { internalType: 'bytes32', name: 'reportData', type: 'bytes32' },
      { internalType: 'bool', name: 'isValid', type: 'bool' },
    ],
    name: 'recordTDXVerificationResult',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'bytes32', name: '', type: 'bytes32' }],
    name: 'trustedMrEnclaves',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'bytes32', name: '', type: 'bytes32' }],
    name: 'trustedMrSigners',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

export interface AttestationVerifierServiceConfig {
  contractAddress: Address
  publicClient: PublicClient
  walletClient: WalletClient
  dstackClient?: DStackClient
  cacheResults?: boolean
}

/**
 * Off-chain attestation verification service that:
 * 1. Receives TDX attestation quotes from nodes
 * 2. Performs full cryptographic verification using dstack/DCAP
 * 3. Submits verification results to the on-chain contract
 */
export class AttestationVerifierService {
  private config: AttestationVerifierServiceConfig
  private contract
  private dstackClient: DStackClient | null = null
  private verificationCache: Map<string, AttestationResult> = new Map()
  private pendingVerifications: Map<string, Promise<AttestationResult>> =
    new Map()

  constructor(config: AttestationVerifierServiceConfig) {
    this.config = config
    this.contract = getContract({
      address: config.contractAddress,
      abi: TDX_ATTESTATION_VERIFIER_ABI,
      client: {
        public: config.publicClient,
        wallet: config.walletClient,
      },
    })
    this.dstackClient = config.dstackClient ?? null
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    console.log('[AttestationVerifier] Initialized', {
      hasDstack: !!this.dstackClient,
    })
  }

  /**
   * Parse a TDX quote to extract key fields
   */
  parseQuote(quote: Uint8Array): {
    version: number
    mrEnclave: `0x${string}`
    mrSigner: `0x${string}`
    reportData: `0x${string}`
  } {
    if (quote.length < TDX_QUOTE_OFFSETS.MIN_QUOTE_LENGTH) {
      throw new Error(
        `Quote too short: ${quote.length} < ${TDX_QUOTE_OFFSETS.MIN_QUOTE_LENGTH}`,
      )
    }

    // Read version (2 bytes, big endian)
    const version = (quote[0] << 8) | quote[1]

    // Read MR_ENCLAVE (32 bytes at offset 20)
    const mrEnclave = toHex(
      quote.slice(
        TDX_QUOTE_OFFSETS.MR_ENCLAVE,
        TDX_QUOTE_OFFSETS.MR_ENCLAVE + 32,
      ),
    ) as `0x${string}`

    // Read MR_SIGNER (32 bytes at offset 52)
    const mrSigner = toHex(
      quote.slice(
        TDX_QUOTE_OFFSETS.MR_SIGNER,
        TDX_QUOTE_OFFSETS.MR_SIGNER + 32,
      ),
    ) as `0x${string}`

    // Read REPORT_DATA_0 (first 32 bytes of 64-byte report data)
    const reportData = toHex(
      quote.slice(
        TDX_QUOTE_OFFSETS.REPORT_DATA,
        TDX_QUOTE_OFFSETS.REPORT_DATA + 32,
      ),
    ) as `0x${string}`

    return {
      version,
      mrEnclave,
      mrSigner,
      reportData,
    }
  }

  /**
   * Verify a TDX attestation quote
   */
  async verifyQuote(request: VerificationRequest): Promise<AttestationResult> {
    const { quote, expectedReportData, nodeAddress, requestId } = request

    // Check cache first
    const cacheKey = keccak256(
      encodePacked(['bytes', 'bytes32'], [toHex(quote), expectedReportData]),
    )

    if (this.config.cacheResults) {
      const cachedResult = this.verificationCache.get(cacheKey)
      if (cachedResult) return cachedResult
    }

    // Check for pending verification
    const pendingVerification = this.pendingVerifications.get(cacheKey)
    if (pendingVerification) {
      return pendingVerification
    }

    const verificationPromise = this._performVerification(
      quote,
      expectedReportData,
      nodeAddress,
      requestId,
    )
    this.pendingVerifications.set(cacheKey, verificationPromise)

    const result = await verificationPromise
    this.pendingVerifications.delete(cacheKey)

    if (this.config.cacheResults) {
      this.verificationCache.set(cacheKey, result)
    }

    return result
  }

  private async _performVerification(
    quote: Uint8Array,
    expectedReportData: `0x${string}`,
    _nodeAddress: Address,
    requestId: string,
  ): Promise<AttestationResult> {
    console.log(
      `[AttestationVerifier] Starting verification for request ${requestId}`,
    )

    // Parse quote
    const parsed = this.parseQuote(quote)
    const quoteHash = keccak256(toHex(quote)) as `0x${string}`

    // Initialize verification details
    const verificationDetails = {
      signatureValid: false,
      measurementsTrusted: false,
      reportDataMatches: false,
      tcbValid: false,
    }

    // Step 1: Verify signature using dstack
    if (this.dstackClient) {
      const dstackResult = await this.dstackClient.verifyAttestation({
        quote: toHex(quote),
        mode: 'tdx',
      })

      verificationDetails.signatureValid = dstackResult.valid
      verificationDetails.tcbValid = dstackResult.tcbValid ?? false

      if (!dstackResult.valid) {
        console.log(
          `[AttestationVerifier] dstack verification failed: ${dstackResult.reason}`,
        )
      }
    } else {
      // SECURITY: Without dstack, we cannot verify the attestation
      const isProduction = process.env.NODE_ENV === 'production'
      if (isProduction) {
        console.error(
          '[AttestationVerifier] CRITICAL: dstack client required in production for attestation verification',
        )
        verificationDetails.signatureValid = false
        verificationDetails.tcbValid = false
      } else {
        // Development only - skip verification with warning
        verificationDetails.signatureValid = true
        verificationDetails.tcbValid = true
        console.warn(
          '[AttestationVerifier] WARNING: Running without dstack - signature verification skipped (dev mode only)',
        )
      }
    }

    // Step 2: Check measurements against on-chain trusted list
    const [mrEnclaveTrusted, mrSignerTrusted] = await Promise.all([
      this.contract.read.trustedMrEnclaves([parsed.mrEnclave]),
      this.contract.read.trustedMrSigners([parsed.mrSigner]),
    ])

    verificationDetails.measurementsTrusted =
      mrEnclaveTrusted && mrSignerTrusted

    if (!mrEnclaveTrusted) {
      console.log(
        `[AttestationVerifier] MR_ENCLAVE not trusted: ${parsed.mrEnclave}`,
      )
    }
    if (!mrSignerTrusted) {
      console.log(
        `[AttestationVerifier] MR_SIGNER not trusted: ${parsed.mrSigner}`,
      )
    }

    // Step 3: Verify report data matches expected
    verificationDetails.reportDataMatches =
      parsed.reportData === expectedReportData

    if (!verificationDetails.reportDataMatches) {
      console.log(
        `[AttestationVerifier] Report data mismatch: ${parsed.reportData} != ${expectedReportData}`,
      )
    }

    // Final result
    const isValid =
      verificationDetails.signatureValid &&
      verificationDetails.measurementsTrusted &&
      verificationDetails.reportDataMatches &&
      verificationDetails.tcbValid

    const result: AttestationResult = {
      quoteHash,
      mrEnclave: parsed.mrEnclave,
      mrSigner: parsed.mrSigner,
      reportData: parsed.reportData,
      isValid,
      timestamp: Date.now(),
      verificationDetails,
    }

    console.log(
      `[AttestationVerifier] Verification complete for ${requestId}: ${isValid ? 'VALID' : 'INVALID'}`,
    )

    return result
  }

  /**
   * Submit verification result to the on-chain contract
   */
  async submitVerificationResult(
    result: AttestationResult,
  ): Promise<`0x${string}`> {
    const walletClient = this.config.walletClient
    const [account] = await walletClient.getAddresses()

    const txHash = await walletClient.writeContract({
      address: this.config.contractAddress,
      abi: TDX_ATTESTATION_VERIFIER_ABI,
      functionName: 'recordTDXVerificationResult',
      args: [
        result.quoteHash,
        result.mrEnclave,
        result.mrSigner,
        result.reportData,
        result.isValid,
      ],
      account,
    })

    console.log(
      `[AttestationVerifier] Submitted verification result: ${txHash}`,
    )
    return txHash
  }

  /**
   * Verify and submit in one operation
   */
  async verifyAndSubmit(request: VerificationRequest): Promise<{
    result: AttestationResult
    txHash: `0x${string}`
  }> {
    const result = await this.verifyQuote(request)
    const txHash = await this.submitVerificationResult(result)
    return { result, txHash }
  }

  // ============================================================================
  // Admin Functions
  // ============================================================================

  /**
   * Add a trusted MR_ENCLAVE measurement
   */
  async addTrustedMrEnclave(
    mrEnclaveHash: `0x${string}`,
  ): Promise<`0x${string}`> {
    const [account] = await this.config.walletClient.getAddresses()

    return this.config.walletClient.writeContract({
      address: this.config.contractAddress,
      abi: TDX_ATTESTATION_VERIFIER_ABI,
      functionName: 'addTrustedMrEnclave',
      args: [mrEnclaveHash],
      account,
    })
  }

  /**
   * Add a trusted MR_SIGNER measurement
   */
  async addTrustedMrSigner(
    mrSignerHash: `0x${string}`,
  ): Promise<`0x${string}`> {
    const [account] = await this.config.walletClient.getAddresses()

    return this.config.walletClient.writeContract({
      address: this.config.contractAddress,
      abi: TDX_ATTESTATION_VERIFIER_ABI,
      functionName: 'addTrustedMrSigner',
      args: [mrSignerHash],
      account,
    })
  }

  /**
   * Remove a trusted MR_ENCLAVE measurement
   */
  async removeTrustedMrEnclave(
    mrEnclaveHash: `0x${string}`,
  ): Promise<`0x${string}`> {
    const [account] = await this.config.walletClient.getAddresses()

    return this.config.walletClient.writeContract({
      address: this.config.contractAddress,
      abi: TDX_ATTESTATION_VERIFIER_ABI,
      functionName: 'removeTrustedMrEnclave',
      args: [mrEnclaveHash],
      account,
    })
  }

  /**
   * Remove a trusted MR_SIGNER measurement
   */
  async removeTrustedMrSigner(
    mrSignerHash: `0x${string}`,
  ): Promise<`0x${string}`> {
    const [account] = await this.config.walletClient.getAddresses()

    return this.config.walletClient.writeContract({
      address: this.config.contractAddress,
      abi: TDX_ATTESTATION_VERIFIER_ABI,
      functionName: 'removeTrustedMrSigner',
      args: [mrSignerHash],
      account,
    })
  }

  // ============================================================================
  // Read Functions
  // ============================================================================

  /**
   * Check if an MR_ENCLAVE is trusted
   */
  async isMrEnclaveTrusted(mrEnclaveHash: `0x${string}`): Promise<boolean> {
    return this.contract.read.trustedMrEnclaves([mrEnclaveHash])
  }

  /**
   * Check if an MR_SIGNER is trusted
   */
  async isMrSignerTrusted(mrSignerHash: `0x${string}`): Promise<boolean> {
    return this.contract.read.trustedMrSigners([mrSignerHash])
  }

  /**
   * Perform on-chain verification (measurements + report data only)
   */
  async verifyOnChain(
    quote: Uint8Array,
    expectedReportData: `0x${string}`,
  ): Promise<boolean> {
    return this.contract.read.verifyTDXQuote([toHex(quote), expectedReportData])
  }

  /**
   * Clear the verification cache
   */
  clearCache(): void {
    this.verificationCache.clear()
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; hits: number } {
    return {
      size: this.verificationCache.size,
      hits: 0, // Would need to track this separately
    }
  }
}

/**
 * Factory function to create an AttestationVerifierService
 */
export function createAttestationVerifierService(
  config: AttestationVerifierServiceConfig,
): AttestationVerifierService {
  return new AttestationVerifierService(config)
}

/**
 * Generate report data hash for binding attestation to a specific request
 * This is what goes into the REPORT_DATA field of the TDX quote
 */
export function generateReportData(params: {
  nodeAddress: Address
  nonce: `0x${string}`
  timestamp: number
}): `0x${string}` {
  return keccak256(
    encodePacked(
      ['address', 'bytes32', 'uint256'],
      [params.nodeAddress, params.nonce, BigInt(params.timestamp)],
    ),
  ) as `0x${string}`
}

/**
 * Generate a random nonce for attestation requests
 */
export function generateNonce(): `0x${string}` {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return toHex(bytes) as `0x${string}`
}
