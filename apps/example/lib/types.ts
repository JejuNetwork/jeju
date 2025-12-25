import type { JsonRecord } from '@jejunetwork/types'
import { expectAddress } from '@jejunetwork/types'
import type { Address, Hex } from 'viem'

export type { JsonRecord }

export interface A2AResponse {
  jsonrpc: string
  id: string | number
  result?: {
    role: string
    parts: Array<{
      kind: string
      text?: string
      data?: JsonRecord
    }>
    messageId: string
    kind: string
  }
  error?: { code: number; message: string }
}

export interface MCPPrompt {
  name: string
  description: string
  arguments: Array<{ name: string; description: string; required?: boolean }>
}

export interface X402Token {
  symbol: string
  address: Address
  decimals: number
  minAmount: bigint
}

export interface X402PaymentResult {
  valid: boolean
  txHash?: Hex
  error?: string
}

export interface CronJob {
  id: string
  name: string
  schedule: string
  endpoint: string
  enabled: boolean
  lastRun: number | null
  nextRun: number
}

export interface DeployResult {
  jnsName: string
  frontendCid: string
  backendEndpoint: string
  a2aEndpoint: string
  mcpEndpoint: string
  databaseId: string
  triggerId: Hex
}

export type TodoPriority = 'low' | 'medium' | 'high'

export const TODO_PRIORITIES: readonly TodoPriority[] = [
  'low',
  'medium',
  'high',
]

export const A2A_SKILLS = [
  'list-todos',
  'create-todo',
  'complete-todo',
  'delete-todo',
  'get-summary',
  'set-reminder',
  'prioritize',
] as const

export const MCP_TOOLS = [
  'create_todo',
  'list_todos',
  'update_todo',
  'delete_todo',
  'get_stats',
  'schedule_reminder',
  'bulk_complete',
] as const

// Validated dev addresses - these are Anvil test addresses, validated at module load
const DEV_PAYMENT_ADDRESS = expectAddress(
  '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  'DEV_PAYMENT_ADDRESS',
)
const DEV_JEJU_TOKEN_ADDRESS = expectAddress(
  '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  'DEV_JEJU_TOKEN_ADDRESS',
)
const DEV_USDC_TOKEN_ADDRESS = expectAddress(
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  'DEV_USDC_TOKEN_ADDRESS',
)

export const X402_CONFIG = {
  enabled: true,
  paymentAddress: DEV_PAYMENT_ADDRESS,
  acceptedTokens: [
    {
      symbol: 'JEJU',
      address: DEV_JEJU_TOKEN_ADDRESS,
      decimals: 18,
      minAmount: 1000000000000000n, // 0.001 JEJU
    },
    {
      symbol: 'USDC',
      address: DEV_USDC_TOKEN_ADDRESS,
      decimals: 6,
      minAmount: 1000n, // 0.001 USDC
    },
  ],
  prices: {
    rest: '10000000000000000', // 0.01 JEJU per REST call
    a2a: '50000000000000000', // 0.05 JEJU per A2A call
    mcp: '50000000000000000', // 0.05 JEJU per MCP call
  },
  network: 'base-sepolia',
} as const
