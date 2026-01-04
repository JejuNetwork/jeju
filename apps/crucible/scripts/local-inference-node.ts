#!/usr/bin/env bun
/**
 * Local Inference Node for Crucible Development
 *
 * SECURITY: This is a LOCAL DEVELOPMENT TOOL only.
 * It uses API keys directly from environment for convenience.
 *
 * Starts a local inference server that uses GROQ API and registers with DWS.
 * This allows Crucible agents to run locally without on-chain provider registration.
 */

import { getCurrentNetwork } from '@jejunetwork/config'
import { Elysia, t } from 'elysia'

// SECURITY: Only allow this script to run in localnet
const network = getCurrentNetwork()
if (network !== 'localnet') {
  console.error(
    `ERROR: This script is only for localnet development. Current network: ${network}`,
  )
  console.error(
    'For production inference, use registered DWS compute providers.',
  )
  process.exit(1)
}

const GROQ_API_KEY = process.env.GROQ_API_KEY
const PORT = parseInt(process.env.INFERENCE_PORT ?? '4032', 10)
const DWS_URL = process.env.DWS_URL ?? 'http://localhost:4030'
const NODE_ADDRESS = process.env.NODE_ADDRESS ?? '0xLocalInferenceNode'

if (!GROQ_API_KEY) {
  console.error('GROQ_API_KEY is required')
  console.error('Set it in .env or export GROQ_API_KEY=...')
  process.exit(1)
}

// Map model names to GROQ models
function mapModel(model: string): string {
  const lower = model.toLowerCase()
  if (lower.includes('70b')) return 'llama-3.3-70b-versatile'
  if (lower.includes('8b')) return 'llama-3.1-8b-instant'
  if (lower.includes('mixtral')) return 'mixtral-8x7b-32768'
  if (lower.includes('gemma')) return 'gemma2-9b-it'
  // Default to fast model
  return 'llama-3.1-8b-instant'
}

// Create inference server
const app = new Elysia()
  .get('/health', () => ({
    status: 'healthy',
    service: 'local-inference-node',
    provider: 'groq',
  }))
  .post(
    '/v1/chat/completions',
    async ({ body }) => {
      const model = mapModel(body.model)

      const response = await fetch(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${GROQ_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: body.messages,
            temperature: body.temperature ?? 0.7,
            max_tokens: body.max_tokens ?? 1024,
          }),
        },
      )

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`GROQ API error: ${response.status} - ${error}`)
      }

      const result = await response.json()
      return result
    },
    {
      body: t.Object({
        model: t.String(),
        messages: t.Array(
          t.Object({
            role: t.Union([
              t.Literal('system'),
              t.Literal('user'),
              t.Literal('assistant'),
            ]),
            content: t.String(),
          }),
        ),
        temperature: t.Optional(t.Number()),
        max_tokens: t.Optional(t.Number()),
      }),
    },
  )

// Start server
const _server = app.listen(PORT)
console.log(`[Inference Node] Started on port ${PORT}`)
console.log(`[Inference Node] Using GROQ provider`)

// Register with DWS
async function registerWithDWS() {
  console.log(`[Inference Node] Registering with DWS at ${DWS_URL}...`)

  const response = await fetch(`${DWS_URL}/compute/nodes/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address: NODE_ADDRESS,
      endpoint: `http://localhost:${PORT}`,
      gpuTier: 1,
      capabilities: ['inference', 'embeddings'],
      provider: 'groq',
      models: ['*', 'llama-3.1-8b-instant', 'llama-3.3-70b-versatile'],
      region: 'local',
      maxConcurrent: 50,
    }),
  })

  if (!response.ok) {
    console.error(
      `[Inference Node] Failed to register with DWS: ${await response.text()}`,
    )
    return false
  }

  console.log('[Inference Node] Registered with DWS successfully')
  return true
}

// Heartbeat loop
async function heartbeatLoop() {
  while (true) {
    await fetch(`${DWS_URL}/compute/nodes/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address: NODE_ADDRESS,
        load: 0,
      }),
    }).catch(() => {})

    await new Promise((r) => setTimeout(r, 30000))
  }
}

// Initialize
registerWithDWS()
  .then((success) => {
    if (success) {
      heartbeatLoop()
    }
  })
  .catch(console.error)

// Handle shutdown
process.on('SIGINT', () => {
  console.log('[Inference Node] Shutting down...')
  process.exit(0)
})
