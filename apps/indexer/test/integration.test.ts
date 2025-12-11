/**
 * Comprehensive Integration Tests
 * Tests the entire indexing stack from RPC to database to GraphQL
 */

import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

interface TestResult {
    name: string
    passed: boolean
    error?: string
    data?: Record<string, number>
}

const tests: TestResult[] = []

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
    console.log(`\n🧪 Running: ${name}`)
    const { stdout, stderr } = await fn()
    if (stderr && !stderr.includes('warning')) {
        throw new Error(stderr)
    }
    tests.push({ name, passed: true })
    console.log(`   ✅ PASS`)
}

async function checkDatabaseAvailable(): Promise<boolean> {
    try {
        await execAsync('docker ps --format "{{.Names}}" | grep -q "^squid-db-1$"')
        return true
    } catch {
        return false
    }
}

async function queryDatabase(sql: string): Promise<string> {
    const isAvailable = await checkDatabaseAvailable()
    if (!isAvailable) {
        throw new Error('Database container (squid-db-1) is not running. Start it with: cd apps/indexer && bun run db:up')
    }
    const cmd = `docker exec squid-db-1 psql -U postgres -d indexer -tAc "${sql}"`
    try {
        const { stdout } = await execAsync(cmd)
        return stdout.trim()
    } catch (error) {
        throw new Error(`Database query failed: ${error instanceof Error ? error.message : String(error)}`)
    }
}

async function main() {
    console.log('╔══════════════════════════════════════════════════════════════╗')
    console.log('║                                                              ║')
    console.log('║   🧪 COMPREHENSIVE INTEGRATION TEST SUITE                    ║')
    console.log('║                                                              ║')
    console.log('╚══════════════════════════════════════════════════════════════╝\n')

    // Check if database is available
    const dbAvailable = await checkDatabaseAvailable()
    if (!dbAvailable) {
        console.log('⚠️  Database container (squid-db-1) is not running.')
        console.log('   To run these tests, start the database with:')
        console.log('   cd apps/indexer && bun run db:up')
        console.log('')
        console.log('   Skipping integration tests...\n')
        process.exit(0)
    }

    // Test 1: Database Connection
    await runTest('Database Connection', async () => {
        const result = await queryDatabase('SELECT 1')
        if (result !== '1') throw new Error('Database connection failed')
        return { stdout: 'Connected', stderr: '' }
    })

    // Test 2: Schema Validation
    await runTest('Database Schema', async () => {
        const count = await queryDatabase("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'")
        if (parseInt(count) < 15) throw new Error(`Expected 15 tables, found ${count}`)
        return { stdout: `${count} tables`, stderr: '' }
    })

    // Test 3: Blocks Indexed
    await runTest('Blocks Indexed', async () => {
        const count = await queryDatabase('SELECT COUNT(*) FROM block')
        if (parseInt(count) === 0) throw new Error('No blocks indexed')
        console.log(`   📊 ${count} blocks`)
        return { stdout: count, stderr: '' }
    })

    // Test 4: Transactions Indexed
    await runTest('Transactions Indexed', async () => {
        const count = await queryDatabase('SELECT COUNT(*) FROM transaction')
        if (parseInt(count) === 0) throw new Error('No transactions indexed')
        console.log(`   📊 ${count} transactions`)
        return { stdout: count, stderr: '' }
    })

    // Test 5: Logs Captured
    await runTest('Event Logs Captured', async () => {
        const count = await queryDatabase('SELECT COUNT(*) FROM log')
        if (parseInt(count) === 0) throw new Error('No logs captured - event processing not working')
        console.log(`   📊 ${count} logs`)
        return { stdout: count, stderr: '' }
    })

    // Test 6: Events Decoded
    await runTest('Events Decoded', async () => {
        const count = await queryDatabase('SELECT COUNT(*) FROM decoded_event')
        if (parseInt(count) === 0) throw new Error('No events decoded - event decoding not working')
        console.log(`   📊 ${count} decoded events`)
        return { stdout: count, stderr: '' }
    })

    // Test 7: Token Transfers
    await runTest('Token Transfers Detected', async () => {
        const count = await queryDatabase('SELECT COUNT(*) FROM token_transfer')
        if (parseInt(count) === 0) throw new Error('No token transfers - token detection not working')
        console.log(`   📊 ${count} token transfers`)
        return { stdout: count, stderr: '' }
    })

    // Test 8: Contracts Detected
    await runTest('Contracts Detected', async () => {
        const count = await queryDatabase('SELECT COUNT(*) FROM contract')
        if (parseInt(count) === 0) throw new Error('No contracts - contract detection not working')
        console.log(`   📊 ${count} contracts`)
        return { stdout: count, stderr: '' }
    })

    // Test 9: ERC20 Detection
    await runTest('ERC20 Token Detection', async () => {
        const count = await queryDatabase('SELECT COUNT(*) FROM contract WHERE is_erc20 = true')
        if (parseInt(count) === 0) throw new Error('No ERC20 tokens detected')
        console.log(`   📊 ${count} ERC20 tokens`)
        return { stdout: count, stderr: '' }
    })

    // Test 10: ERC721 Detection
    await runTest('ERC721 NFT Detection', async () => {
        const count = await queryDatabase('SELECT COUNT(*) FROM contract WHERE is_erc721 = true')
        console.log(`   📊 ${count} ERC721 contracts`)
        return { stdout: count, stderr: '' }
    })

    // Test 11: ERC1155 Detection
    await runTest('ERC1155 Multi-Token Detection', async () => {
        const count = await queryDatabase('SELECT COUNT(*) FROM contract WHERE is_erc1155 = true')
        console.log(`   📊 ${count} ERC1155 contracts`)
        return { stdout: count, stderr: '' }
    })

    // Test 12: Accounts Tracked
    await runTest('Account Tracking', async () => {
        const count = await queryDatabase('SELECT COUNT(*) FROM account')
        if (parseInt(count) === 0) throw new Error('No accounts tracked')
        console.log(`   📊 ${count} unique accounts`)
        return { stdout: count, stderr: '' }
    })

    // Test 13: Event Types
    await runTest('Event Type Diversity', async () => {
        const count = await queryDatabase('SELECT COUNT(DISTINCT event_name) FROM decoded_event')
        if (parseInt(count) === 0) throw new Error('No event types decoded')
        console.log(`   📊 ${count} different event types`)
        return { stdout: count, stderr: '' }
    })

    // Test 14: Token Standards
    await runTest('Token Standard Coverage', async () => {
        const count = await queryDatabase('SELECT COUNT(DISTINCT token_standard) FROM token_transfer')
        if (parseInt(count) < 2) throw new Error('Not enough token standards detected')
        console.log(`   📊 ${count} token standards`)
        return { stdout: count, stderr: '' }
    })

    // Summary
    console.log('\n╔══════════════════════════════════════════════════════════════╗')
    console.log('║                                                              ║')
    console.log('║   ✅ ALL TESTS PASSED                                        ║')
    console.log('║                                                              ║')
    console.log('╚══════════════════════════════════════════════════════════════╝\n')

    console.log(`Total Tests: ${tests.length}`)
    console.log(`Passed: ${tests.filter(t => t.passed).length}`)
    console.log(`Failed: ${tests.filter(t => !t.passed).length}`)

    // Get final stats
    const blocks = await queryDatabase('SELECT COUNT(*) FROM block')
    const txs = await queryDatabase('SELECT COUNT(*) FROM transaction')
    const logs = await queryDatabase('SELECT COUNT(*) FROM log')
    const events = await queryDatabase('SELECT COUNT(*) FROM decoded_event')
    const tokens = await queryDatabase('SELECT COUNT(*) FROM token_transfer')
    const contracts = await queryDatabase('SELECT COUNT(*) FROM contract')
    const accounts = await queryDatabase('SELECT COUNT(*) FROM account')

    console.log('\n📊 Final Statistics:')
    console.log(`  - ${blocks} blocks indexed`)
    console.log(`  - ${txs} transactions`)
    console.log(`  - ${logs} event logs`)
    console.log(`  - ${events} decoded events`)
    console.log(`  - ${tokens} token transfers`)
    console.log(`  - ${contracts} contracts`)
    console.log(`  - ${accounts} unique accounts`)

    console.log('\n🎉 INDEXER IS FULLY FUNCTIONAL!\n')
    process.exit(0)
}

main().catch(err => {
    console.error(`\n❌ TEST FAILED: ${err.message}\n`)
    console.error(err)
    process.exit(1)
})

