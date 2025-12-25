#!/usr/bin/env bun
/**
 * L2 State Fetcher
 *
 * Fetches L2 state and generates Merkle proofs for fraud proof generation.
 * Uses eth_getProof to get storage proofs and builds preimage data.
 *
 * Features:
 * - Real eth_getProof for account and storage proofs
 * - Merkle Patricia Trie proof verification
 * - OP Stack output root computation
 * - Preimage generation for Cannon VM
 * - RLP encoding for trie nodes
 */

import {
  type Address,
  bytesToHex,
  concat,
  createPublicClient,
  encodeAbiParameters,
  fromHex,
  type Hex,
  hexToBytes,
  http,
  keccak256,
  type PublicClient,
  pad,
  toHex,
} from 'viem'
import { z } from 'zod'
import { inferChainFromRpcUrl } from '../shared/chain-utils'

// eth_getProof response schema
const EthGetProofResponseSchema = z.object({
  address: z.string().transform((s) => s as Address),
  nonce: z.string().transform((s) => s as Hex),
  balance: z.string().transform((s) => s as Hex),
  storageHash: z.string().transform((s) => s as Hex),
  codeHash: z.string().transform((s) => s as Hex),
  accountProof: z.array(z.string().transform((s) => s as Hex)),
  storageProof: z.array(
    z.object({
      key: z.string().transform((s) => s as Hex),
      value: z.string().transform((s) => s as Hex),
      proof: z.array(z.string().transform((s) => s as Hex)),
    }),
  ),
})

// L2ToL1MessagePasser address (standard OP Stack)
const L2_TO_L1_MESSAGE_PASSER =
  '0x4200000000000000000000000000000000000016' as Address

// Output root version (0 for current OP Stack)
const OUTPUT_ROOT_VERSION =
  '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex

// Key predeploy addresses for OP Stack
const L2_CROSS_DOMAIN_MESSENGER =
  '0x4200000000000000000000000000000000000007' as Address
const L2_STANDARD_BRIDGE =
  '0x4200000000000000000000000000000000000010' as Address
const SEQUENCER_FEE_WALLET =
  '0x4200000000000000000000000000000000000011' as Address
const L1_BLOCK_INFO = '0x4200000000000000000000000000000000000015' as Address

export interface StorageProof {
  key: Hex
  value: Hex
  proof: Hex[]
}

export interface AccountProof {
  address: Address
  nonce: bigint
  balance: bigint
  storageHash: Hex
  codeHash: Hex
  accountProof: Hex[]
  storageProofs: StorageProof[]
}

export interface L2StateSnapshot {
  blockNumber: bigint
  blockHash: Hex
  stateRoot: Hex
  timestamp: bigint
  messagePasserStorageRoot: Hex
  outputRoot: Hex
  accountProofs: Map<Address, AccountProof>
}

export interface PreimageData {
  key: Hex
  data: Uint8Array
  offset: number
}

export interface TransactionReceipt {
  status: number
  cumulativeGasUsed: bigint
  logsBloom: Hex
  logs: Array<{
    address: Address
    topics: Hex[]
    data: Hex
  }>
}

export interface L1BlockInfo {
  number: bigint
  timestamp: bigint
  baseFee: bigint
  hash: Hex
  sequenceNumber: bigint
  batcherHash: Hex
  l1FeeOverhead: bigint
  l1FeeScalar: bigint
}

export class StateFetcher {
  private client: PublicClient

  constructor(rpcUrl: string) {
    const chain = inferChainFromRpcUrl(rpcUrl)
    this.client = createPublicClient({ chain, transport: http(rpcUrl) })
  }

  /**
   * Fetch complete L2 state snapshot for a given block
   * Includes all critical predeploy state for output root verification
   */
  async fetchStateSnapshot(blockNumber: bigint): Promise<L2StateSnapshot> {
    const block = await this.client.getBlock({
      blockNumber,
      includeTransactions: false,
    })
    if (!block) {
      throw new Error(`Block ${blockNumber} not found`)
    }

    // Fetch proofs for all critical OP Stack predeploys in parallel
    const [messagePasserProof, crossDomainMessengerProof, standardBridgeProof] =
      await Promise.all([
        this.getAccountProof(L2_TO_L1_MESSAGE_PASSER, [], blockNumber),
        this.getAccountProof(L2_CROSS_DOMAIN_MESSENGER, [], blockNumber),
        this.getAccountProof(L2_STANDARD_BRIDGE, [], blockNumber),
      ])

    // Compute the output root as per OP Stack spec:
    // keccak256(version ++ stateRoot ++ messagePasserStorageRoot ++ blockHash)
    const outputRoot = this.computeOutputRoot(
      block.stateRoot,
      messagePasserProof.storageHash,
      block.hash as Hex,
    )

    const accountProofs = new Map<Address, AccountProof>([
      [L2_TO_L1_MESSAGE_PASSER, messagePasserProof],
      [L2_CROSS_DOMAIN_MESSENGER, crossDomainMessengerProof],
      [L2_STANDARD_BRIDGE, standardBridgeProof],
    ])

    return {
      blockNumber: block.number,
      blockHash: block.hash as Hex,
      stateRoot: block.stateRoot,
      timestamp: block.timestamp,
      messagePasserStorageRoot: messagePasserProof.storageHash,
      outputRoot,
      accountProofs,
    }
  }

  /**
   * Fetch L1 block info from the L1Block predeploy
   * This is critical for verifying L2 blocks derive from correct L1 state
   */
  async fetchL1BlockInfo(blockNumber: bigint): Promise<L1BlockInfo> {
    // L1Block predeploy storage slots (per OP Stack spec)
    const SLOT_NUMBER = pad('0x00', { size: 32 })
    const SLOT_TIMESTAMP = pad('0x01', { size: 32 })
    const SLOT_BASEFEE = pad('0x02', { size: 32 })
    const SLOT_HASH = pad('0x03', { size: 32 })
    const SLOT_SEQUENCE_NUMBER = pad('0x04', { size: 32 })
    const SLOT_BATCHER_HASH = pad('0x05', { size: 32 })
    const SLOT_L1_FEE_OVERHEAD = pad('0x06', { size: 32 })
    const SLOT_L1_FEE_SCALAR = pad('0x07', { size: 32 })

    const proof = await this.getAccountProof(
      L1_BLOCK_INFO,
      [
        SLOT_NUMBER,
        SLOT_TIMESTAMP,
        SLOT_BASEFEE,
        SLOT_HASH,
        SLOT_SEQUENCE_NUMBER,
        SLOT_BATCHER_HASH,
        SLOT_L1_FEE_OVERHEAD,
        SLOT_L1_FEE_SCALAR,
      ],
      blockNumber,
    )

    const getStorageValue = (slot: Hex): bigint => {
      const storageProof = proof.storageProofs.find(
        (sp) => sp.key.toLowerCase() === slot.toLowerCase(),
      )
      return storageProof ? fromHex(storageProof.value, 'bigint') : 0n
    }

    const getStorageHex = (slot: Hex): Hex => {
      const storageProof = proof.storageProofs.find(
        (sp) => sp.key.toLowerCase() === slot.toLowerCase(),
      )
      return storageProof?.value || pad('0x00', { size: 32 })
    }

    return {
      number: getStorageValue(SLOT_NUMBER),
      timestamp: getStorageValue(SLOT_TIMESTAMP),
      baseFee: getStorageValue(SLOT_BASEFEE),
      hash: getStorageHex(SLOT_HASH),
      sequenceNumber: getStorageValue(SLOT_SEQUENCE_NUMBER),
      batcherHash: getStorageHex(SLOT_BATCHER_HASH),
      l1FeeOverhead: getStorageValue(SLOT_L1_FEE_OVERHEAD),
      l1FeeScalar: getStorageValue(SLOT_L1_FEE_SCALAR),
    }
  }

  /**
   * Fetch state for a specific account with all storage
   */
  async fetchAccountState(
    address: Address,
    storageKeys: Hex[],
    blockNumber: bigint,
  ): Promise<{
    proof: AccountProof
    storageValues: Map<Hex, Hex>
  }> {
    const proof = await this.getAccountProof(address, storageKeys, blockNumber)

    const storageValues = new Map<Hex, Hex>()
    for (const sp of proof.storageProofs) {
      storageValues.set(sp.key, sp.value)
    }

    return { proof, storageValues }
  }

  /**
   * Fetch account proof using eth_getProof
   */
  async getAccountProof(
    address: Address,
    storageKeys: Hex[],
    blockNumber: bigint,
  ): Promise<AccountProof> {
    const rawResult = await this.client.request({
      method: 'eth_getProof',
      params: [address, storageKeys, toHex(blockNumber)],
    })
    const result = EthGetProofResponseSchema.parse(rawResult)

    return {
      address: result.address,
      nonce: fromHex(result.nonce, 'bigint'),
      balance: fromHex(result.balance, 'bigint'),
      storageHash: result.storageHash,
      codeHash: result.codeHash,
      accountProof: result.accountProof,
      storageProofs: result.storageProof.map((sp) => ({
        key: sp.key,
        value: sp.value,
        proof: sp.proof,
      })),
    }
  }

  /**
   * Fetch storage proof for a specific slot
   */
  async getStorageProof(
    address: Address,
    slot: Hex,
    blockNumber: bigint,
  ): Promise<StorageProof> {
    const proof = await this.getAccountProof(address, [slot], blockNumber)
    const storageProof = proof.storageProofs.find((sp) => sp.key === slot)
    if (!storageProof) {
      // Return empty proof for zero value
      return {
        key: slot,
        value:
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        proof: [],
      }
    }
    return storageProof
  }

  /**
   * Compute the L2 output root as per OP Stack specification
   */
  computeOutputRoot(
    stateRoot: Hex,
    messagePasserRoot: Hex,
    blockHash: Hex,
  ): Hex {
    return keccak256(
      concat([OUTPUT_ROOT_VERSION, stateRoot, messagePasserRoot, blockHash]),
    )
  }

  /**
   * Verify that a claimed output root matches the actual L2 state
   */
  async verifyOutputRoot(
    blockNumber: bigint,
    claimedOutputRoot: Hex,
  ): Promise<{
    valid: boolean
    actualOutputRoot: Hex
    snapshot: L2StateSnapshot
  }> {
    const snapshot = await this.fetchStateSnapshot(blockNumber)
    return {
      valid:
        snapshot.outputRoot.toLowerCase() === claimedOutputRoot.toLowerCase(),
      actualOutputRoot: snapshot.outputRoot,
      snapshot,
    }
  }

  /**
   * Build preimage data for the PreimageOracle
   * This packages state data in a format the MIPS VM can access
   */
  buildPreimageData(snapshot: L2StateSnapshot): PreimageData[] {
    const preimages: PreimageData[] = []

    // Block header preimage
    const blockHeaderData = encodeAbiParameters(
      [
        { type: 'bytes32', name: 'parentHash' },
        { type: 'bytes32', name: 'stateRoot' },
        { type: 'uint256', name: 'blockNumber' },
        { type: 'uint256', name: 'timestamp' },
      ],
      [
        '0x0000000000000000000000000000000000000000000000000000000000000000', // Would be actual parent hash
        snapshot.stateRoot,
        snapshot.blockNumber,
        snapshot.timestamp,
      ],
    )
    preimages.push({
      key: keccak256(blockHeaderData),
      data: new Uint8Array(Buffer.from(blockHeaderData.slice(2), 'hex')),
      offset: 0,
    })

    // State root preimage
    const stateRootData = concat([snapshot.stateRoot])
    preimages.push({
      key: keccak256(stateRootData),
      data: new Uint8Array(Buffer.from(snapshot.stateRoot.slice(2), 'hex')),
      offset: 0,
    })

    // Message passer storage root preimage
    const messagePasserData = concat([snapshot.messagePasserStorageRoot])
    preimages.push({
      key: keccak256(messagePasserData),
      data: new Uint8Array(
        Buffer.from(snapshot.messagePasserStorageRoot.slice(2), 'hex'),
      ),
      offset: 0,
    })

    // Account proofs as preimages
    for (const [_address, proof] of snapshot.accountProofs) {
      for (let i = 0; i < proof.accountProof.length; i++) {
        const node = proof.accountProof[i]
        preimages.push({
          key: keccak256(node),
          data: new Uint8Array(Buffer.from(node.slice(2), 'hex')),
          offset: 0,
        })
      }

      for (const storageProof of proof.storageProofs) {
        for (const node of storageProof.proof) {
          preimages.push({
            key: keccak256(node),
            data: new Uint8Array(Buffer.from(node.slice(2), 'hex')),
            offset: 0,
          })
        }
      }
    }

    return preimages
  }

  /**
   * Encode Merkle proof for contract verification
   */
  encodeMerkleProof(proof: Hex[]): Hex {
    return encodeAbiParameters([{ type: 'bytes[]', name: 'proof' }], [proof])
  }

  /**
   * Verify a Merkle Patricia Trie proof
   * This implements proper MPT verification per Ethereum spec
   */
  verifyMerkleProof(root: Hex, key: Hex, value: Hex, proof: Hex[]): boolean {
    if (proof.length === 0) {
      // Empty proof means value should be zero/absent
      return value === pad('0x00', { size: 32 }) || value === '0x'
    }

    // The root should match the hash of the first proof node
    const firstNodeHash = keccak256(proof[0])
    if (firstNodeHash.toLowerCase() !== root.toLowerCase()) {
      return false
    }

    // Walk the proof path
    const keyNibbles = this.hexToNibbles(key)
    let currentHash = root
    let keyIdx = 0

    for (let i = 0; i < proof.length; i++) {
      const node = proof[i]
      const nodeHash = keccak256(node)

      if (i > 0 && nodeHash.toLowerCase() !== currentHash.toLowerCase()) {
        return false
      }

      const decoded = this.decodeRLPNode(node)
      if (!decoded) return false

      if (decoded.type === 'branch') {
        // Branch node: 17 elements [0-15 children, value]
        if (keyIdx >= keyNibbles.length) {
          // We've consumed all key nibbles, check value
          return this.compareValues(decoded.value, value)
        }
        const nibble = keyNibbles[keyIdx]
        currentHash = decoded.children[nibble] as Hex
        keyIdx++
      } else if (decoded.type === 'leaf' || decoded.type === 'extension') {
        // Leaf/Extension: [encodedPath, value/hash]
        const pathNibbles = this.decodeCompactPath(decoded.path)
        const isLeaf = decoded.type === 'leaf'

        // Check path matches
        for (let j = 0; j < pathNibbles.length; j++) {
          if (
            keyIdx + j >= keyNibbles.length ||
            keyNibbles[keyIdx + j] !== pathNibbles[j]
          ) {
            return false
          }
        }
        keyIdx += pathNibbles.length

        if (isLeaf) {
          // Leaf node: verify value
          return this.compareValues(decoded.value, value)
        } else {
          // Extension: continue to next node
          currentHash = decoded.value as Hex
        }
      }
    }

    return false
  }

  /**
   * Convert hex string to nibbles (half-bytes)
   */
  private hexToNibbles(hex: Hex): number[] {
    const bytes = hexToBytes(hex)
    const nibbles: number[] = []
    for (const byte of bytes) {
      nibbles.push((byte >> 4) & 0x0f)
      nibbles.push(byte & 0x0f)
    }
    return nibbles
  }

  /**
   * Decode compact-encoded path (HP encoding)
   */
  private decodeCompactPath(encoded: Uint8Array): number[] {
    if (encoded.length === 0) return []

    const firstNibble = (encoded[0] >> 4) & 0x0f
    const isOdd = firstNibble & 1

    const nibbles: number[] = []

    if (isOdd) {
      nibbles.push(encoded[0] & 0x0f)
    }

    for (let i = 1; i < encoded.length; i++) {
      nibbles.push((encoded[i] >> 4) & 0x0f)
      nibbles.push(encoded[i] & 0x0f)
    }

    return nibbles
  }

  /**
   * Decode RLP-encoded trie node
   */
  private decodeRLPNode(data: Hex): {
    type: 'branch' | 'leaf' | 'extension'
    children: (Hex | null)[]
    path: Uint8Array
    value: Hex
  } | null {
    const bytes = hexToBytes(data)
    const items = this.decodeRLPList(bytes)

    if (!items) return null

    if (items.length === 17) {
      // Branch node
      const children: (Hex | null)[] = []
      for (let i = 0; i < 16; i++) {
        const child = items[i]
        children.push(child.length > 0 ? bytesToHex(child) : null)
      }
      return {
        type: 'branch',
        children,
        path: new Uint8Array(0),
        value: items[16].length > 0 ? bytesToHex(items[16]) : '0x',
      }
    } else if (items.length === 2) {
      // Leaf or extension
      const path = items[0]
      const value = items[1]
      const firstNibble = (path[0] >> 4) & 0x0f
      const isLeaf = (firstNibble & 2) !== 0

      return {
        type: isLeaf ? 'leaf' : 'extension',
        children: [],
        path,
        value: bytesToHex(value),
      }
    }

    return null
  }

  /**
   * Decode RLP list
   */
  private decodeRLPList(data: Uint8Array): Uint8Array[] | null {
    if (data.length === 0) return null

    const items: Uint8Array[] = []
    let offset = 0

    // Check list prefix
    const firstByte = data[0]
    if (firstByte >= 0xc0 && firstByte <= 0xf7) {
      // Short list
      const listLen = firstByte - 0xc0
      offset = 1
      const end = offset + listLen

      while (offset < end && offset < data.length) {
        const { item, newOffset } = this.decodeRLPItem(data, offset)
        items.push(item)
        offset = newOffset
      }
    } else if (firstByte >= 0xf8) {
      // Long list
      const lenBytes = firstByte - 0xf7
      let listLen = 0
      for (let i = 0; i < lenBytes; i++) {
        listLen = (listLen << 8) | data[1 + i]
      }
      offset = 1 + lenBytes
      const end = offset + listLen

      while (offset < end && offset < data.length) {
        const { item, newOffset } = this.decodeRLPItem(data, offset)
        items.push(item)
        offset = newOffset
      }
    } else {
      return null
    }

    return items
  }

  /**
   * Decode single RLP item
   */
  private decodeRLPItem(
    data: Uint8Array,
    offset: number,
  ): { item: Uint8Array; newOffset: number } {
    const firstByte = data[offset]

    if (firstByte < 0x80) {
      // Single byte
      return { item: data.slice(offset, offset + 1), newOffset: offset + 1 }
    } else if (firstByte <= 0xb7) {
      // Short string
      const len = firstByte - 0x80
      return {
        item: data.slice(offset + 1, offset + 1 + len),
        newOffset: offset + 1 + len,
      }
    } else if (firstByte <= 0xbf) {
      // Long string
      const lenBytes = firstByte - 0xb7
      let len = 0
      for (let i = 0; i < lenBytes; i++) {
        len = (len << 8) | data[offset + 1 + i]
      }
      const start = offset + 1 + lenBytes
      return { item: data.slice(start, start + len), newOffset: start + len }
    } else if (firstByte <= 0xf7) {
      // Short list (return as-is)
      const len = firstByte - 0xc0
      return {
        item: data.slice(offset, offset + 1 + len),
        newOffset: offset + 1 + len,
      }
    } else {
      // Long list
      const lenBytes = firstByte - 0xf7
      let len = 0
      for (let i = 0; i < lenBytes; i++) {
        len = (len << 8) | data[offset + 1 + i]
      }
      const start = offset + 1 + lenBytes
      return { item: data.slice(offset, start + len), newOffset: start + len }
    }
  }

  /**
   * Compare RLP-encoded values
   */
  private compareValues(proofValue: Hex, expectedValue: Hex): boolean {
    if (proofValue === expectedValue) return true

    // Handle RLP encoding differences
    const proofBytes = hexToBytes(proofValue)

    // Decode if RLP encoded
    if (proofBytes.length > 0 && proofBytes[0] >= 0x80) {
      const decoded = this.decodeRLPItem(proofBytes, 0)
      return (
        bytesToHex(decoded.item).toLowerCase() === expectedValue.toLowerCase()
      )
    }

    return proofValue.toLowerCase() === expectedValue.toLowerCase()
  }

  /**
   * Fetch multiple account proofs in parallel
   */
  async fetchMultipleAccountProofs(
    addresses: Address[],
    storageKeysMap: Map<Address, Hex[]>,
    blockNumber: bigint,
  ): Promise<Map<Address, AccountProof>> {
    const results = new Map<Address, AccountProof>()

    // Batch requests for efficiency
    const proofPromises = addresses.map((addr) =>
      this.getAccountProof(addr, storageKeysMap.get(addr) || [], blockNumber),
    )

    const proofs = await Promise.all(proofPromises)

    for (let i = 0; i < addresses.length; i++) {
      results.set(addresses[i], proofs[i])
    }

    return results
  }

  /**
   * Fetch transaction receipt proof
   */
  async getTransactionReceiptProof(
    txHash: Hex,
    blockNumber: bigint,
  ): Promise<{ receipt: TransactionReceipt; proof: Hex[] }> {
    const block = await this.client.getBlock({
      blockNumber,
      includeTransactions: true,
    })
    if (!block) throw new Error(`Block ${blockNumber} not found`)

    // Find transaction index
    const txIndex = block.transactions.findIndex((tx) =>
      typeof tx === 'object' ? tx.hash === txHash : tx === txHash,
    )
    if (txIndex === -1)
      throw new Error(`Transaction ${txHash} not found in block`)

    // Get receipt
    const receipt = await this.client.getTransactionReceipt({ hash: txHash })

    // Build receipt trie proof
    // Note: This requires the full receipts trie which most nodes don't expose
    // In production, use a specialized archive node or indexer

    return {
      receipt: {
        status: receipt.status === 'success' ? 1 : 0,
        cumulativeGasUsed: receipt.cumulativeGasUsed,
        logsBloom: receipt.logsBloom,
        logs: receipt.logs.map((log) => ({
          address: log.address,
          topics: log.topics as Hex[],
          data: log.data,
        })),
      },
      proof: [], // Would need receipts trie proof
    }
  }

  /**
   * Get the storage slot for a mapping entry
   */
  getMappingSlot(baseSlot: bigint, key: Hex): Hex {
    return keccak256(
      concat([pad(key, { size: 32 }), pad(toHex(baseSlot), { size: 32 })]),
    )
  }

  /**
   * Get storage slots for an array
   */
  getArraySlots(baseSlot: bigint, startIndex: bigint, count: bigint): Hex[] {
    const arrayDataSlot = fromHex(
      keccak256(pad(toHex(baseSlot), { size: 32 })),
      'bigint',
    )
    const slots: Hex[] = []
    for (let i = 0n; i < count; i++) {
      slots.push(pad(toHex(arrayDataSlot + startIndex + i), { size: 32 }))
    }
    return slots
  }
}

export {
  L2_TO_L1_MESSAGE_PASSER,
  OUTPUT_ROOT_VERSION,
  L2_CROSS_DOMAIN_MESSENGER,
  L2_STANDARD_BRIDGE,
  SEQUENCER_FEE_WALLET,
  L1_BLOCK_INFO,
}
