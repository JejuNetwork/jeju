#!/usr/bin/env bun
/**
 * Start the local JNS Gateway for development
 * This allows routing via *.local.jejunetwork.org subdomains
 */

import type { Address } from 'viem'
import { startLocalJNSGateway } from '../src/lib/jns-gateway-local'
import { findMonorepoRoot } from '../src/lib/system'

const rootDir = findMonorepoRoot()

// Use a dummy registry address since we're falling back to local files
// In production, this would be the actual JNS Registry contract address
const dummyRegistry: Address = '0x0000000000000000000000000000000000000000'
const rpcUrl = process.env.RPC_URL ?? 'http://127.0.0.1:6545'
const port = Number(process.env.JNS_GATEWAY_PORT ?? '4303')
const ipfsPort = Number(process.env.IPFS_GATEWAY_PORT ?? '4180')

console.log('Starting JNS Gateway...')
console.log(`  Root directory: ${rootDir}`)
console.log(`  RPC URL: ${rpcUrl}`)
console.log(`  Port: ${port}`)
console.log(`  IPFS Gateway Port: ${ipfsPort}`)

await startLocalJNSGateway(rpcUrl, dummyRegistry, port, ipfsPort, rootDir)

console.log(`JNS Gateway running on port ${port}`)
console.log('Access apps via: http://<app>.local.jejunetwork.org:${port}/')
console.log('  - babylon.local.jejunetwork.org')
console.log('  - gateway.local.jejunetwork.org')
console.log('  - bazaar.local.jejunetwork.org')

// Keep running
await new Promise(() => {})
