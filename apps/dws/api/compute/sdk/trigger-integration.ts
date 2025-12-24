/**
 * DWS Trigger Integration SDK
 * For vendors to register triggers in the compute marketplace
 */

const DEBUG = process.env.DEBUG === 'true' || process.env.DEBUG === '1'

function log(message: string): void {
  if (DEBUG) {
    process.stdout.write(`[DWS Trigger] ${message}\n`)
  }
}

export interface TriggerResources {
  cpuCores: number
  memoryMb: number
  requiresGpu?: boolean
  gpuType?: string
  maxExecutionTime?: number
}

export interface TriggerPayment {
  mode: 'free' | 'x402' | 'prepaid'
  pricePerExecution?: bigint
}

export interface CronTrigger {
  type: 'cron'
  name: string
  description: string
  cronExpression: string
  endpoint: string
  method: 'GET' | 'POST'
  timeout: number
  resources?: TriggerResources
  payment?: TriggerPayment
  active: boolean
}

export interface WebhookTrigger {
  type: 'webhook'
  name: string
  description: string
  webhookPath: string
  endpoint: string
  method: 'GET' | 'POST'
  timeout: number
  resources?: TriggerResources
  payment?: TriggerPayment
  active: boolean
}

export interface EventTrigger {
  type: 'event'
  name: string
  description: string
  eventTypes: string[]
  endpoint: string
  method: 'GET' | 'POST'
  timeout: number
  resources?: TriggerResources
  payment?: TriggerPayment
  active: boolean
}

export type TriggerConfig = CronTrigger | WebhookTrigger | EventTrigger

const registeredTriggers = new Map<string, TriggerConfig[]>()

export async function initializeTriggerIntegration(): Promise<void> {
  log('Initialized')
}

export async function registerVendorTriggers(
  vendorId: string,
  triggers: TriggerConfig[],
): Promise<void> {
  const existingTriggers = registeredTriggers.get(vendorId) || []
  registeredTriggers.set(vendorId, [...existingTriggers, ...triggers])

  log(`Registered ${triggers.length} triggers for vendor: ${vendorId}`)
  for (const trigger of triggers) {
    log(`  ${vendorId}-${trigger.name} (${trigger.type})`)
  }
}

export function getVendorTriggers(vendorId: string): TriggerConfig[] {
  return registeredTriggers.get(vendorId) || []
}

export function getAllTriggers(): Map<string, TriggerConfig[]> {
  return registeredTriggers
}
