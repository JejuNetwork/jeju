#!/usr/bin/env tsx

// @ts-nocheck - Migration script with optional AWS/IPFS dependencies
/**
 * S3 to DWS Storage Migration Script
 *
 * Migrates data from AWS S3 buckets to DWS decentralized storage (IPFS + Arweave)
 * and registers content hashes in the StorageManager contract.
 *
 * Usage:
 *   npx tsx scripts/migrate/s3-to-dws.ts --bucket <bucket-name> --dry-run
 *   npx tsx scripts/migrate/s3-to-dws.ts --bucket <bucket-name> --execute
 *   npx tsx scripts/migrate/s3-to-dws.ts --all --execute
 *
 * Prerequisites:
 *   bun add @aws-sdk/client-s3 ipfs-http-client
 */

import {
  createWriteStream,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import {
  GetObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3'
import { create as createIpfsClient } from 'ipfs-http-client'
import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

// Configuration
const CONFIG = {
  // S3
  s3Region: process.env.AWS_REGION || 'us-east-1',

  // IPFS
  ipfsApiUrl: process.env.IPFS_API_URL || 'http://localhost:5001',
  ipfsGateway: process.env.IPFS_GATEWAY || 'http://localhost:8080',

  // Arweave (for permanent storage)
  arweaveGateway: process.env.ARWEAVE_GATEWAY || 'https://arweave.net',
  arweaveWalletPath: process.env.ARWEAVE_WALLET_PATH,

  // Jeju L2
  rpcUrl: process.env.JEJU_RPC_URL || 'https://testnet-rpc.jejunetwork.org',
  privateKey: process.env.PRIVATE_KEY,

  // Contracts
  storageManagerAddress: process.env.STORAGE_MANAGER_ADDRESS,

  // Migration settings
  batchSize: 100,
  permanentStorageThreshold: 1024 * 1024 * 10, // 10MB - files larger than this get permanent storage
}

// StorageManager ABI (partial)
const STORAGE_MANAGER_ABI = [
  {
    name: 'storeContent',
    type: 'function',
    inputs: [
      { name: 'contentHash', type: 'bytes32' },
      { name: 'ipfsCid', type: 'string' },
      { name: 'size', type: 'uint256' },
      { name: 'permanent', type: 'bool' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'storeBatch',
    type: 'function',
    inputs: [
      { name: 'contentHashes', type: 'bytes32[]' },
      { name: 'ipfsCids', type: 'string[]' },
      { name: 'sizes', type: 'uint256[]' },
      { name: 'permanent', type: 'bool' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

interface MigrationRecord {
  s3Key: string
  s3Bucket: string
  size: number
  ipfsCid: string
  arweaveTxId?: string
  contentHash: string
  migratedAt: string
  permanent: boolean
}

interface MigrationState {
  startedAt: string
  completedAt?: string
  bucket: string
  totalObjects: number
  migratedObjects: number
  failedObjects: number
  records: MigrationRecord[]
  errors: Array<{ key: string; error: string }>
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const execute = args.includes('--execute')
  const allBuckets = args.includes('--all')
  const bucketArg = args.find((a) => a.startsWith('--bucket='))
  const bucket = bucketArg?.split('=')[1]
  const resumeArg = args.find((a) => a.startsWith('--resume='))
  const resumeFile = resumeArg?.split('=')[1]

  if (!dryRun && !execute) {
    console.error('Error: Specify --dry-run or --execute')
    process.exit(1)
  }

  if (!bucket && !allBuckets) {
    console.error('Error: Specify --bucket=<name> or --all')
    process.exit(1)
  }

  console.log('='.repeat(60))
  console.log('S3 to DWS Storage Migration')
  console.log('='.repeat(60))
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'EXECUTE'}`)
  console.log(`Target: ${allBuckets ? 'All buckets' : bucket}`)
  console.log('')

  // Initialize clients
  const s3 = new S3Client({ region: CONFIG.s3Region })
  const ipfs = createIpfsClient({ url: CONFIG.ipfsApiUrl })

  // biome-ignore lint/suspicious/noImplicitAnyLet: Migration script with optional deps
  let walletClient
  // biome-ignore lint/suspicious/noImplicitAnyLet: Migration script with optional deps
  let publicClient
  if (execute && CONFIG.privateKey && CONFIG.storageManagerAddress) {
    const account = privateKeyToAccount(CONFIG.privateKey as `0x${string}`)
    publicClient = createPublicClient({
      transport: http(CONFIG.rpcUrl),
    })
    walletClient = createWalletClient({
      account,
      transport: http(CONFIG.rpcUrl),
    })
    console.log(`Wallet: ${account.address}`)
    console.log(`StorageManager: ${CONFIG.storageManagerAddress}`)
  }

  // Get buckets to migrate
  let bucketsToMigrate: string[] = []
  if (allBuckets) {
    const listBuckets = await s3.send(new ListBucketsCommand({}))
    bucketsToMigrate =
      // biome-ignore lint/style/noNonNullAssertion: Name exists when Bucket exists
      listBuckets.Buckets?.map((b) => b.Name!).filter(Boolean) || []
    console.log(`Found ${bucketsToMigrate.length} buckets`)
  } else if (bucket) {
    bucketsToMigrate = [bucket]
  }

  // Process each bucket
  for (const bucketName of bucketsToMigrate) {
    console.log('')
    console.log('-'.repeat(60))
    console.log(`Migrating bucket: ${bucketName}`)
    console.log('-'.repeat(60))

    // Load or create migration state
    const stateFile = `migration-state-${bucketName}.json`
    let state: MigrationState

    if (resumeFile && existsSync(resumeFile)) {
      state = JSON.parse(readFileSync(resumeFile, 'utf-8'))
      console.log(`Resuming migration from ${resumeFile}`)
      console.log(`  Migrated: ${state.migratedObjects}/${state.totalObjects}`)
    } else {
      state = {
        startedAt: new Date().toISOString(),
        bucket: bucketName,
        totalObjects: 0,
        migratedObjects: 0,
        failedObjects: 0,
        records: [],
        errors: [],
      }
    }

    // List all objects in bucket
    let continuationToken: string | undefined
    const objects: Array<{ Key: string; Size: number }> = []

    do {
      const listCommand = new ListObjectsV2Command({
        Bucket: bucketName,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      })
      const response = await s3.send(listCommand)

      if (response.Contents) {
        for (const obj of response.Contents) {
          if (obj.Key && obj.Size !== undefined) {
            objects.push({ Key: obj.Key, Size: obj.Size })
          }
        }
      }

      continuationToken = response.NextContinuationToken
    } while (continuationToken)

    state.totalObjects = objects.length
    console.log(`Found ${objects.length} objects`)

    // Skip already migrated objects
    const migratedKeys = new Set(state.records.map((r) => r.s3Key))
    const objectsToMigrate = objects.filter((o) => !migratedKeys.has(o.Key))
    console.log(`Objects to migrate: ${objectsToMigrate.length}`)

    if (dryRun) {
      console.log('\n[DRY RUN] Would migrate:')
      for (const obj of objectsToMigrate.slice(0, 20)) {
        console.log(`  ${obj.Key} (${formatBytes(obj.Size)})`)
      }
      if (objectsToMigrate.length > 20) {
        console.log(`  ... and ${objectsToMigrate.length - 20} more`)
      }
      continue
    }

    // Migrate objects in batches
    const batches: MigrationRecord[][] = []
    let currentBatch: MigrationRecord[] = []

    for (let i = 0; i < objectsToMigrate.length; i++) {
      const obj = objectsToMigrate[i]
      console.log(`[${i + 1}/${objectsToMigrate.length}] Migrating: ${obj.Key}`)

      try {
        // Download from S3
        const getCommand = new GetObjectCommand({
          Bucket: bucketName,
          Key: obj.Key,
        })
        const response = await s3.send(getCommand)

        if (!response.Body) {
          throw new Error('Empty response body')
        }

        // Save to temp file
        const tempPath = join(tmpdir(), `s3-migrate-${Date.now()}`)
        const writeStream = createWriteStream(tempPath)
        await pipeline(response.Body as NodeJS.ReadableStream, writeStream)

        // Upload to IPFS
        const fileContent = readFileSync(tempPath)
        const ipfsResult = await ipfs.add(fileContent, {
          pin: true,
          cidVersion: 1,
        })
        const ipfsCid = ipfsResult.cid.toString()

        // Calculate content hash
        const crypto = await import('node:crypto')
        const contentHash = `0x${crypto.createHash('sha256').update(fileContent).digest('hex')}`

        // Determine if permanent storage needed
        const permanent = obj.Size >= CONFIG.permanentStorageThreshold

        // Upload to Arweave if permanent
        let arweaveTxId: string | undefined
        if (permanent && CONFIG.arweaveWalletPath) {
          // TODO: Implement Arweave upload
          console.log(`  Would upload to Arweave for permanent storage`)
        }

        const record: MigrationRecord = {
          s3Key: obj.Key,
          s3Bucket: bucketName,
          size: obj.Size,
          ipfsCid,
          arweaveTxId,
          contentHash,
          migratedAt: new Date().toISOString(),
          permanent,
        }

        state.records.push(record)
        state.migratedObjects++
        currentBatch.push(record)

        console.log(`  IPFS CID: ${ipfsCid}`)
        console.log(`  Content Hash: ${contentHash}`)

        // Batch on-chain registration
        if (currentBatch.length >= CONFIG.batchSize) {
          batches.push(currentBatch)
          currentBatch = []
        }

        // Clean up temp file
        const fs = await import('node:fs/promises')
        await fs.unlink(tempPath)
      } catch (error) {
        console.error(`  ERROR: ${error}`)
        state.errors.push({
          key: obj.Key,
          error: String(error),
        })
        state.failedObjects++
      }

      // Save state periodically
      if (state.migratedObjects % 10 === 0) {
        writeFileSync(stateFile, JSON.stringify(state, null, 2))
      }
    }

    // Push remaining batch
    if (currentBatch.length > 0) {
      batches.push(currentBatch)
    }

    // Register on-chain
    if (
      execute &&
      walletClient &&
      publicClient &&
      CONFIG.storageManagerAddress
    ) {
      console.log('\nRegistering content on-chain...')

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i]
        console.log(`Batch ${i + 1}/${batches.length} (${batch.length} items)`)

        try {
          const contentHashes = batch.map((r) => r.contentHash as `0x${string}`)
          const ipfsCids = batch.map((r) => r.ipfsCid)
          const sizes = batch.map((r) => BigInt(r.size))
          const permanent = batch.some((r) => r.permanent)

          const hash = await walletClient.writeContract({
            address: CONFIG.storageManagerAddress as `0x${string}`,
            abi: STORAGE_MANAGER_ABI,
            functionName: 'storeBatch',
            args: [contentHashes, ipfsCids, sizes, permanent],
          })

          console.log(`  TX: ${hash}`)
          await publicClient.waitForTransactionReceipt({ hash })
          console.log(`  Confirmed`)
        } catch (error) {
          console.error(`  Batch registration failed: ${error}`)
        }
      }
    }

    // Save final state
    state.completedAt = new Date().toISOString()
    writeFileSync(stateFile, JSON.stringify(state, null, 2))

    console.log('')
    console.log('Migration Summary:')
    console.log(`  Total Objects: ${state.totalObjects}`)
    console.log(`  Migrated: ${state.migratedObjects}`)
    console.log(`  Failed: ${state.failedObjects}`)
    console.log(`  State saved to: ${stateFile}`)
  }

  console.log('')
  console.log('='.repeat(60))
  console.log('Migration Complete')
  console.log('='.repeat(60))
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`
}

main().catch(console.error)
