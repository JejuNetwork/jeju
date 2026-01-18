/**
 * @jejunetwork/durable-objects - ID Implementation
 *
 * IDs are 64-char hex: first 32 chars = namespace hash, last 32 = instance ID.
 * This allows namespace validation without database lookups.
 */

import type { DurableObjectId } from './types.js'

const ID_LENGTH = 64
const NAMESPACE_PREFIX_LENGTH = 32

async function sha256(input: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)),
  )
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

async function sha256Prefix(input: string): Promise<string> {
  return toHex((await sha256(input)).slice(0, 16))
}

async function sha256Suffix(input: string): Promise<string> {
  return toHex((await sha256(input)).slice(16, 32))
}

const namespacePrefixCache = new Map<string, string>()

async function getNamespacePrefix(namespace: string): Promise<string> {
  let prefix = namespacePrefixCache.get(namespace)
  if (!prefix) {
    prefix = await sha256Prefix(`dws:namespace:${namespace}`)
    namespacePrefixCache.set(namespace, prefix)
  }
  return prefix
}

export class DWSObjectId implements DurableObjectId {
  private readonly idString: string
  private readonly sourceName?: string

  private constructor(idString: string, sourceName?: string) {
    this.idString = idString
    this.sourceName = sourceName
  }

  static async fromName(namespace: string, name: string): Promise<DWSObjectId> {
    const namespacePrefix = await getNamespacePrefix(namespace)
    const instanceSuffix = await sha256Suffix(`dws:name:${namespace}:${name}`)
    return new DWSObjectId(namespacePrefix + instanceSuffix, name)
  }

  static async newUnique(namespace: string): Promise<DWSObjectId> {
    const namespacePrefix = await getNamespacePrefix(namespace)
    return new DWSObjectId(
      namespacePrefix + crypto.randomUUID().replace(/-/g, ''),
    )
  }

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

  static async validateNamespace(
    namespace: string,
    idString: string,
  ): Promise<boolean> {
    if (idString.length !== ID_LENGTH || !/^[0-9a-f]+$/i.test(idString))
      return false
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
    return (
      this.idString ===
      (other instanceof DWSObjectId ? other.idString : other.toString())
    )
  }

  get name(): string | undefined {
    return this.sourceName
  }

  getInstanceId(): string {
    return this.idString.slice(NAMESPACE_PREFIX_LENGTH)
  }

  getStorageKey(namespace: string): string {
    return `${namespace}:${this.idString}`
  }
}
