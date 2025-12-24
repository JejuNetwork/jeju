/**
 * EIP-7702 Authorization Utilities
 *
 * Helpers for working with EIP-7702 account abstraction features in viem 2.43+.
 * EIP-7702 allows EOAs to delegate to smart contract code within a transaction.
 *
 * @module @jejunetwork/contracts/eip7702
 */

import type {
  Account,
  Address,
  Chain,
  Hex,
  Transport,
  WalletClient,
} from 'viem'
import {
  hashAuthorization,
  recoverAuthorizationAddress,
  verifyAuthorization,
} from 'viem/utils'

/**
 * Unsigned EIP-7702 Authorization structure.
 * Note: viem uses 'address' internally but accepts 'contractAddress' in function params
 */
export interface Authorization {
  /** Chain ID the authorization is valid for. Use 0 for all chains. */
  chainId: number
  /** Address of the contract to delegate to (viem uses 'address' internally) */
  address: Address
  /** Nonce of the authorizing account */
  nonce: number
}

/**
 * Signed EIP-7702 Authorization with signature components.
 */
export interface SignedAuthorization extends Authorization {
  /** ECDSA signature r component */
  r: Hex
  /** ECDSA signature s component */
  s: Hex
  /** ECDSA signature v component (may be computed from yParity) */
  v?: bigint
  /** ECDSA recovery parameter */
  yParity?: number
}

/**
 * Configuration for signing an authorization.
 */
export interface SignAuthorizationConfig {
  /** Account that will authorize the delegation */
  account: Account
  /** Contract address to delegate to */
  contractAddress: Address
  /** Chain ID (defaults to client chain, use 0 for all chains) */
  chainId?: number
  /** Nonce override (defaults to account's next nonce) */
  nonce?: number
  /**
   * Set to 'self' if the authorizing account will also execute the transaction.
   * This increments the nonce by 1 to account for the transaction nonce.
   */
  executor?: 'self'
}

/**
 * Sign an EIP-7702 authorization to delegate an EOA to a contract.
 *
 * This allows an EOA to temporarily "become" a smart contract for the
 * duration of a transaction, enabling features like:
 * - Batching multiple operations atomically
 * - Gas sponsorship by third parties
 * - Privilege de-escalation with limited permissions
 *
 * @example
 * ```typescript
 * // Sign authorization for a relay to execute
 * const authorization = await signAuthorization(walletClient, {
 *   account: eoa,
 *   contractAddress: delegationContract,
 * })
 *
 * // Execute with the authorization
 * const hash = await walletClient.writeContract({
 *   address: eoa.address,
 *   abi: delegationAbi,
 *   functionName: 'execute',
 *   authorizationList: [authorization],
 * })
 * ```
 *
 * @example
 * ```typescript
 * // Self-executing: EOA signs and executes in one tx
 * const authorization = await signAuthorization(walletClient, {
 *   contractAddress: delegationContract,
 *   executor: 'self',
 * })
 * ```
 */
export async function signAuthorization<
  TChain extends Chain | undefined = Chain | undefined,
  TAccount extends Account | undefined = Account | undefined,
>(
  client: WalletClient<Transport, TChain, TAccount>,
  config: SignAuthorizationConfig,
): Promise<SignedAuthorization> {
  const result = await client.signAuthorization({
    account: config.account,
    contractAddress: config.contractAddress,
    chainId: config.chainId,
    nonce: config.nonce,
    executor: config.executor,
  })
  return {
    chainId: result.chainId,
    address: result.address,
    nonce: result.nonce,
    r: result.r,
    s: result.s,
    v: result.v,
    yParity: result.yParity,
  }
}

/**
 * Prepare an authorization without signing (fills in chainId and nonce).
 *
 * Useful when you need to inspect the authorization before signing,
 * or when signing is handled by a different component.
 *
 * @example
 * ```typescript
 * const prepared = await prepareAuthorization(walletClient, {
 *   account: eoa,
 *   contractAddress: delegationContract,
 * })
 * // prepared.chainId and prepared.nonce are now filled in
 * ```
 */
export async function prepareAuthorization<
  TChain extends Chain | undefined = Chain | undefined,
  TAccount extends Account | undefined = Account | undefined,
>(
  client: WalletClient<Transport, TChain, TAccount>,
  config: Omit<SignAuthorizationConfig, 'executor'>,
): Promise<Authorization> {
  const result = await client.prepareAuthorization({
    account: config.account,
    contractAddress: config.contractAddress,
    chainId: config.chainId,
    nonce: config.nonce,
  })
  return {
    chainId: result.chainId,
    address: result.address,
    nonce: result.nonce,
  }
}

/**
 * Verify that an authorization was signed by the expected address.
 *
 * @example
 * ```typescript
 * const isValid = await verifyAuthorizationSignature({
 *   address: expectedSigner,
 *   authorization: signedAuthorization,
 * })
 * ```
 */
export async function verifyAuthorizationSignature(config: {
  address: Address
  authorization: SignedAuthorization
}): Promise<boolean> {
  const viemAuth = {
    address: config.authorization.address,
    chainId: config.authorization.chainId,
    nonce: config.authorization.nonce,
    r: config.authorization.r,
    s: config.authorization.s,
    v: config.authorization.v,
    yParity: config.authorization.yParity,
  }
  return verifyAuthorization({
    address: config.address,
    authorization: viemAuth,
  })
}

/**
 * Recover the signing address from a signed authorization.
 *
 * @example
 * ```typescript
 * const signer = await recoverAuthorizer(signedAuthorization)
 * ```
 */
export async function recoverAuthorizer(
  authorization: SignedAuthorization,
): Promise<Address> {
  const viemAuth = {
    address: authorization.address,
    chainId: authorization.chainId,
    nonce: authorization.nonce,
    r: authorization.r,
    s: authorization.s,
    v: authorization.v ?? 0n,
    yParity: authorization.yParity ?? 0,
  }
  return recoverAuthorizationAddress({
    authorization: {
      address: viemAuth.address,
      chainId: viemAuth.chainId,
      nonce: viemAuth.nonce,
    },
    signature: {
      r: viemAuth.r,
      s: viemAuth.s,
      v: viemAuth.v,
      yParity: viemAuth.yParity,
    },
  })
}

/**
 * Hash an authorization for signing or verification.
 *
 * The hash format is: keccak256('0x05' || rlp([chain_id, address, nonce]))
 *
 * @example
 * ```typescript
 * const hash = hashAuthorizationMessage({
 *   chainId: 1,
 *   address: delegationContract,
 *   nonce: 0,
 * })
 * ```
 */
export function hashAuthorizationMessage(authorization: Authorization): Hex {
  return hashAuthorization({
    chainId: authorization.chainId,
    contractAddress: authorization.address,
    nonce: authorization.nonce,
  })
}

/**
 * Helper type for transactions that include EIP-7702 authorizations.
 */
export interface EIP7702TransactionParams {
  /** List of signed authorizations for the transaction */
  authorizationList: SignedAuthorization[]
}

/**
 * Check if a transaction type requires EIP-7702 authorization.
 *
 * Use this to determine if you need to sign authorizations before
 * executing a transaction.
 */
export function requiresAuthorization(params: {
  authorizationList?: SignedAuthorization[]
}): params is EIP7702TransactionParams {
  return (
    params.authorizationList !== undefined &&
    params.authorizationList.length > 0
  )
}

/**
 * Create a batched transaction using EIP-7702.
 *
 * This is a helper for the common pattern of batching multiple
 * contract calls into a single atomic transaction.
 *
 * @example
 * ```typescript
 * // Approve and transfer in one transaction
 * const calls = [
 *   { to: tokenAddress, data: approveCalldata },
 *   { to: dexAddress, data: swapCalldata },
 * ]
 *
 * const hash = await executeBatch(walletClient, {
 *   account: eoa,
 *   batchContract: batchExecutorAddress,
 *   calls,
 * })
 * ```
 */
export interface BatchCall {
  to: Address
  data: Hex
  value?: bigint
}

/**
 * Standard interface for batch executor contracts.
 * Most EIP-7702 delegation contracts implement this or similar.
 */
export const BATCH_EXECUTOR_ABI = [
  {
    type: 'function',
    name: 'execute',
    inputs: [
      {
        name: 'calls',
        type: 'tuple[]',
        components: [
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' },
        ],
      },
    ],
    outputs: [{ name: 'results', type: 'bytes[]' }],
    stateMutability: 'payable',
  },
] as const
