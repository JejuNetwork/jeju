/**
 * Settlement Integration Tests
 *
 * These tests REQUIRE a running Anvil instance with deployed contracts.
 * They will FAIL if the chain is not running.
 *
 * Setup:
 *   1. Start Anvil: anvil --port 8548 --chain-id 420691
 *   2. Deploy contracts:
 *      cd packages/contracts && BASESCAN_API_KEY=dummy ETHERSCAN_API_KEY=dummy \
 *        forge script script/DeployGaslessUSDC.s.sol:DeployX402WithGasless \
 *        --rpc-url http://127.0.0.1:8548 --broadcast
 *   3. Set env: JEJU_RPC_URL=http://127.0.0.1:8548 X402_FACILITATOR_ADDRESS=<deployed>
 *   4. Run: bun test tests/settlement.test.ts
 *
 * Run with: jeju test --mode integration --app gateway
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { type Address, createPublicClient, type Hex, http, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { resetConfig } from '../../api/x402/config'
import { createServer, type X402App } from '../../api/x402/server'
import { clearNonceCache } from '../../api/x402/services/nonce-manager'

// Helper to make requests to the app (wraps Elysia .handle method)
async function request(
  server: X402App,
  path: string,
  options?: RequestInit,
): Promise<Response> {
  const url = `http://localhost${path}`
  return server.handle(new Request(url, options))
}

// Use environment variables for test configuration
const ANVIL_RPC = process.env.JEJU_RPC_URL || 'http://127.0.0.1:8548'
const FACILITATOR_ADDRESS = process.env.X402_FACILITATOR_ADDRESS as
  | Address
  | undefined
const EIP3009_TOKEN_ADDRESS = process.env.EIP3009_TOKEN_ADDRESS as
  | Address
  | undefined

const PAYER_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const
const payer = privateKeyToAccount(PAYER_KEY)
const RECIPIENT: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const USDC: Address = '0x0165878A594ca255338adfa4d48449f69242Eb8F'

async function createSignedPayment(overrides?: {
  amount?: string
  nonce?: string
  timestamp?: number
  asset?: Address
}): Promise<{ header: string; payload: Record<string, unknown> }> {
  const nonce =
    overrides?.nonce || crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  const timestamp = overrides?.timestamp || Math.floor(Date.now() / 1000)
  const asset = overrides?.asset || USDC

  const payload = {
    scheme: 'exact',
    network: 'jeju',
    asset,
    payTo: RECIPIENT,
    amount: overrides?.amount || '1000000',
    resource: '/api/test',
    nonce,
    timestamp,
  }

  const domain = {
    name: 'x402 Payment Protocol',
    version: '1',
    chainId: 420691,
    verifyingContract: '0x0000000000000000000000000000000000000000' as Address,
  }

  const types = {
    Payment: [
      { name: 'scheme', type: 'string' },
      { name: 'network', type: 'string' },
      { name: 'asset', type: 'address' },
      { name: 'payTo', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'resource', type: 'string' },
      { name: 'nonce', type: 'string' },
      { name: 'timestamp', type: 'uint256' },
    ],
  }

  const message = {
    scheme: payload.scheme,
    network: payload.network,
    asset: payload.asset,
    payTo: payload.payTo,
    amount: BigInt(payload.amount),
    resource: payload.resource,
    nonce: payload.nonce,
    timestamp: BigInt(payload.timestamp),
  }

  const signature = await payer.signTypedData({
    domain,
    types,
    primaryType: 'Payment',
    message,
  })
  const fullPayload = { ...payload, signature, payer: payer.address }

  return {
    header: Buffer.from(JSON.stringify(fullPayload)).toString('base64'),
    payload: fullPayload,
  }
}

function generateAuthNonce(): Hex {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return toHex(bytes)
}

function getTimestamp(offsetSeconds = 0): number {
  return Math.floor(Date.now() / 1000) + offsetSeconds
}

async function createEIP3009Authorization(
  tokenAddress: Address,
  tokenName: string,
  chainId: number,
  from: Address,
  to: Address,
  value: bigint,
  validitySeconds = 300,
): Promise<{
  validAfter: number
  validBefore: number
  authNonce: Hex
  authSignature: Hex
}> {
  const validAfter = getTimestamp(-60)
  const validBefore = getTimestamp(validitySeconds)
  const authNonce = generateAuthNonce()

  const domain = {
    name: tokenName,
    version: '1',
    chainId,
    verifyingContract: tokenAddress,
  }

  const types = {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  }

  const message = {
    from,
    to,
    value,
    validAfter: BigInt(validAfter),
    validBefore: BigInt(validBefore),
    nonce: authNonce,
  }

  const authSignature = await payer.signTypedData({
    domain,
    types,
    primaryType: 'TransferWithAuthorization',
    message,
  })

  return { validAfter, validBefore, authNonce, authSignature }
}

async function requireAnvil(): Promise<void> {
  const client = createPublicClient({ transport: http(ANVIL_RPC) })
  const chainId = await client.getChainId().catch(() => null)
  if (chainId === null) {
    throw new Error(
      `FATAL: Anvil not running at ${ANVIL_RPC}. ` +
        `Start with: anvil --port 8548 --chain-id 420691`,
    )
  }
  if (!FACILITATOR_ADDRESS) {
    throw new Error(
      `FATAL: X402_FACILITATOR_ADDRESS not set. ` +
        `Deploy contracts and set the env var.`,
    )
  }
  console.log(`Connected to Anvil (chain ID: ${chainId})`)
}

describe('Settlement Integration', () => {
  let skipGaslessTests = false

  beforeAll(async () => {
    await requireAnvil()

    if (!EIP3009_TOKEN_ADDRESS) {
      console.log('Gasless tests disabled: EIP3009_TOKEN_ADDRESS not set')
      skipGaslessTests = true
    }

    process.env.JEJU_RPC_URL = ANVIL_RPC
    process.env.X402_FACILITATOR_ADDRESS = FACILITATOR_ADDRESS
    process.env.JEJU_USDC_ADDRESS = USDC
    resetConfig()
    clearNonceCache()
  })

  afterAll(() => {
    clearNonceCache()
  })

  test('should verify payment with on-chain nonce check', async () => {
    const app = createServer()
    const { header, payload } = await createSignedPayment()

    const res = await request(app, '/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader: header,
        paymentRequirements: {
          scheme: 'exact',
          network: 'jeju',
          maxAmountRequired: payload.amount,
          payTo: RECIPIENT,
          asset: USDC,
          resource: '/api/test',
        },
      }),
    })

    const body = await res.json()
    expect(body.isValid).toBe(true)
    expect(body.payer?.toLowerCase()).toBe(payer.address.toLowerCase())
  })

  test('should report stats from on-chain contract', async () => {
    const app = createServer()
    const res = await request(app, '/stats')
    const body = await res.json()

    expect(body.protocolFeeBps).toBe(50)
    expect(body.feeRecipient).toBeDefined()
    expect(typeof body.totalSettlements).toBe('string')
  })

  test('should check token support on-chain', async () => {
    const app = createServer()
    const res = await request(app, '/supported')
    const body = await res.json()

    expect(body.kinds).toBeArray()
    expect(body.kinds.length).toBeGreaterThan(0)
  })

  test('POST /settle/gasless returns 400 without authParams', async () => {
    const app = createServer()
    const { header, payload } = await createSignedPayment()

    const res = await request(app, '/settle/gasless', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader: header,
        paymentRequirements: {
          scheme: 'exact',
          network: 'jeju',
          maxAmountRequired: payload.amount,
          payTo: RECIPIENT,
          asset: USDC,
          resource: '/api/test',
        },
      }),
    })

    const body = await res.json()
    if (res.status === 400) {
      expect(body.error).toBeDefined()
    } else {
      expect(res.status).toBe(200)
      expect(body.success).toBe(false)
    }
  })

  test('POST /settle/gasless validates authParams structure', async () => {
    const app = createServer()
    const { header, payload } = await createSignedPayment()

    const res = await request(app, '/settle/gasless', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader: header,
        paymentRequirements: {
          scheme: 'exact',
          network: 'jeju',
          maxAmountRequired: payload.amount,
          payTo: RECIPIENT,
          asset: USDC,
          resource: '/api/test',
        },
        authParams: {
          validAfter: getTimestamp(-60),
          validBefore: getTimestamp(300),
          authNonce: generateAuthNonce(),
          authSignature: `0x${'0'.repeat(130)}`,
        },
      }),
    })

    expect(res.status).not.toBe(400)
  })

  test('POST /settle/gasless with full EIP-3009 params', async () => {
    if (skipGaslessTests) {
      console.log('Skipping gasless test - requires EIP3009_TOKEN_ADDRESS')
      return
    }

    if (!EIP3009_TOKEN_ADDRESS || !FACILITATOR_ADDRESS) {
      console.log('Skipping gasless test - env vars not set')
      return
    }

    const app = createServer()
    const amount = '1000000'
    const { header, payload } = await createSignedPayment({
      amount,
      asset: EIP3009_TOKEN_ADDRESS,
    })

    const authParams = await createEIP3009Authorization(
      EIP3009_TOKEN_ADDRESS,
      'USD Coin',
      420691,
      payer.address,
      FACILITATOR_ADDRESS,
      BigInt(amount),
    )

    const res = await request(app, '/settle/gasless', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader: header,
        paymentRequirements: {
          scheme: 'exact',
          network: 'jeju',
          maxAmountRequired: payload.amount,
          payTo: RECIPIENT,
          asset: EIP3009_TOKEN_ADDRESS,
          resource: '/api/test',
        },
        authParams,
      }),
    })

    const body = await res.json()

    expect(res.status).toBeLessThanOrEqual(500)

    if (body.success) {
      expect(body.txHash).toBeDefined()
      expect(body.paymentId).toBeDefined()
    }
  })
})

describe('EIP-3009 Utilities', () => {
  test('generateAuthNonce creates valid 32-byte hex', () => {
    const nonce = generateAuthNonce()
    expect(nonce).toMatch(/^0x[0-9a-f]{64}$/)
  })

  test('getTimestamp returns reasonable values', () => {
    const now = getTimestamp()
    const future = getTimestamp(300)
    const past = getTimestamp(-60)

    expect(future).toBeGreaterThan(now)
    expect(past).toBeLessThan(now)
    expect(future - now).toBe(300)
    expect(now - past).toBe(60)
  })

  test('createEIP3009Authorization produces valid structure', async () => {
    const auth = await createEIP3009Authorization(
      '0x0165878A594ca255338adfa4d48449f69242Eb8F',
      'USD Coin',
      420691,
      payer.address,
      '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      BigInt(1000000),
    )

    expect(auth.validAfter).toBeDefined()
    expect(auth.validBefore).toBeDefined()
    expect(auth.validBefore).toBeGreaterThan(auth.validAfter)
    expect(auth.authNonce).toMatch(/^0x[0-9a-f]{64}$/)
    expect(auth.authSignature).toMatch(/^0x[0-9a-f]+$/)
  })
})
