/**
 * DWS Eden Client
 *
 * Type-safe client for all DWS services using Eden treaty.
 * Provides typed access to compute, storage, cache, cron, and CDN services.
 */

import { treaty } from '@elysiajs/eden'
import type { InferenceApp } from '../compute/local-inference-server'
// Import app types from each service
import type { GatewayApp } from '../gateway'
import type { NodeApp } from '../node'
import type { ProxyCoordinatorApp } from '../proxy/coordinator'
import type { TriggerApp } from '../triggers'

// Client Factory

export function createDWSClient(baseUrl: string) {
  return treaty<GatewayApp>(baseUrl)
}

export function createInferenceClient(baseUrl: string) {
  return treaty<InferenceApp>(baseUrl)
}

export function createNodeClient(baseUrl: string) {
  return treaty<NodeApp>(baseUrl)
}

export function createProxyClient(baseUrl: string) {
  return treaty<ProxyCoordinatorApp>(baseUrl)
}

export function createTriggerClient(baseUrl: string) {
  return treaty<TriggerApp>(baseUrl)
}

// Default Clients

const DWS_URL = process.env.DWS_URL || 'http://localhost:4030'
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:4032'
const INFERENCE_URL = process.env.INFERENCE_URL || 'http://localhost:4031'
const NODE_URL = process.env.NODE_URL || 'http://localhost:4031'
const PROXY_URL = process.env.PROXY_URL || 'http://localhost:4020'
const TRIGGER_URL = process.env.TRIGGER_URL || 'http://localhost:4016'

export const dwsClient = createDWSClient(DWS_URL)
export const gatewayClient = createDWSClient(GATEWAY_URL)
export const inferenceClient = createInferenceClient(INFERENCE_URL)
export const nodeClient = createNodeClient(NODE_URL)
export const proxyClient = createProxyClient(PROXY_URL)
export const triggerClient = createTriggerClient(TRIGGER_URL)

// Type Exports

export type DWSClient = ReturnType<typeof createDWSClient>
export type InferenceClient = ReturnType<typeof createInferenceClient>
export type NodeClient = ReturnType<typeof createNodeClient>
export type ProxyClient = ReturnType<typeof createProxyClient>
export type TriggerClient = ReturnType<typeof createTriggerClient>
