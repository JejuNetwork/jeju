/**
 * Multi-Provider AI API Implementation
 * Supports OpenAI, Groq, Anthropic, and other providers with real API endpoints
 */

import type { IAgentRuntime, ModelTypeName } from '@elizaos/core';
import { ModelType, logger } from '@elizaos/core';
import { fetch } from 'undici';

/**
 * Provider configuration for different AI services
 */
export interface ProviderConfig {
  name: string;
  baseURL: string;
  supportedModels: ModelTypeName[];
  models: {
    [ModelType.TEXT_SMALL]?: string;
    [ModelType.TEXT_LARGE]?: string;
    [ModelType.TEXT_EMBEDDING]?: string;
    [ModelType.IMAGE_DESCRIPTION]?: string;
  };
  headers: (apiKey: string) => Record<string, string>;
  transformRequest?: (payload: any) => any;
  transformResponse?: (response: any) => any;
}

/**
 * Provider configurations
 */
export const PROVIDERS: Record<string, ProviderConfig> = {
  openai: {
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    supportedModels: [
      ModelType.TEXT_SMALL,
      ModelType.TEXT_LARGE,
      ModelType.TEXT_EMBEDDING,
      ModelType.IMAGE_DESCRIPTION,
    ],
    models: {
      [ModelType.TEXT_SMALL]: 'gpt-4o-mini',
      [ModelType.TEXT_LARGE]: 'gpt-4o',
      [ModelType.TEXT_EMBEDDING]: 'text-embedding-3-small',
      [ModelType.IMAGE_DESCRIPTION]: 'gpt-4o',
    },
    headers: (apiKey: string) => ({
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  groq: {
    name: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    supportedModels: [ModelType.TEXT_SMALL, ModelType.TEXT_LARGE, ModelType.IMAGE_DESCRIPTION],
    models: {
      [ModelType.TEXT_SMALL]: 'llama-3.1-8b-instant',
      [ModelType.TEXT_LARGE]: 'llama-3.1-8b-instant',
      [ModelType.IMAGE_DESCRIPTION]: 'llama-3.1-8b-instant',
    },
    headers: (apiKey: string) => ({
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  anthropic: {
    name: 'Anthropic',
    baseURL: 'https://api.anthropic.com/v1',
    supportedModels: [ModelType.TEXT_SMALL, ModelType.TEXT_LARGE, ModelType.IMAGE_DESCRIPTION],
    models: {
      [ModelType.TEXT_SMALL]: 'claude-3-haiku-20240307',
      [ModelType.TEXT_LARGE]: 'claude-3-5-sonnet-20241022',
      [ModelType.IMAGE_DESCRIPTION]: 'claude-3-5-sonnet-20241022',
    },
    headers: (apiKey: string) => ({
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    }),
    transformRequest: (payload: any) => {
      // Transform OpenAI-style to Anthropic-style
      if (payload.messages) {
        return {
          model: payload.model,
          max_tokens: payload.max_tokens || 1000,
          messages: payload.messages.map((msg: any) => ({
            role: msg.role === 'system' ? 'user' : msg.role,
            content: msg.content,
          })),
        };
      }
      return payload;
    },
    transformResponse: (response: any) => {
      // Transform Anthropic response to OpenAI-style
      if (response.content && Array.isArray(response.content)) {
        return {
          choices: [
            {
              message: {
                content: response.content[0].text,
              },
            },
          ],
          usage: response.usage,
        };
      }
      return response;
    },
  },
};

/**
 * Get provider configuration based on available API keys
 */
export function getAvailableProvider(
  runtime: IAgentRuntime,
  modelType: ModelTypeName
): ProviderConfig | null {
  // Check for provider-specific API keys in order of preference
  const providerPreference = [
    { key: 'OPENAI_API_KEY', provider: 'openai' },
    { key: 'GROQ_API_KEY', provider: 'groq' },
    { key: 'ANTHROPIC_API_KEY', provider: 'anthropic' },
  ];

  for (const { key, provider } of providerPreference) {
    const apiKey = runtime.getSetting(key) || process.env[key];
    if (apiKey && apiKey.length > 10) {
      const config = PROVIDERS[provider];

      // Skip providers that don't support this model type
      if (!config.supportedModels.includes(modelType)) {
        logger.debug(`Provider ${config.name} does not support ${modelType}`);
        continue;
      }

      // Verify the model is actually configured
      const models = config.models as Record<string, any>;
      if (!models[modelType]) {
        logger.debug(`Provider ${config.name} missing model configuration for ${modelType}`);
        continue;
      }

      logger.debug(`Using ${config.name} for ${modelType}`);
      return config;
    }
  }

  logger.warn(`No API key found for ${modelType}`);
  return null;
}

/**
 * Get API key for a specific provider
 */
export function getProviderApiKey(runtime: IAgentRuntime, providerName: string): string | null {
  const keyMap: Record<string, string> = {
    openai: 'OPENAI_API_KEY',
    groq: 'GROQ_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
  };

  const keyName = keyMap[providerName];
  if (!keyName) {
    return null;
  }

  return runtime.getSetting(keyName) || process.env[keyName] || null;
}

/**
 * Make API request to provider with proper error handling
 */
export async function makeProviderRequest(
  provider: ProviderConfig,
  apiKey: string,
  endpoint: string,
  payload: any
): Promise<any> {
  const url = `${provider.baseURL}${endpoint}`;
  const headers = provider.headers(apiKey);

  // Transform request if needed
  const requestPayload = provider.transformRequest ? provider.transformRequest(payload) : payload;

  logger.debug(`Making request to ${provider.name}: ${url}`);

  
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestPayload),
    } as any);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`${provider.name} API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();

    // Transform response if needed
    return provider.transformResponse ? provider.transformResponse(data) : data;
  
}

/**
 * Emit usage event for cost tracking
 */
export function emitProviderUsageEvent(
  runtime: IAgentRuntime,
  providerName: string,
  modelType: ModelTypeName,
  prompt: string,
  usage: any
) {
  runtime.emitEvent('MODEL_USED', {
    provider: providerName,
    type: modelType,
    prompt: prompt.substring(0, 100), // Truncate for privacy
    tokens: {
      prompt: usage.promptTokens || usage.prompt_tokens || 0,
      completion: usage.completionTokens || usage.completion_tokens || 0,
      total: usage.totalTokens || usage.total_tokens || 0,
    },
    cost: usage.total_cost || 0,
    timestamp: new Date().toISOString(),
  });
}
