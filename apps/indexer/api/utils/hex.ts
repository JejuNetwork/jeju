/**
 * Hex type utilities for viem compatibility
 *
 * The subsquid processor provides log.data and log.topics as `string`,
 * but viem functions expect `Hex` type (`0x${string}`).
 *
 * These utilities provide type-safe conversion without runtime overhead.
 */

import type { Abi, AbiParameter, Hex } from 'viem'
import { decodeAbiParameters, decodeEventLog } from 'viem'

/**
 * Maps ABI type strings to their TypeScript primitive types
 */
type AbiTypeToPrimitive<T extends string> = T extends
  | 'address'
  | 'string'
  | 'bytes'
  | `bytes${number}`
  | 'bytes32'
  ? string
  : T extends
        | 'uint256'
        | 'uint128'
        | 'uint112'
        | 'uint160'
        | 'uint64'
        | 'uint32'
        | 'uint24'
        | 'uint16'
        | 'uint8'
        | 'int256'
        | 'int128'
        | 'int64'
        | 'int32'
        | 'int24'
        | 'int16'
        | 'int8'
    ? bigint
    : T extends 'bool'
      ? boolean
      : T extends `${string}[]`
        ? AbiTypeToPrimitive<T extends `${infer U}[]` ? U : never>[]
        : string | bigint | boolean

/**
 * Converts a tuple of ABI parameter definitions to their primitive types
 */
type AbiParamsToPrimitives<T extends readonly { type: string }[]> = {
  [K in keyof T]: T[K] extends { type: infer U extends string }
    ? AbiTypeToPrimitive<U>
    : never
}

/**
 * Asserts that a string is a valid hex string and returns it typed as Hex.
 * Throws if the value doesn't start with '0x'.
 */
export function assertHex(value: string, context?: string): Hex {
  if (!value.startsWith('0x')) {
    throw new Error(
      `Expected hex string starting with 0x${context ? ` in ${context}` : ''}, got: ${value.slice(0, 20)}...`,
    )
  }
  return value as Hex
}

/**
 * Converts a string to Hex type.
 * For performance, this is a simple type assertion after validation.
 * Use this when you trust the source (e.g., blockchain data from subsquid).
 */
export function toHex(value: string): Hex {
  return value as Hex
}

/**
 * Type-safe wrapper for decodeAbiParameters that accepts string data from subsquid.
 * Uses generics to infer proper return types from the ABI parameter definitions.
 *
 * @example
 * const decoded = decodeLogData(
 *   [{ type: 'address' }, { type: 'uint256' }] as const,
 *   log.data
 * );
 * // decoded[0] is string, decoded[1] is bigint
 */
export function decodeLogData<
  const T extends readonly { type: string; name?: string }[],
>(types: T, data: string): AbiParamsToPrimitives<T> {
  return decodeAbiParameters(
    types as readonly AbiParameter[],
    data as Hex,
  ) as AbiParamsToPrimitives<T>
}

/**
 * Type-safe wrapper for decodeEventLog that accepts string data/topics from subsquid.
 * Returns a union of all possible event types from the ABI.
 */
export function decodeLog<TAbi extends Abi>(params: {
  abi: TAbi
  data: string
  topics: readonly string[]
}): ReturnType<typeof decodeEventLog<TAbi>> {
  return decodeEventLog({
    abi: params.abi,
    data: params.data as Hex,
    topics: params.topics as [Hex, ...Hex[]],
  })
}

/**
 * Type-safe event decoder that returns typed args after filtering by event signature.
 * Use this when you've already verified the event signature matches the expected event.
 *
 * @example
 * if (eventSig === MARKET_CREATED) {
 *   const { sessionId, question, liquidity } = decodeEventArgs<MarketCreatedArgs>(
 *     marketInterface,
 *     log.data,
 *     log.topics
 *   );
 * }
 */
export function decodeEventArgs<TArgs>(
  abi: Abi,
  data: string,
  topics: readonly string[],
): TArgs {
  const decoded = decodeEventLog({
    abi,
    data: data as Hex,
    topics: topics as [Hex, ...Hex[]],
  })
  return decoded.args as TArgs
}

/**
 * Checks if a topic0 exists in a Set of event signatures.
 * Event signature sets contain Hex values, topic0 from subsquid is string.
 */
export function isEventInSet(topic0: string, signatureSet: Set<Hex>): boolean {
  return signatureSet.has(topic0 as Hex)
}

/**
 * Creates a typed event signature Set from an array of hex strings.
 * Use this when defining event signature sets for lookup.
 */
export function createEventSignatureSet(
  signatures: readonly string[],
): Set<Hex> {
  return new Set(signatures as readonly Hex[])
}

/**
 * Type-safe address extraction from topic.
 * Topics are 32-byte hex strings, addresses are the last 20 bytes.
 */
export function addressFromTopic(topic: string): Hex {
  return `0x${topic.slice(26)}` as Hex
}
