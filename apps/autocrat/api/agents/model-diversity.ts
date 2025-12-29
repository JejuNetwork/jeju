/**
 * Model Diversity Configuration for Board Agents
 *
 * Ensures genuine diversity of reasoning by using different LLM providers
 * for different board roles. This prevents correlated failures and groupthink.
 *
 * Each agent role maps to a specific model provider to ensure:
 * - Different training data biases
 * - Different reasoning approaches
 * - Independent failure modes
 * - True adversarial review
 *
 * @module model-diversity
 */

import { getCurrentNetwork } from '@jejunetwork/config'
import { z } from 'zod'

// ============================================================================
// Types
// ============================================================================

export const ModelProviderSchema = z.enum([
  'openai',
  'anthropic',
  'google',
  'meta',
  'mistral',
  'local', // Local Ollama or DWS
])
export type ModelProvider = z.infer<typeof ModelProviderSchema>

export interface ModelConfig {
  provider: ModelProvider
  model: string
  endpoint?: string // Custom endpoint (for local/self-hosted)
  apiKeyEnv?: string // Environment variable for API key
  temperature: number
  maxTokens: number
  // Provider-specific options
  options?: Record<string, unknown>
}

export interface RoleModelMapping {
  role: string
  primary: ModelConfig
  fallback: ModelConfig // Different provider for resilience
}

// ============================================================================
// Model Configurations
// ============================================================================

const OPENAI_CONFIG: ModelConfig = {
  provider: 'openai',
  model: 'gpt-4o',
  apiKeyEnv: 'OPENAI_API_KEY',
  temperature: 0.7,
  maxTokens: 800,
}

const ANTHROPIC_CONFIG: ModelConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  apiKeyEnv: 'ANTHROPIC_API_KEY',
  temperature: 0.7,
  maxTokens: 800,
}

const GOOGLE_CONFIG: ModelConfig = {
  provider: 'google',
  model: 'gemini-2.0-flash',
  apiKeyEnv: 'GOOGLE_API_KEY',
  temperature: 0.7,
  maxTokens: 800,
}

const META_CONFIG: ModelConfig = {
  provider: 'meta',
  model: 'llama-4-maverick-17b-128e-instruct',
  temperature: 0.7,
  maxTokens: 800,
}

const MISTRAL_CONFIG: ModelConfig = {
  provider: 'mistral',
  model: 'mistral-large-latest',
  apiKeyEnv: 'MISTRAL_API_KEY',
  temperature: 0.7,
  maxTokens: 800,
}

const LOCAL_CONFIG: ModelConfig = {
  provider: 'local',
  model: 'llama-3.1-8b-instant',
  temperature: 0.7,
  maxTokens: 500,
}

// ============================================================================
// Role-to-Model Mapping
// ============================================================================

/**
 * Production mapping: Different providers for each role
 * This ensures true independence of reasoning
 */
const PRODUCTION_ROLE_MODELS: RoleModelMapping[] = [
  {
    role: 'Treasury',
    primary: ANTHROPIC_CONFIG, // Claude for careful financial reasoning
    fallback: OPENAI_CONFIG,
  },
  {
    role: 'Security',
    primary: OPENAI_CONFIG, // GPT for security analysis
    fallback: ANTHROPIC_CONFIG,
  },
  {
    role: 'Code',
    primary: ANTHROPIC_CONFIG, // Claude for code review
    fallback: META_CONFIG,
  },
  {
    role: 'Community',
    primary: GOOGLE_CONFIG, // Gemini for community perspective
    fallback: ANTHROPIC_CONFIG,
  },
  {
    role: 'Legal',
    primary: MISTRAL_CONFIG, // Mistral for legal analysis
    fallback: OPENAI_CONFIG,
  },
]

/**
 * Development mapping: Can use local models
 */
const DEVELOPMENT_ROLE_MODELS: RoleModelMapping[] = [
  {
    role: 'Treasury',
    primary: LOCAL_CONFIG,
    fallback: LOCAL_CONFIG,
  },
  {
    role: 'Security',
    primary: LOCAL_CONFIG,
    fallback: LOCAL_CONFIG,
  },
  {
    role: 'Code',
    primary: LOCAL_CONFIG,
    fallback: LOCAL_CONFIG,
  },
  {
    role: 'Community',
    primary: LOCAL_CONFIG,
    fallback: LOCAL_CONFIG,
  },
  {
    role: 'Legal',
    primary: LOCAL_CONFIG,
    fallback: LOCAL_CONFIG,
  },
]

// ============================================================================
// Model Resolution
// ============================================================================

export function getRoleModels(): RoleModelMapping[] {
  const network = getCurrentNetwork()
  
  if (network === 'mainnet' || network === 'testnet') {
    return PRODUCTION_ROLE_MODELS
  }
  
  // Check if we have API keys for production models
  const hasOpenAI = !!process.env.OPENAI_API_KEY
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY
  const hasGoogle = !!process.env.GOOGLE_API_KEY
  
  // If we have multiple keys, use diverse models even in dev
  if (hasOpenAI && hasAnthropic) {
    return [
      {
        role: 'Treasury',
        primary: ANTHROPIC_CONFIG,
        fallback: OPENAI_CONFIG,
      },
      {
        role: 'Security',
        primary: OPENAI_CONFIG,
        fallback: ANTHROPIC_CONFIG,
      },
      {
        role: 'Code',
        primary: ANTHROPIC_CONFIG,
        fallback: OPENAI_CONFIG,
      },
      {
        role: 'Community',
        primary: hasGoogle ? GOOGLE_CONFIG : OPENAI_CONFIG,
        fallback: ANTHROPIC_CONFIG,
      },
      {
        role: 'Legal',
        primary: OPENAI_CONFIG,
        fallback: ANTHROPIC_CONFIG,
      },
    ]
  }
  
  return DEVELOPMENT_ROLE_MODELS
}

export function getModelForRole(role: string): ModelConfig {
  const mappings = getRoleModels()
  const mapping = mappings.find(m => m.role === role)
  
  if (!mapping) {
    console.warn(`No model mapping for role ${role}, using local`)
    return LOCAL_CONFIG
  }
  
  // Check if primary is available
  if (mapping.primary.apiKeyEnv) {
    const hasKey = !!process.env[mapping.primary.apiKeyEnv]
    if (!hasKey) {
      console.warn(`${mapping.primary.provider} API key not found for ${role}, using fallback`)
      return mapping.fallback
    }
  }
  
  return mapping.primary
}

// ============================================================================
// Provider API Calls
// ============================================================================

interface GenerateOptions {
  prompt: string
  systemPrompt: string
  model: ModelConfig
  maxTokens?: number
}

async function generateOpenAI(options: GenerateOptions): Promise<string> {
  const apiKey = options.model.apiKeyEnv 
    ? process.env[options.model.apiKeyEnv]
    : null
  
  if (!apiKey) {
    throw new Error('OpenAI API key not configured')
  }
  
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: options.model.model,
      messages: [
        { role: 'system', content: options.systemPrompt },
        { role: 'user', content: options.prompt },
      ],
      temperature: options.model.temperature,
      max_tokens: options.maxTokens ?? options.model.maxTokens,
    }),
  })
  
  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`)
  }
  
  const data = await response.json() as { choices: Array<{ message: { content: string } }> }
  return data.choices[0]?.message?.content ?? ''
}

async function generateAnthropic(options: GenerateOptions): Promise<string> {
  const apiKey = options.model.apiKeyEnv
    ? process.env[options.model.apiKeyEnv]
    : null
  
  if (!apiKey) {
    throw new Error('Anthropic API key not configured')
  }
  
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: options.model.model,
      system: options.systemPrompt,
      messages: [
        { role: 'user', content: options.prompt },
      ],
      temperature: options.model.temperature,
      max_tokens: options.maxTokens ?? options.model.maxTokens,
    }),
  })
  
  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status}`)
  }
  
  const data = await response.json() as { content: Array<{ text: string }> }
  return data.content[0]?.text ?? ''
}

async function generateGoogle(options: GenerateOptions): Promise<string> {
  const apiKey = options.model.apiKeyEnv
    ? process.env[options.model.apiKeyEnv]
    : null
  
  if (!apiKey) {
    throw new Error('Google API key not configured')
  }
  
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1/models/${options.model.model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: options.systemPrompt }] },
        contents: [{ parts: [{ text: options.prompt }] }],
        generationConfig: {
          temperature: options.model.temperature,
          maxOutputTokens: options.maxTokens ?? options.model.maxTokens,
        },
      }),
    }
  )
  
  if (!response.ok) {
    throw new Error(`Google API error: ${response.status}`)
  }
  
  const data = await response.json() as { 
    candidates: Array<{ content: { parts: Array<{ text: string }> } }> 
  }
  return data.candidates[0]?.content?.parts[0]?.text ?? ''
}

async function generateLocal(options: GenerateOptions, endpoint: string): Promise<string> {
  const response = await fetch(`${endpoint}/compute/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: options.model.model,
      messages: [
        { role: 'system', content: options.systemPrompt },
        { role: 'user', content: options.prompt },
      ],
      temperature: options.model.temperature,
      max_tokens: options.maxTokens ?? options.model.maxTokens,
    }),
  })
  
  if (!response.ok) {
    throw new Error(`Local model error: ${response.status}`)
  }
  
  const data = await response.json() as { 
    choices?: Array<{ message: { content: string } }>
    content?: string
  }
  return data.choices?.[0]?.message?.content ?? data.content ?? ''
}

/**
 * Generate response using the appropriate provider
 */
export async function generateWithModel(
  options: GenerateOptions,
  localEndpoint?: string,
): Promise<string> {
  const { model } = options
  
  switch (model.provider) {
    case 'openai':
      return generateOpenAI(options)
    case 'anthropic':
      return generateAnthropic(options)
    case 'google':
      return generateGoogle(options)
    case 'local':
      if (!localEndpoint) {
        throw new Error('Local endpoint required for local models')
      }
      return generateLocal(options, localEndpoint)
    case 'meta':
    case 'mistral':
      // These would need their own API implementations
      // For now, fall back to local
      if (localEndpoint) {
        return generateLocal(options, localEndpoint)
      }
      throw new Error(`${model.provider} provider not yet implemented`)
    default:
      throw new Error(`Unknown provider: ${model.provider}`)
  }
}

// ============================================================================
// Diversity Metrics
// ============================================================================

export interface DiversityReport {
  totalAgents: number
  uniqueProviders: number
  providers: string[]
  isGenuinelyDiverse: boolean
  recommendation: string
}

export function assessModelDiversity(): DiversityReport {
  const mappings = getRoleModels()
  const providers = new Set(mappings.map(m => m.primary.provider))
  
  const report: DiversityReport = {
    totalAgents: mappings.length,
    uniqueProviders: providers.size,
    providers: Array.from(providers),
    isGenuinelyDiverse: providers.size >= 3,
    recommendation: '',
  }
  
  if (providers.size === 1 && providers.has('local')) {
    report.recommendation = 'All agents using local models. Add API keys for production diversity.'
  } else if (providers.size < 3) {
    report.recommendation = 'Limited model diversity. Consider adding more API providers.'
  } else {
    report.recommendation = 'Good model diversity across board agents.'
  }
  
  return report
}

