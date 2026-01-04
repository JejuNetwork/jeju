/**
 * @jejunetwork/durable-objects - Durable Object ID Implementation
 *
 * IDs are 64-character hex strings with the following structure:
 * - Bytes 0-15 (32 chars): Namespace hash prefix (SHA-256 of namespace name, truncated)
 * - Bytes 16-31 (32 chars): Instance identifier
 *   - For named IDs: SHA-256 hash of the name, truncated
 *   - For unique IDs: Random UUID bytes
 *
 * This format allows validation that an ID belongs to a specific namespace
 * without requiring database lookups.
 */

import type { DurableObjectId } from './types.js'

const ID_LENGTH = 64
const NAMESPACE_PREFIX_LENGTH = 32

/**
 * Compute SHA-256 hash and convert bytes to hex
 */
async function sha256(input: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(input)
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data))
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** First 16 bytes of SHA-256 hash as hex */
async function sha256Prefix(input: string): Promise<string> {
  return toHex((await sha256(input)).slice(0, 16))
}

/** Last 16 bytes of SHA-256 hash as hex */
async function sha256Suffix(input: string): Promise<string> {
  return toHex((await sha256(input)).slice(16, 32))
}

/**
 * Generate a random 16-byte hex string from UUID
 */
function randomInstanceId(): string {
  const uuid = crypto.randomUUID().replace(/-/g, '')
  // UUID is 32 chars, we need 32 chars, so just use it directly
  return uuid
}

/**
 * Cache for namespace prefixes to avoid repeated hashing
 */
const namespacePrefixCache = new Map<string, string>()

/**
 * Get the namespace hash prefix, using cache when possible
 */
async function getNamespacePrefix(namespace: string): Promise<string> {
  let prefix = namespacePrefixCache.get(namespace)
  if (!prefix) {
    prefix = await sha256Prefix(`dws:namespace:${namespace}`)
    namespacePrefixCache.set(namespace, prefix)
  }
  return prefix
}

/**
 * Implementation of DurableObjectId
 */
export class DWSObjectId implements DurableObjectId {
  private readonly idString: string
  private readonly sourceName?: string

  private constructor(idString: string, sourceName?: string) {
    this.idString = idString
    this.sourceName = sourceName
  }

  /**
   * Create a new ID from a deterministic name
   */
  static async fromName(namespace: string, name: string): Promise<DWSObjectId> {
    const namespacePrefix = await getNamespacePrefix(namespace)
    const instanceSuffix = await sha256Suffix(`dws:name:${namespace}:${name}`)
    return new DWSObjectId(namespacePrefix + instanceSuffix, name)
  }

  /**
   * Create a new unique ID
   */
  static async newUnique(namespace: string): Promise<DWSObjectId> {
    const namespacePrefix = await getNamespacePrefix(namespace)
    return new DWSObjectId(namespacePrefix + randomInstanceId())
  }

  /**
   * Parse an ID from its string representation
   * @throws Error if the ID is invalid or doesn't match the namespace
   */
  static async fromString(
    namespace: string,
    idString: string,
  ): Promise<DWSObjectId> {
    if (idString.length !== ID_LENGTH || !/^[0-9a-f]+$/i.test(idString)) {
      throw new Error(
        `Invalid Durable Object ID format: expected ${ID_LENGTH} hex characters`,
      )
    }

    const namespacePrefix = await getNamespacePrefix(namespace)
    if (
      idString.slice(0, NAMESPACE_PREFIX_LENGTH).toLowerCase() !==
      namespacePrefix
    ) {
      throw new Error(
        `Durable Object ID does not belong to namespace "${namespace}"`,
      )
    }

    return new DWSObjectId(idString.toLowerCase())
  }

  /**
   * Validate that an ID string matches a namespace without fully parsing
   */
  static async validateNamespace(
    namespace: string,
    idString: string,
  ): Promise<boolean> {
    if (idString.length !== ID_LENGTH || !/^[0-9a-f]+$/i.test(idString)) {
      return false
    }
    const namespacePrefix = await getNamespacePrefix(namespace)
    return (
      idString.slice(0, NAMESPACE_PREFIX_LENGTH).toLowerCase() ===
      namespacePrefix
    )
  }

  toString(): string {
    return this.idString
  }

  equals(other: DurableObjectId): boolean {
    if (!(other instanceof DWSObjectId)) {
      return this.idString === other.toString()
    }
    return this.idString === other.idString
  }

  get name(): string | undefined {
    return this.sourceName
  }

  /**
   * Get just the instance portion of the ID (without namespace prefix)
   * Useful for database keys where namespace is implicit
   */
  getInstanceId(): string {
    return this.idString.slice(NAMESPACE_PREFIX_LENGTH)
  }

  /**
   * Get the full composite key for database storage
   * Format: namespace:instanceId
   */
  getStorageKey(namespace: string): string {
    return `${namespace}:${this.idString}`
  }
}
