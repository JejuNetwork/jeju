#!/usr/bin/env bun
/**
 * Test script for Dstack TEE simulator
 * 
 * This script verifies that the Dstack simulator is working correctly
 * and can be used for development without TDX hardware.
 * 
 * The simulator uses Unix sockets, so we mount them to a host directory.
 * 
 * Usage:
 *   bun run scripts/test-dstack-simulator.ts
 */

import { $ } from 'bun'
import { existsSync } from 'fs'

const SIMULATOR_IMAGE = 'lilhammer/dstack-simulator:latest'
const CONTAINER_NAME = 'jeju-dstack-simulator'
const SOCKET_DIR = '/tmp/dstack-sockets'

interface SimulatorTestResult {
  success: boolean
  message: string
  data?: Record<string, unknown>
}

async function checkDockerAvailable(): Promise<boolean> {
  try {
    await $`docker --version`.quiet()
    return true
  } catch {
    return false
  }
}

async function isSimulatorRunning(): Promise<boolean> {
  try {
    const result = await $`docker ps --filter name=${CONTAINER_NAME} --format "{{.Names}}"`.text()
    return result.trim() === CONTAINER_NAME
  } catch {
    return false
  }
}

async function startSimulator(): Promise<SimulatorTestResult> {
  console.log('Starting Dstack simulator...')
  
  // Stop any existing container
  try {
    await $`docker stop ${CONTAINER_NAME}`.quiet()
    await $`docker rm ${CONTAINER_NAME}`.quiet()
  } catch {
    // Container might not exist, that's fine
  }

  // Start the simulator with socket volume mount
  try {
    await $`docker run -d \
      --name ${CONTAINER_NAME} \
      -v ${SOCKET_DIR}:/app/sockets \
      ${SIMULATOR_IMAGE}`.quiet()
    
    // Wait for sockets to be ready
    console.log('Waiting for simulator sockets to be ready...')
    for (let i = 0; i < 10; i++) {
      await new Promise(resolve => setTimeout(resolve, 500))
      if (existsSync(`${SOCKET_DIR}/dstack.sock`)) {
        break
      }
    }
    
    if (!existsSync(`${SOCKET_DIR}/dstack.sock`)) {
      return { success: false, message: 'Simulator sockets did not become ready' }
    }
    
    return { success: true, message: 'Simulator started successfully' }
  } catch (error) {
    return { 
      success: false, 
      message: `Failed to start simulator: ${error}` 
    }
  }
}

async function testQuoteEndpoint(): Promise<SimulatorTestResult> {
  console.log('Testing GetQuote endpoint via Unix socket...')
  
  try {
    const result = await $`curl --unix-socket ${SOCKET_DIR}/dstack.sock 'http://./GetQuote?report_data=0x1234deadbeef' 2>/dev/null`.text()
    
    const data = JSON.parse(result) as Record<string, unknown>
    
    if (!data.quote) {
      return { 
        success: false, 
        message: 'GetQuote response missing quote field',
        data 
      }
    }
    
    return { 
      success: true, 
      message: 'GetQuote working correctly',
      data: {
        quoteLength: (data.quote as string).length,
        hasEventLog: 'event_log' in data,
        reportData: data.report_data
      }
    }
  } catch (error) {
    return { 
      success: false, 
      message: `GetQuote request failed: ${error}` 
    }
  }
}

async function testDeriveKeyEndpoint(): Promise<SimulatorTestResult> {
  console.log('Testing DeriveKey endpoint via Unix socket (tappd.sock)...')
  
  try {
    // DeriveKey uses the tappd.sock socket with prpc path
    const result = await $`curl --unix-socket ${SOCKET_DIR}/tappd.sock -X POST 'http://./prpc/Tappd.DeriveKey' -H 'Content-Type: application/json' -d '{"path":"/test/signing"}' 2>/dev/null`.text()
    
    const data = JSON.parse(result) as Record<string, unknown>
    
    if (!data.key) {
      return { 
        success: false, 
        message: 'DeriveKey response missing key field',
        data 
      }
    }
    
    return { 
      success: true, 
      message: 'DeriveKey working correctly',
      data: {
        hasKey: true,
        hasCertChain: 'certificate_chain' in data,
        certChainLength: Array.isArray(data.certificate_chain) ? (data.certificate_chain as string[]).length : 0
      }
    }
  } catch (error) {
    return { 
      success: false, 
      message: `DeriveKey request failed: ${error}` 
    }
  }
}

async function testSocketsExist(): Promise<SimulatorTestResult> {
  console.log('Checking Unix sockets...')
  
  const sockets = ['dstack.sock', 'tappd.sock', 'external.sock', 'guest.sock']
  const foundSockets: string[] = []
  
  for (const sock of sockets) {
    if (existsSync(`${SOCKET_DIR}/${sock}`)) {
      foundSockets.push(sock)
    }
  }
  
  if (foundSockets.length === sockets.length) {
    return {
      success: true,
      message: 'All Unix sockets present',
      data: { sockets: foundSockets }
    }
  }
  
  return {
    success: false,
    message: `Missing sockets. Found: ${foundSockets.join(', ')}`,
    data: { found: foundSockets, expected: sockets }
  }
}

async function stopSimulator(): Promise<void> {
  console.log('Stopping simulator...')
  try {
    await $`docker stop ${CONTAINER_NAME}`.quiet()
    await $`docker rm ${CONTAINER_NAME}`.quiet()
  } catch {
    // Ignore errors during cleanup
  }
}

async function main() {
  console.log('=== Dstack Simulator Test ===\n')
  console.log(`Socket directory: ${SOCKET_DIR}\n`)
  
  // Check Docker
  if (!await checkDockerAvailable()) {
    console.error('Docker is not available. Please install Docker first.')
    process.exit(1)
  }
  console.log('Docker is available.\n')

  // Check if simulator is already running
  const alreadyRunning = await isSimulatorRunning()
  let startedByUs = false
  
  if (!alreadyRunning) {
    const startResult = await startSimulator()
    if (!startResult.success) {
      console.error(startResult.message)
      process.exit(1)
    }
    startedByUs = true
    console.log(startResult.message + '\n')
  } else {
    console.log('Simulator already running.\n')
  }

  // Run tests
  const results: SimulatorTestResult[] = []
  
  results.push(await testSocketsExist())
  results.push(await testQuoteEndpoint())
  results.push(await testDeriveKeyEndpoint())

  // Print results
  console.log('\n=== Test Results ===\n')
  
  let allPassed = true
  for (const result of results) {
    const status = result.success ? '✅' : '❌'
    console.log(`${status} ${result.message}`)
    if (result.data) {
      console.log(`   Data: ${JSON.stringify(result.data)}`)
    }
    if (!result.success) allPassed = false
  }

  // Cleanup if we started the simulator
  if (startedByUs && process.env.KEEP_SIMULATOR !== 'true') {
    console.log('\n')
    await stopSimulator()
  } else if (startedByUs) {
    console.log('\nSimulator left running (KEEP_SIMULATOR=true)')
  }

  console.log('\n=== Summary ===')
  if (allPassed) {
    console.log('All tests passed. Dstack simulator is working correctly.')
    console.log('\nTo use the simulator for development:')
    console.log(`  export DSTACK_SOCKET=${SOCKET_DIR}/dstack.sock`)
    console.log('  export DSTACK_SIMULATOR=true')
    console.log('\nOr keep the simulator running with:')
    console.log('  KEEP_SIMULATOR=true bun run scripts/test-dstack-simulator.ts')
  } else {
    console.log('Some tests failed. Please check the simulator logs:')
    console.log(`  docker logs ${CONTAINER_NAME}`)
    process.exit(1)
  }
}

main().catch(console.error)

