import { treaty } from '@elysiajs/eden'
import { getServiceUrl } from '@jejunetwork/config'
import { Elysia, t } from 'elysia'
import type { Address, Hex } from 'viem'
import type { JNSRecords } from '../../lib/schemas'
import {
  jnsAvailableResponseSchema,
  jnsPriceResponseSchema,
  jnsRecordsSchema,
  jnsRegisterResponseSchema,
  jnsResolveResponseSchema,
  parseJsonResponse,
  txHashResponseSchema,
} from '../../lib/schemas'
import { normalizeJNSName } from '../../lib/utils'
import { expectValid } from '../utils/validation'

const GATEWAY_API = process.env.GATEWAY_API || getServiceUrl('gateway', 'jns') || 'http://localhost:4020'
const JNS_NAME = process.env.JNS_NAME || 'todo.jeju'
const JNS_TIMEOUT = 10000

export class JNSError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message)
    this.name = 'JNSError'
  }
}

export class JNSNotFoundError extends JNSError {
  constructor(message: string) {
    super(message, 404)
    this.name = 'JNSNotFoundError'
  }
}

const jnsAppDef = new Elysia()
  .get('/jns/available/:name', () => ({ available: true }))
  .post('/jns/register', () => ({ txHash: '', name: '' }), {
    body: t.Object({
      name: t.String(),
      owner: t.String(),
      durationYears: t.Number(),
      price: t.String(),
    }),
  })
  .get('/jns/records/:name', () => ({}) as JNSRecords)
  .post('/jns/records/:name', () => ({ txHash: '' }))
  .get('/jns/resolve/:name', () => ({ address: '' }))
  .get('/jns/price/:name', () => ({ price: '' }))
  .get('/health', () => ({ status: 'ok' as const }))

type JNSApp = typeof jnsAppDef

interface JNSService {
  isNameAvailable(name: string): Promise<boolean>
  register(
    name: string,
    owner: Address,
    durationYears: number,
  ): Promise<{ txHash: Hex; name: string }>
  setRecords(name: string, records: JNSRecords): Promise<{ txHash: Hex }>
  getRecords(name: string): Promise<JNSRecords>
  resolve(name: string): Promise<Address | null>
  getRegistrationPrice(name: string, durationYears: number): Promise<bigint>
}

class JNSServiceImpl implements JNSService {
  private client: ReturnType<typeof treaty<JNSApp>>
  private baseUrl: string

  constructor() {
    this.baseUrl = GATEWAY_API
    this.client = treaty<JNSApp>(GATEWAY_API, {
      fetch: { signal: AbortSignal.timeout(JNS_TIMEOUT) },
    })
  }

  async isNameAvailable(name: string): Promise<boolean> {
    const normalized = normalizeJNSName(name)
    const { data, error } = await this.client.jns
      .available({ name: normalized })
      .get()
    if (error)
      throw new JNSError(`JNS availability check failed: ${error}`, 500)
    expectValid(jnsAvailableResponseSchema, data, 'JNS available response')
    return data?.available ?? false
  }

  async register(
    name: string,
    owner: Address,
    durationYears: number,
  ): Promise<{ txHash: Hex; name: string }> {
    const normalized = normalizeJNSName(name)
    const price = await this.getRegistrationPrice(name, durationYears)

    const { data, error } = await this.client.jns.register.post({
      name: normalized,
      owner,
      durationYears,
      price: price.toString(),
    })

    if (error) throw new JNSError(`JNS register failed: ${error}`, 500)
    const validated = expectValid(
      jnsRegisterResponseSchema,
      data,
      'JNS register response',
    )
    return { txHash: validated.txHash, name: normalized }
  }

  async setRecords(
    name: string,
    records: JNSRecords,
  ): Promise<{ txHash: Hex }> {
    const normalized = normalizeJNSName(name)

    // Eden has trouble with dynamic path params, use fetch for this
    const response = await fetch(
      `${this.baseUrl}/jns/records/${encodeURIComponent(normalized)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(records),
        signal: AbortSignal.timeout(JNS_TIMEOUT),
      },
    )

    if (!response.ok) {
      throw new JNSError(
        `JNS set records failed: ${response.status}`,
        response.status,
      )
    }

    const validated = await parseJsonResponse(
      response,
      txHashResponseSchema,
      'JNS set records response',
    )
    return { txHash: validated.txHash }
  }

  async getRecords(name: string): Promise<JNSRecords> {
    const normalized = normalizeJNSName(name)
    const { data, error } = await this.client.jns
      .records({ name: normalized })
      .get()

    if (error) {
      if (String(error).includes('404')) {
        return {}
      }
      throw new JNSError(`JNS get records failed: ${error}`, 500)
    }

    return expectValid(jnsRecordsSchema, data, 'JNS records response')
  }

  async resolve(name: string): Promise<Address | null> {
    const normalized = normalizeJNSName(name)
    const { data, error } = await this.client.jns
      .resolve({ name: normalized })
      .get()

    if (error) {
      if (String(error).includes('404')) {
        return null
      }
      throw new JNSError(`JNS resolve failed: ${error}`, 500)
    }

    const validated = expectValid(
      jnsResolveResponseSchema,
      data,
      'JNS resolve response',
    )
    return validated.address
  }

  async getRegistrationPrice(
    name: string,
    durationYears: number,
  ): Promise<bigint> {
    const normalized = normalizeJNSName(name)
    const { data, error } = await this.client.jns
      .price({ name: normalized })
      .get({ query: { years: durationYears.toString() } })

    if (error) throw new JNSError(`JNS price check failed: ${error}`, 500)

    expectValid(jnsPriceResponseSchema, data, 'JNS price response')
    return BigInt(data?.price ?? '0')
  }
}

let jnsService: JNSService | null = null

export function getJNSService(): JNSService {
  if (!jnsService) {
    jnsService = new JNSServiceImpl()
  }
  return jnsService
}

export function createJNSClient(baseUrl: string) {
  return treaty<JNSApp>(baseUrl, {
    fetch: { signal: AbortSignal.timeout(JNS_TIMEOUT) },
  })
}

export async function setupDAppJNS(
  owner: Address,
  config: {
    name: string
    backendUrl: string
    frontendCid: string
    description?: string
  },
): Promise<JNSRecords> {
  const jns = getJNSService()

  const existing = await jns.getRecords(config.name)

  const records: JNSRecords = {
    address: owner,
    contentHash: config.frontendCid
      ? `ipfs://${config.frontendCid}`
      : undefined,
    a2aEndpoint: `${config.backendUrl}/a2a`,
    mcpEndpoint: `${config.backendUrl}/mcp`,
    restEndpoint: `${config.backendUrl}/api/v1`,
    description:
      config.description !== undefined
        ? config.description
        : 'Example Application',
  }

  if (!existing.address) {
    await jns.register(config.name, owner, 1)
  }

  await jns.setRecords(config.name, records)

  return records
}

export { JNS_NAME }
