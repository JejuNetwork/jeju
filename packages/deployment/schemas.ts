/**
 * Deployment Schemas
 *
 * Zod schemas for validating JSON configuration files used in deployment scripts.
 * These schemas provide fail-fast validation to catch configuration errors early.
 */

import type { Abi } from 'viem'
import { z } from 'zod'

// Address Schemas

/**
 * Ethereum Address Schema - validates 0x-prefixed 40-character hex strings
 */
export const AddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address')

/**
 * Optional address - allows empty strings for undeployed contracts
 */
export const OptionalAddressSchema = z
  .string()
  .refine((val) => val === '' || /^0x[a-fA-F0-9]{40}$/.test(val), {
    message: 'Must be empty or valid Ethereum address',
  })

/**
 * Hex bytes32 - validates 0x-prefixed 64-character hex strings
 */
export const Bytes32Schema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid bytes32')

/**
 * Private key schema - 0x-prefixed 64-character hex string
 */
export const PrivateKeySchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid private key')

// Operator Key Schemas

/**
 * Single operator key entry
 */
export const OperatorKeySchema = z.object({
  name: z.string(),
  address: AddressSchema,
  privateKey: PrivateKeySchema,
})
export type OperatorKey = z.infer<typeof OperatorKeySchema>

/**
 * Array of operator keys (used in testnet-operators.json)
 */
export const OperatorKeysArraySchema = z.array(OperatorKeySchema)
export type OperatorKeysArray = z.infer<typeof OperatorKeysArraySchema>

// Deploy Config Schemas

/**
 * Deploy config (testnet.json in deploy-config)
 */
export const DeployConfigSchema = z
  .object({
    p2pSequencerAddress: AddressSchema,
    l1ChainID: z.number().optional(),
    l2ChainID: z.number().optional(),
    baseFeeVaultRecipient: AddressSchema.optional(),
    l1FeeVaultRecipient: AddressSchema.optional(),
    sequencerFeeVaultRecipient: AddressSchema.optional(),
    finalSystemOwner: AddressSchema.optional(),
    batcherHash: z.string().optional(),
  })
  .passthrough()
export type DeployConfig = z.infer<typeof DeployConfigSchema>

// Deployment State Schemas

/**
 * op-deployer deployment entry
 */
export const OpDeployerDeploymentSchema = z
  .object({
    address: z.string().optional(),
    bytecode: z.string().optional(),
    tx: z.string().optional(),
    blockNumber: z.number().optional(),
    timestamp: z.number().optional(),
  })
  .passthrough()
export type OpDeployerDeployment = z.infer<typeof OpDeployerDeploymentSchema>

/**
 * op-deployer state.json output
 */
export const OpDeployerStateSchema = z
  .object({
    addresses: z.record(z.string(), z.string()).optional(),
    deployments: z.record(z.string(), OpDeployerDeploymentSchema).optional(),
  })
  .passthrough()
export type OpDeployerState = z.infer<typeof OpDeployerStateSchema>

// DWS Contract Address Schemas

/**
 * DWS addresses file (addresses.json)
 */
export const DwsAddressesSchema = z.object({
  identityRegistry: AddressSchema,
  repoRegistry: AddressSchema,
  packageRegistry: AddressSchema,
  containerRegistry: AddressSchema,
  modelRegistry: AddressSchema,
  jnsRegistry: AddressSchema,
  jnsRegistrar: AddressSchema,
  storageManager: AddressSchema,
})
export type DwsAddresses = z.infer<typeof DwsAddressesSchema>

/**
 * DWS deployment file (deployment.json)
 */
export const DwsDeploymentSchema = z.object({
  contracts: z.object({
    identityRegistry: z.object({ address: AddressSchema }),
    repoRegistry: z.object({ address: AddressSchema }),
    packageRegistry: z.object({ address: AddressSchema }),
    containerRegistry: z.object({ address: AddressSchema }),
    modelRegistry: z.object({ address: AddressSchema }),
    jnsRegistry: z.object({ address: AddressSchema }),
    jnsRegistrar: z.object({ address: AddressSchema }),
    storageManager: z.object({ address: AddressSchema }),
  }),
})
export type DwsDeployment = z.infer<typeof DwsDeploymentSchema>

// Manifest Schemas

/**
 * Jeju manifest (jeju-manifest.json)
 */
export const JejuManifestSchema = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    tags: z.array(z.string()).default([]),
    jns: z
      .object({
        name: z.string(),
      })
      .optional(),
    decentralization: z
      .object({
        frontend: z
          .object({
            buildDir: z.string().optional(),
          })
          .optional(),
      })
      .optional(),
  })
  .passthrough()
export type JejuManifest = z.infer<typeof JejuManifestSchema>

// Package.json Schema (minimal for deployment)

/**
 * Minimal package.json schema for deployment scripts
 */
export const PackageJsonSchema = z
  .object({
    name: z.string().optional(),
    version: z.string().optional(),
    private: z.boolean().optional(),
    dependencies: z.record(z.string(), z.string()).optional(),
  })
  .passthrough()
export type PackageJson = z.infer<typeof PackageJsonSchema>

// Governance Address Schema

/**
 * Deployed governance addresses (network addresses file)
 */
export const GovernanceAddressesSchema = z
  .object({
    governanceToken: z.string().optional(),
    identityRegistry: z.string().optional(),
    reputationRegistry: z.string().optional(),
    council: z.string().optional(),
    delegationRegistry: z.string().optional(),
    circuitBreaker: z.string().optional(),
    councilSafeModule: z.string().optional(),
    safe: z.string().optional(),
  })
  .passthrough()
export type GovernanceAddresses = z.infer<typeof GovernanceAddressesSchema>

// Forge Artifact Schema

/**
 * ABI parameter schema (for function/event inputs/outputs)
 */
interface AbiParameterBase {
  name: string
  type: string
  indexed?: boolean
  internalType?: string
  components?: AbiParameterBase[]
}

export const AbiParameterSchema: z.ZodType<AbiParameterBase> = z.object({
  name: z.string(),
  type: z.string(),
  indexed: z.boolean().optional(),
  internalType: z.string().optional(),
  components: z.array(z.lazy(() => AbiParameterSchema)).optional(),
})
export type AbiParameter = z.infer<typeof AbiParameterSchema>

/**
 * ABI item schema (function, event, error, constructor, receive, fallback)
 */
export const AbiItemSchema = z
  .object({
    type: z.enum([
      'function',
      'event',
      'error',
      'constructor',
      'receive',
      'fallback',
    ]),
    name: z.string().optional(),
    inputs: z.array(AbiParameterSchema).optional(),
    outputs: z.array(AbiParameterSchema).optional(),
    stateMutability: z
      .enum(['pure', 'view', 'nonpayable', 'payable'])
      .optional(),
    anonymous: z.boolean().optional(),
  })
  .passthrough()
export type AbiItem = z.infer<typeof AbiItemSchema>

/**
 * Forge compiled artifact (*.json from out/)
 */
export const ForgeArtifactSchema = z
  .object({
    bytecode: z.object({
      object: z.string(),
    }),
    abi: z.array(AbiItemSchema).optional(),
    methodIdentifiers: z.record(z.string(), z.string()).optional(),
  })
  .passthrough()
export type ForgeArtifact = z.infer<typeof ForgeArtifactSchema>

// Payment Header Schema (x402)

/**
 * x402 payment payload from header
 */
export const PaymentPayloadSchema = z.object({
  scheme: z.string(),
  network: z.string(),
  asset: AddressSchema,
  payTo: AddressSchema,
  amount: z.string(),
  resource: z.string(),
  nonce: z.string(),
  timestamp: z.number(),
  signature: z.string().optional(),
})
export type PaymentPayload = z.infer<typeof PaymentPayloadSchema>

// Config Validation Schemas

/**
 * Chain config for validation
 */
export const ChainConfigValidationSchema = z
  .object({
    chainId: z.number(),
    name: z.string(),
    rpcUrl: z.string().refine((url) => url.startsWith('http'), {
      message: 'rpcUrl must start with http',
    }),
    l1ChainId: z.number(),
    networkId: z.number().optional(),
    wsUrl: z.string().optional(),
    explorerUrl: z.string().optional(),
    l1RpcUrl: z.string().optional(),
    l1Name: z.string().optional(),
    flashblocksEnabled: z.boolean().optional(),
    flashblocksSubBlockTime: z.number().optional(),
    blockTime: z.number().optional(),
    gasToken: z
      .object({
        name: z.string(),
        symbol: z.string(),
        decimals: z.number(),
      })
      .optional(),
    contracts: z
      .object({
        l2: z.record(z.string(), z.string()).optional(),
        l1: z.record(z.string(), z.string()).optional(),
      })
      .optional(),
  })
  .passthrough()
export type ChainConfigValidation = z.infer<typeof ChainConfigValidationSchema>

/**
 * Contracts config for validation
 */
export const ContractsConfigValidationSchema = z
  .object({
    version: z.string(),
    localnet: z.object({ chainId: z.number() }).passthrough(),
    testnet: z.object({ chainId: z.number() }).passthrough(),
    mainnet: z.object({ chainId: z.number() }).passthrough(),
  })
  .passthrough()
export type ContractsConfigValidation = z.infer<
  typeof ContractsConfigValidationSchema
>

/**
 * RPC config schema
 */
export const RpcConfigSchema = z.object({
  l1: z.string(),
  l2: z.string(),
  ws: z.string().optional(),
})
export type RpcConfig = z.infer<typeof RpcConfigSchema>

/**
 * Services config for validation
 */
export const ServicesConfigValidationSchema = z
  .object({
    localnet: z.object({ rpc: RpcConfigSchema }).passthrough(),
    testnet: z.object({ rpc: RpcConfigSchema }).passthrough(),
    mainnet: z.object({ rpc: RpcConfigSchema }).passthrough(),
  })
  .passthrough()
export type ServicesConfigValidation = z.infer<
  typeof ServicesConfigValidationSchema
>

/**
 * Token config entry schema
 */
export const TokenConfigEntrySchema = z
  .object({
    name: z.string(),
    symbol: z.string(),
    decimals: z.number().int().min(0).max(18),
    address: z.string().optional(),
    isNative: z.boolean().optional(),
    isPreferred: z.boolean().optional(),
    logoUrl: z.string().optional(),
    priceUSD: z.number().optional(),
    hasPaymaster: z.boolean().optional(),
    hasBanEnforcement: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
    addresses: z.record(z.string(), z.string()).optional(),
  })
  .passthrough()
export type TokenConfigEntry = z.infer<typeof TokenConfigEntrySchema>

/**
 * Tokens config for validation
 */
export const TokensConfigValidationSchema = z
  .object({
    version: z.string(),
    tokens: z.record(z.string(), TokenConfigEntrySchema).optional(),
  })
  .passthrough()
export type TokensConfigValidation = z.infer<
  typeof TokensConfigValidationSchema
>

/**
 * EIL chain config entry schema
 */
export const EILChainConfigEntrySchema = z
  .object({
    chainId: z.number().int().positive(),
    name: z.string(),
    rpcUrl: z.string(),
    crossChainPaymaster: z.string().optional(),
    l1StakeManager: z.string().optional(),
    status: z.enum(['active', 'inactive', 'pending']).optional(),
    tokens: z.record(z.string(), z.string()).optional(),
  })
  .passthrough()
export type EILChainConfigEntry = z.infer<typeof EILChainConfigEntrySchema>

/**
 * EIL config for validation
 */
export const EILConfigValidationSchema = z
  .object({
    testnet: z
      .object({ chains: z.record(z.string(), EILChainConfigEntrySchema) })
      .passthrough(),
    mainnet: z
      .object({ chains: z.record(z.string(), EILChainConfigEntrySchema) })
      .passthrough(),
  })
  .passthrough()
export type EILConfigValidation = z.infer<typeof EILConfigValidationSchema>

/**
 * Branding config for validation
 */
export const BrandingConfigValidationSchema = z
  .object({
    version: z.string(),
    network: z.object({ name: z.string() }),
  })
  .passthrough()
export type BrandingConfigValidation = z.infer<
  typeof BrandingConfigValidationSchema
>

// Sequencer Request Schemas

/**
 * Threshold batcher sign request - security sensitive endpoint
 */
export const SignRequestSchema = z.object({
  data: z.string().min(1, 'Batch data is required'),
})
export type SignRequest = z.infer<typeof SignRequestSchema>

// Raw Artifact Schema (Foundry/Forge output)

/**
 * Raw contract artifact JSON from Foundry compilation
 */
export const RawArtifactJsonSchema = z.object({
  abi: z.array(AbiItemSchema) as z.ZodType<Abi>,
  bytecode: z.object({
    object: z.string(),
    sourceMap: z.string().optional(),
    linkReferences: z
      .record(
        z.string(),
        z.record(
          z.string(),
          z.array(z.object({ start: z.number(), length: z.number() })),
        ),
      )
      .optional(),
  }),
  deployedBytecode: z
    .object({
      object: z.string(),
      sourceMap: z.string().optional(),
    })
    .optional(),
  metadata: z.string().optional(),
  methodIdentifiers: z.record(z.string(), z.string()).optional(),
})
export type RawArtifactJson = z.infer<typeof RawArtifactJsonSchema>

// Deployment State Schemas

/**
 * Deployment state for rollback operations
 */
export const DeploymentStateSchema = z
  .object({
    network: z.string(),
    chainId: z.number(),
    timestamp: z.number(),
    deployer: z.string(),
    sequencerRegistry: z.string().optional(),
    thresholdBatchSubmitter: z.string().optional(),
    disputeGameFactory: z.string().optional(),
    prover: z.string().optional(),
    proxyRegistry: z.string().optional(),
    proxyPayment: z.string().optional(),
  })
  .passthrough()
export type DeploymentState = z.infer<typeof DeploymentStateSchema>

/**
 * Deployer configuration for testnet setup
 */
export const DeployerConfigSchema = z.object({
  address: z.string(),
  privateKey: z.string(),
  createdAt: z.string(),
})
export type DeployerConfig = z.infer<typeof DeployerConfigSchema>

/**
 * Deployment config for DAO registry
 */
export const DAODeploymentConfigSchema = z.object({
  network: z.string(),
  rpcUrl: z.string(),
  contracts: z.record(z.string(), AddressSchema),
})
export type DAODeploymentConfig = z.infer<typeof DAODeploymentConfigSchema>

// API Response Schemas

/**
 * GitHub release API response
 */
export const GitHubReleaseSchema = z.object({
  published_at: z.string(),
  tag_name: z.string().optional(),
  body: z.string().optional(),
})
export type GitHubRelease = z.infer<typeof GitHubReleaseSchema>

/**
 * JSON-RPC response for eth_blockNumber
 */
export const JsonRpcBlockNumberResponseSchema = z.object({
  result: z.string().optional(),
  error: z.object({ message: z.string() }).optional(),
})
export type JsonRpcBlockNumberResponse = z.infer<
  typeof JsonRpcBlockNumberResponseSchema
>

/**
 * JSON-compatible value schema (for polymorphic JSON-RPC results)
 */
import { JsonValueSchema } from '@jejunetwork/types'

export type { JsonRpcResponse } from '@jejunetwork/types'

/**
 * Generic JSON-RPC response (for any method)
 */
export const JsonRpcResponseSchema = z.object({
  result: JsonValueSchema.optional(),
  error: z.object({ message: z.string() }).optional(),
})

/**
 * Minimal chain config schema (just rpcUrl for readiness checks)
 */
export const ChainConfigMinimalSchema = z
  .object({
    rpcUrl: z.string(),
  })
  .passthrough()
export type ChainConfigMinimal = z.infer<typeof ChainConfigMinimalSchema>

/**
 * JSON-RPC response for eth_getBalance
 */
export const JsonRpcBalanceResponseSchema = z.object({
  result: z.string().optional(),
  error: z.object({ message: z.string() }).optional(),
})
export type JsonRpcBalanceResponse = z.infer<
  typeof JsonRpcBalanceResponseSchema
>

/**
 * Signer service response
 */
export const SignResponseSchema = z.object({
  requestId: z.string(),
  signature: z.string(),
  signer: z.string(),
  error: z.string().optional(),
})
export type SignResponse = z.infer<typeof SignResponseSchema>

/**
 * IPFS upload response (both CID and Hash formats)
 */
export const IPFSUploadResponseSchema = z.object({
  cid: z.string().optional(),
  Hash: z.string().optional(),
})
export type IPFSUploadResponse = z.infer<typeof IPFSUploadResponseSchema>

/**
 * x402 payment settlement response
 */
export const X402SettlementResponseSchema = z.object({
  success: z.boolean(),
  txHash: z.string().nullable(),
  paymentId: z.string().optional(),
  error: z.string().nullable(),
})
export type X402SettlementResponse = z.infer<
  typeof X402SettlementResponseSchema
>

/**
 * x402 payment verification response
 */
export const X402VerificationResponseSchema = z.object({
  valid: z.boolean(),
  isValid: z.boolean().optional(),
  invalidReason: z.string().nullable().optional(),
  payer: z.string().nullable().optional(),
  error: z.string().optional(),
})
export type X402VerificationResponse = z.infer<
  typeof X402VerificationResponseSchema
>

/**
 * x402 supported schemes response
 */
export const X402SupportedSchemesResponseSchema = z.object({
  kinds: z.array(
    z.object({
      scheme: z.string(),
      network: z.string(),
    }),
  ),
  x402Version: z.number(),
  facilitator: z.object({
    name: z.string(),
    version: z.string(),
    url: z.string(),
  }),
})
export type X402SupportedSchemesResponse = z.infer<
  typeof X402SupportedSchemesResponseSchema
>

/**
 * Extended x402 settlement response with fee info
 */
export const X402SettlementWithFeeResponseSchema = z.object({
  success: z.boolean(),
  txHash: z.string().nullable(),
  error: z.string().nullable(),
  paymentId: z.string().optional(),
  fee: z
    .object({
      human: z.string(),
      base: z.string(),
      bps: z.number(),
    })
    .optional(),
  net: z
    .object({
      human: z.string(),
      base: z.string(),
    })
    .optional(),
})
export type X402SettlementWithFeeResponse = z.infer<
  typeof X402SettlementWithFeeResponseSchema
>

/**
 * OIF deployment configuration
 */
export const OIFDeploymentSchema = z.object({
  chains: z
    .record(
      z.string(),
      z.object({
        status: z.string(),
      }),
    )
    .optional(),
})
export type OIFDeployment = z.infer<typeof OIFDeploymentSchema>

/**
 * EIL deployment configuration
 */
export const EILDeploymentSchema = z
  .object({
    l1StakeManager: z.string().optional(),
  })
  .passthrough()
export type EILDeployment = z.infer<typeof EILDeploymentSchema>

/**
 * Address record for deployment files
 */
export const AddressRecordSchema = z.record(z.string(), z.string())
export type AddressRecord = z.infer<typeof AddressRecordSchema>

/**
 * Jeju app manifest
 */
export const JejuAppManifestSchema = z
  .object({
    name: z.string(),
    version: z.string().optional(),
    description: z.string().optional(),
    jns: z.object({ name: z.string() }).optional(),
    decentralization: z
      .object({
        frontend: z
          .object({
            buildDir: z.string().optional(),
          })
          .optional(),
      })
      .optional(),
  })
  .passthrough()
export type JejuAppManifest = z.infer<typeof JejuAppManifestSchema>

/**
 * Frontend manifest for upload
 */
export const FrontendManifestSchema = z
  .object({
    name: z.string(),
    version: z.string().optional(),
    buildDir: z.string().optional(),
    cid: z.string().optional(),
  })
  .passthrough()
export type FrontendManifest = z.infer<typeof FrontendManifestSchema>

/**
 * Vendor app manifest (for dev-with-vendor.ts)
 */
export const VendorManifestSchema = z
  .object({
    devCommand: z.string().optional(),
    ports: z
      .object({
        main: z.number().optional(),
      })
      .optional(),
  })
  .passthrough()
export type VendorManifest = z.infer<typeof VendorManifestSchema>

/**
 * CID upload response (common pattern)
 */
export const CIDUploadResponseSchema = z.object({
  cid: z.string(),
})
export type CIDUploadResponse = z.infer<typeof CIDUploadResponseSchema>

/**
 * Agent registration file (ERC-8004 metadata)
 */
export const AgentRegistrationFileSchema = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    endpoints: z
      .array(
        z.object({
          type: z.string(),
          value: z.string(),
        }),
      )
      .optional(),
  })
  .passthrough()
export type AgentRegistrationFile = z.infer<typeof AgentRegistrationFileSchema>

/**
 * DNS zone list response (Cloudflare style)
 */
export const DNSZoneListResponseSchema = z.object({
  result: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
    }),
  ),
  success: z.boolean(),
})
export type DNSZoneListResponse = z.infer<typeof DNSZoneListResponseSchema>

/**
 * Cloudflare DNS record list response
 */
export const CloudflareDNSRecordListSchema = z.object({
  result: z.array(
    z.object({
      id: z.string(),
    }),
  ),
})
export type CloudflareDNSRecordList = z.infer<
  typeof CloudflareDNSRecordListSchema
>

/**
 * DNS record list response
 */
export const DNSRecordListResponseSchema = z.object({
  result: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      type: z.string(),
      content: z.string(),
    }),
  ),
  success: z.boolean(),
})
export type DNSRecordListResponse = z.infer<typeof DNSRecordListResponseSchema>

/**
 * Build output line (for parsing build tools)
 */
export const BuildOutputLineSchema = z
  .object({
    size: z.number().optional(),
    hash: z.string().optional(),
    name: z.string().optional(),
  })
  .passthrough()
export type BuildOutputLine = z.infer<typeof BuildOutputLineSchema>

/**
 * IPFS add API response line (ndjson format)
 * Note: IPFS API uses PascalCase for field names
 */
export const IPFSAddResponseLineSchema = z.object({
  Hash: z.string(),
  Name: z.string().optional(),
  Size: z.string().optional(),
})
export type IPFSAddResponseLine = z.infer<typeof IPFSAddResponseLineSchema>

// Validation Helpers

/**
 * Validate JSON string against schema, throwing on failure
 */
export function expectJson<T>(
  json: string,
  schema: z.ZodType<T>,
  context: string,
): T {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    throw new Error(
      `Invalid ${context}: failed to parse JSON - ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return expectValid(schema, parsed, context)
}

/**
 * Validate data against schema, throwing on failure
 */
export function expectValid<T>(
  schema: z.ZodType<T>,
  value: unknown,
  context: string,
): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    const errors = result.error.issues
      .map((e) => {
        const path = e.path.length > 0 ? e.path.join('.') : 'root'
        return `${path}: ${e.message}`
      })
      .join(', ')
    throw new Error(`Validation failed in ${context}: ${errors}`)
  }
  return result.data
}
