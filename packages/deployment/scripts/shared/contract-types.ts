/**
 * @fileoverview Shared contract types for deployment scripts
 * @module packages/deployment/scripts/shared/contract-types
 *
 * Provides properly typed interfaces for contract artifacts and deployment.
 */

import type { Abi, Address, Hex } from 'viem'

/**
 * Contract artifact as loaded from Foundry output
 */
export interface ContractArtifact {
  /** Contract ABI - array of function/event definitions */
  abi: Abi
  /** Bytecode object containing deployment code */
  bytecode: {
    object: Hex
    sourceMap?: string
    linkReferences?: Record<
      string,
      Record<string, Array<{ start: number; length: number }>>
    >
  }
  /** Deployed bytecode for verification */
  deployedBytecode?: {
    object: Hex
    sourceMap?: string
  }
}

/**
 * Deployed contract info returned from deployment
 */
export interface DeployedContract {
  /** Contract address on chain */
  address: Address
  /** Contract ABI for interaction */
  abi: Abi
}

/**
 * Constructor argument types that can be passed to contract deployment.
 * These are the primitive types that Solidity accepts.
 */
export type ConstructorArg =
  | string
  | number
  | bigint
  | boolean
  | Address
  | Hex
  | readonly ConstructorArg[]
  | ConstructorArg[]

/**
 * Generic contract deployment result
 */
export interface DeploymentResult<
  T extends Record<string, Address> = Record<string, Address>,
> {
  /** Map of contract name to address */
  contracts: T
  /** Deployer address */
  deployer: Address
  /** Chain ID where deployed */
  chainId: number
  /** Network name */
  network: string
  /** Deployment timestamp */
  deployedAt: string
}

/**
 * Raw JSON artifact as read from file (before parsing)
 */
export interface RawArtifactJson {
  abi: Abi
  bytecode: {
    object: string
    sourceMap?: string
    linkReferences?: Record<
      string,
      Record<string, Array<{ start: number; length: number }>>
    >
  }
  deployedBytecode?: {
    object: string
    sourceMap?: string
  }
  metadata?: string
  methodIdentifiers?: Record<string, string>
}

/**
 * Type guard to validate a loaded artifact has required fields
 */
export function isValidArtifact(
  artifact: Partial<RawArtifactJson>,
): artifact is RawArtifactJson {
  return (
    Array.isArray(artifact.abi) &&
    typeof artifact.bytecode === 'object' &&
    typeof artifact.bytecode.object === 'string' &&
    artifact.bytecode.object.startsWith('0x')
  )
}

/**
 * Parse raw artifact JSON into typed ContractArtifact
 */
export function parseArtifact(raw: RawArtifactJson): ContractArtifact {
  return {
    abi: raw.abi,
    bytecode: {
      object: raw.bytecode.object as Hex,
      sourceMap: raw.bytecode.sourceMap,
      linkReferences: raw.bytecode.linkReferences,
    },
    deployedBytecode: raw.deployedBytecode
      ? {
          object: raw.deployedBytecode.object as Hex,
          sourceMap: raw.deployedBytecode.sourceMap,
        }
      : undefined,
  }
}
