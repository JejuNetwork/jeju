import type {
  DetokenizeTextParams,
  GenerateTextParams,
  IAgentRuntime,
  ImageDescriptionParams,
  ImageGenerationParams,
  ObjectGenerationParams,
  Plugin,
  TextEmbeddingParams,
  TokenizeTextParams,
} from '@elizaos/core';
import { ModelType, logger } from '@elizaos/core';

// Import all LLM provider plugins
// @ts-ignore - workspace dependency
import { openaiPlugin } from '@elizaos/plugin-openai';
// @ts-ignore - workspace dependency
import { anthropicPlugin } from '@elizaos/plugin-anthropic';
// @ts-ignore - workspace dependency
import { ollamaPlugin } from '@elizaos/plugin-ollama';
// @ts-ignore - workspace dependency
import { elizaOSServicesPlugin } from '@elizaos/plugin-elizaos-services';
// @ts-ignore - workspace dependency
import { groqPlugin } from '@elizaos/plugin-groq';
// @ts-ignore - workspace dependency
import { localEmbeddingPlugin } from '@elizaos/plugin-local-embedding';
import { createClaudeHandler } from './claude-proxy';

/**
 * Enum for supported inference providers
 */
export enum InferenceProvider {
  OPENAI = 'openai',
  ANTHROPIC = 'anthropic',
  OLLAMA = 'ollama',
  ELIZAOS = 'elizaos',
  GROQ = 'groq',
  LOCAL_EMBEDDING = 'local_embedding',
}

// Provider configuration
interface ProviderInfo {
  name?: string;
  plugin: Plugin;
  displayName: string;
  status: 'available' | 'not_configured' | 'error';
  message: string;
}

// Inference plugin state
class InferenceState {
  public providers: Map<InferenceProvider, ProviderInfo> = new Map([
    [
      InferenceProvider.OPENAI,
      {
        plugin: openaiPlugin as Plugin,
        status: 'not_configured',
        displayName: 'OpenAI',
        message: 'API key required',
      },
    ],
    [
      InferenceProvider.ANTHROPIC,
      {
        plugin: anthropicPlugin as Plugin,
        status: 'not_configured',
        displayName: 'Anthropic Claude',
        message: 'API key required',
      },
    ],
    [
      InferenceProvider.OLLAMA,
      {
        plugin: ollamaPlugin as Plugin,
        status: 'not_configured',
        displayName: 'Ollama (Local)',
        message: 'Local server required',
      },
    ],
    [
      InferenceProvider.ELIZAOS,
      {
        plugin: elizaOSServicesPlugin as Plugin,
        status: 'not_configured',
        displayName: 'ElizaOS Cloud',
        message: 'API key required',
      },
    ],
    [
      InferenceProvider.GROQ,
      {
        plugin: groqPlugin as Plugin,
        status: 'not_configured',
        displayName: 'Groq',
        message: 'API key required',
      },
    ],
    [
      InferenceProvider.LOCAL_EMBEDDING,
      {
        plugin: localEmbeddingPlugin as Plugin,
        status: 'not_configured',
        displayName: 'Transformers.js (Local)',
        message: 'Pure JavaScript embeddings',
      },
    ],
  ]);

  // Default preferences order (can be overridden by environment variable)
  public preferences: InferenceProvider[] = [
    InferenceProvider.OLLAMA,
    InferenceProvider.GROQ,
    InferenceProvider.ELIZAOS,
    InferenceProvider.OPENAI,
    InferenceProvider.ANTHROPIC,
  ];
  selectedProvider: InferenceProvider | null = null;
  initialized: boolean = false;
}

const state = new InferenceState();

/**
 * Reset state for testing purposes
 * @internal
 */
export function resetInferenceState() {
  state.providers.clear();
  state.providers = new Map([
    [
      InferenceProvider.OPENAI,
      {
        plugin: openaiPlugin as Plugin,
        status: 'not_configured',
        displayName: 'OpenAI',
        message: 'API key required',
      },
    ],
    [
      InferenceProvider.ANTHROPIC,
      {
        plugin: anthropicPlugin as Plugin,
        status: 'not_configured',
        displayName: 'Anthropic Claude',
        message: 'API key required',
      },
    ],
    [
      InferenceProvider.OLLAMA,
      {
        plugin: ollamaPlugin as Plugin,
        status: 'not_configured',
        displayName: 'Ollama (Local)',
        message: 'Local server required',
      },
    ],
    [
      InferenceProvider.ELIZAOS,
      {
        plugin: elizaOSServicesPlugin as Plugin,
        status: 'not_configured',
        displayName: 'ElizaOS Cloud',
        message: 'API key required',
      },
    ],
    [
      InferenceProvider.GROQ,
      {
        plugin: groqPlugin as Plugin,
        status: 'not_configured',
        displayName: 'Groq',
        message: 'API key required',
      },
    ],
    [
      InferenceProvider.LOCAL_EMBEDDING,
      {
        plugin: localEmbeddingPlugin as Plugin,
        status: 'not_configured',
        displayName: 'Transformers.js (Local)',
        message: 'Pure JavaScript embeddings',
      },
    ],
  ]);
  state.preferences = [
    InferenceProvider.OLLAMA,
    InferenceProvider.GROQ,
    InferenceProvider.ELIZAOS,
    InferenceProvider.OPENAI,
    InferenceProvider.ANTHROPIC,
  ];
  state.selectedProvider = null;
  state.initialized = false;
}

/**
 * Initialize provider plugins and check their validity
 */
async function initializeProviders(runtime: IAgentRuntime) {
  if (state.initialized) {
    return;
  }

  logger.info('[INFERENCE] Initializing inference providers...');

  // Always ensure local_embedding is available for embeddings
  const localEmbeddingInfo = state.providers.get(InferenceProvider.LOCAL_EMBEDDING);
  if (localEmbeddingInfo) {
    
      if (localEmbeddingInfo.plugin.init) {
        await localEmbeddingInfo.plugin.init(localEmbeddingInfo.plugin.config || {}, runtime);
      }
      localEmbeddingInfo.status = 'available';
      localEmbeddingInfo.message = 'Ready';
      logger.info('[INFERENCE] Local embedding provider initialized successfully');
    } catch (error) {
      logger.error('[INFERENCE] Failed to initialize local embedding provider:', error);
      localEmbeddingInfo.status = 'error';
      localEmbeddingInfo.message = error instanceof Error ? error.message : 'Initialization failed';
    }
  }

  // Load preferences from environment or runtime setting
  const envPreferences = runtime.getSetting('INFERENCE_PREFERENCES');
  if (envPreferences) {
    try {
      const prefArray = envPreferences.split(',').map((p: string) => p.trim() as InferenceProvider);
      // Validate preferences are valid providers
      const validPrefs = prefArray.filter((p: InferenceProvider) =>
        Object.values(InferenceProvider).includes(p)
      );
      if (validPrefs.length > 0) {
        state.preferences = validPrefs;
        logger.info(`[INFERENCE] Using preferences from config: ${validPrefs.join(', ')}`);
      }
    } catch (error) {
      logger.warn('[INFERENCE] Invalid preferences format, using defaults');
    }
  }

  // Load selected provider from runtime setting
  const selectedProvider = runtime.getSetting('SELECTED_PROVIDER') as InferenceProvider;
  if (selectedProvider && Object.values(InferenceProvider).includes(selectedProvider)) {
    state.selectedProvider = selectedProvider;
    logger.info(`[INFERENCE] Using selected provider: ${selectedProvider}`);
  }

  // Initialize all providers in parallel, but handle failures gracefully
  const initPromises = Array.from(state.providers.entries()).map(
    async ([providerName, providerInfo]) => {
      // Skip local_embedding as it's already initialized above
      if (providerName === InferenceProvider.LOCAL_EMBEDDING) {
        return;
      }

      try {
        // First, try to initialize the plugin
        if (providerInfo.plugin.init) {
          try {
            await providerInfo.plugin.init(providerInfo.plugin.config || {}, runtime);
            logger.debug(`[INFERENCE] Successfully initialized ${providerName}`);
          } catch (initError) {
            // If init fails, mark as error but don't throw
            logger.warn(`[INFERENCE] Failed to initialize ${providerName}:`, initError);
            providerInfo.status = 'error';
            providerInfo.message =
              initError instanceof Error ? initError.message : 'Initialization failed';
            return; // Continue with next provider
          }
        }

        // Then check if it's valid
        const isValid = await checkProviderValidity(runtime, providerName, providerInfo);
        providerInfo.status = isValid ? 'available' : 'not_configured';
        providerInfo.message = isValid ? 'Ready' : getProviderConfigMessage(providerName);

        logger.info(`[INFERENCE] Provider ${providerName}: ${providerInfo.status}`);
      } catch (error) {
        logger.error(`[INFERENCE] Error checking provider ${providerName}:`, error);
        providerInfo.status = 'error';
        providerInfo.message = error instanceof Error ? error.message : 'Unknown error';
      }
    }
  );

  // Wait for all providers to initialize (failures won't stop the process)
  await Promise.allSettled(initPromises);

  // Emit initialization event for dependent plugins (if emitEvent is available)
  if (runtime.emitEvent) {
    await runtime.emitEvent('inference:initialized', {
      providers: Array.from(state.providers.entries()).map(([name, info]) => ({
        name,
        status: info.status,
        message: info.message,
      })),
      selectedProvider: state.selectedProvider,
      preferences: state.preferences,
    });
  }

  state.initialized = true;
  logger.info('[INFERENCE] Provider initialization complete');

  // Log summary of available providers
  const availableProviders = Array.from(state.providers.entries())
    .filter(([_, info]) => info.status === 'available')
    .map(([name, _]) => name);

  if (availableProviders.length === 0) {
    logger.warn('[INFERENCE] No providers are available. Please configure at least one provider.');
  } else {
    logger.info(`[INFERENCE] Available providers: ${availableProviders.join(', ')}`);
  }
}

// Define interface for validation service
interface ValidationService {
  isValid(): boolean | Promise<boolean>;
}

/**
 * Check if a provider is valid and configured
 */
async function checkProviderValidity(
  runtime: IAgentRuntime,
  providerName: InferenceProvider,
  providerInfo: ProviderInfo
): Promise<boolean> {
  // Try to get the validation service for the provider
  const validationServiceName = `${providerName}-validation`;
  const validationService = runtime.getService(validationServiceName) as ValidationService | null;

  if (validationService && typeof validationService.isValid === 'function') {
    return await validationService.isValid();
  }

  // Fallback: check based on provider type if no validation service
  switch (providerName) {
    case InferenceProvider.OPENAI:
      return !!runtime.getSetting('OPENAI_API_KEY');

    case InferenceProvider.ANTHROPIC:
      return !!runtime.getSetting('ANTHROPIC_API_KEY');

    case InferenceProvider.GROQ:
      return !!runtime.getSetting('GROQ_API_KEY');

    case InferenceProvider.ELIZAOS:
      // Check if authenticated with ElizaOS
      return !!runtime.getSetting('ELIZAOS_API_KEY');

    case InferenceProvider.OLLAMA:
      // Ollama doesn't require API key, just check if endpoint is accessible
      return true;

    case InferenceProvider.LOCAL_EMBEDDING:
      // Local embedding doesn't require external configuration
      return true;

    default:
      return false;
  }
}

/**
 * Get configuration message for provider
 */
function getProviderConfigMessage(provider: InferenceProvider): string {
  switch (provider) {
    case InferenceProvider.OPENAI:
      return 'Set OPENAI_API_KEY environment variable';
    case InferenceProvider.ANTHROPIC:
      return 'Set ANTHROPIC_API_KEY environment variable';
    case InferenceProvider.GROQ:
      return 'Set GROQ_API_KEY environment variable';
    case InferenceProvider.OLLAMA:
      return 'Start Ollama server (ollama serve)';
    case InferenceProvider.ELIZAOS:
      return 'Set ELIZAOS_API_KEY environment variable';
    case InferenceProvider.LOCAL_EMBEDDING:
      return 'Ready to use (pure JavaScript)';
    default:
      return 'Configuration required';
  }
}

/**
 * Get the active provider based on selection and availability
 */
async function getActiveProvider(
  runtime: IAgentRuntime
): Promise<{ name: string; plugin: Plugin } | null> {
  await initializeProviders(runtime);

  // If a specific provider is selected, try to use it first
  if (state.selectedProvider) {
    const provider = state.providers.get(state.selectedProvider);
    if (provider && provider.status === 'available') {
      return { name: state.selectedProvider, plugin: provider.plugin };
    } else {
      logger.warn(
        `Selected provider ${state.selectedProvider} is not available, falling back to preferences`
      );
    }
  }

  // Otherwise, use the first available provider from preferences
  for (const providerName of state.preferences) {
    const provider = state.providers.get(providerName);
    if (provider && provider.status === 'available') {
      return { name: providerName, plugin: provider.plugin };
    }
  }

  return null;
}

/**
 * Route model calls to the active provider
 */
async function routeToProvider<T>(
  runtime: IAgentRuntime,
  modelType: string,
  params:
    | GenerateTextParams
    | TextEmbeddingParams
    | TokenizeTextParams
    | DetokenizeTextParams
    | ImageGenerationParams
    | ImageDescriptionParams
    | ObjectGenerationParams
    | string
    | Buffer
    | null
): Promise<T> {
  // For TEXT_EMBEDDING, always try to use the local FastEmbed plugin first
  if (modelType === ModelType.TEXT_EMBEDDING) {
    await initializeProviders(runtime);

    // Try local embedding first
    const localEmbeddingProvider = state.providers.get(InferenceProvider.LOCAL_EMBEDDING);
    if (
      localEmbeddingProvider &&
      localEmbeddingProvider.status === 'available' &&
      localEmbeddingProvider.plugin.models &&
      localEmbeddingProvider.plugin.models[modelType]
    ) {
      try {
        logger.debug('[INFERENCE] Routing embedding request to FastEmbed plugin');
        return await localEmbeddingProvider.plugin.models[modelType](runtime, params);
      } catch (error) {
        logger.warn(
          '[INFERENCE] FastEmbed embedding failed, falling back to other providers:',
          error
        );
      }
    }
  }

  // For all other model types, use the normal provider selection logic
  const provider = await getActiveProvider(runtime);

  if (!provider) {
    throw new Error('No available inference providers. Please configure at least one provider.');
  }

  // Check if the provider supports this model type
  if (!provider.plugin.models || !provider.plugin.models[modelType]) {
    // Try to find another provider that supports this model type
    logger.warn(
      `Provider ${provider.name} does not support model type ${modelType}, searching for alternative...`
    );

    await initializeProviders(runtime);

    // Search through all available providers for one that supports this model type
    for (const providerName of state.preferences) {
      const alternativeProvider = state.providers.get(providerName);
      if (
        alternativeProvider &&
        alternativeProvider.status === 'available' &&
        alternativeProvider.plugin.models &&
        alternativeProvider.plugin.models[modelType]
      ) {
        logger.info(
          `[INFERENCE] Found alternative provider ${providerName} for model type ${modelType}`
        );
        try {
          return await alternativeProvider.plugin.models[modelType](runtime, params);
        } catch (error) {
          logger.error(`Error using provider ${providerName} for model ${modelType}:`, error);
          continue; // Try next provider
        }
      }
    }

    // If no provider supports this model type, throw an error
    throw new Error(`No available provider supports model type ${modelType}`);
  }

  try {
    return await provider.plugin.models[modelType](runtime, params);
  
}

/**
 * Get provider status for all providers
 */
export async function getProviderStatus(runtime: IAgentRuntime): Promise<{
  providers: Array<{
    name: string;
    displayName: string;
    status: 'available' | 'not_configured' | 'error';
    message: string;
  }>;
  active: string | null;
  selected: string | null;
  preferences: string[];
}> {
  await initializeProviders(runtime);

  const providers = Array.from(state.providers.entries()).map(([name, info]) => ({
    name: name as string,
    displayName: info.displayName,
    status: info.status,
    message: info.message,
  }));

  const activeProvider = await getActiveProvider(runtime);

  return {
    providers,
    active: activeProvider?.name || null,
    selected: state.selectedProvider,
    preferences: state.preferences,
  };
}

/**
 * Set the selected provider
 */
export async function setSelectedProvider(
  runtime: IAgentRuntime,
  provider: string | null
): Promise<void> {
  if (!state.initialized) {
    await initializeProviders(runtime);
  }

  if (provider && !state.providers.has(provider as InferenceProvider)) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  state.selectedProvider = provider as InferenceProvider | null;

  // Optionally persist to runtime settings
  if (provider) {
    runtime.setSetting('SELECTED_PROVIDER', provider);
  }
}

/**
 * Set provider preferences
 */
export async function setProviderPreferences(
  runtime: IAgentRuntime,
  preferences: string[]
): Promise<void> {
  if (!state.initialized) {
    await initializeProviders(runtime);
  }

  const validPreferences = preferences
    .map((p) => p as InferenceProvider)
    .filter((p) => state.providers.has(p));

  state.preferences = validPreferences;

  // Optionally persist to runtime settings
  runtime.setSetting('INFERENCE_PREFERENCES', validPreferences.join(','));
}

/**
 * Defines the inference plugin with dynamic provider routing
 */
export const inferencePlugin: Plugin = {
  name: 'inference',
  description: 'Dynamic model provider routing with automatic fallback and cascade initialization',
  priority: -1, // Lower priority to ensure it loads after other model providers

  async init(_config, runtime) {
    logger.info('[INFERENCE] Initializing inference plugin...');

    // Ensure local embedding is initialized for embedding support
    await initializeProviders(runtime);

    logger.info('[INFERENCE] Inference plugin initialized successfully');
  },

  models: {
    [ModelType.TEXT_EMBEDDING]: async (
      runtime: IAgentRuntime,
      params: TextEmbeddingParams | string | null
    ) => {
      return routeToProvider(runtime, ModelType.TEXT_EMBEDDING, params);
    },

    [ModelType.TEXT_TOKENIZER_ENCODE]: async (
      runtime: IAgentRuntime,
      params: TokenizeTextParams
    ) => {
      return routeToProvider(runtime, ModelType.TEXT_TOKENIZER_ENCODE, params);
    },

    [ModelType.TEXT_TOKENIZER_DECODE]: async (
      runtime: IAgentRuntime,
      params: DetokenizeTextParams
    ) => {
      return routeToProvider(runtime, ModelType.TEXT_TOKENIZER_DECODE, params);
    },

    [ModelType.TEXT_SMALL]: async (runtime: IAgentRuntime, params: GenerateTextParams) => {
      return routeToProvider(runtime, ModelType.TEXT_SMALL, params);
    },

    [ModelType.TEXT_LARGE]: async (runtime: IAgentRuntime, params: GenerateTextParams) => {
      return routeToProvider(runtime, ModelType.TEXT_LARGE, params);
    },

    [ModelType.IMAGE]: async (runtime: IAgentRuntime, params: ImageGenerationParams) => {
      return routeToProvider(runtime, ModelType.IMAGE, params);
    },

    [ModelType.IMAGE_DESCRIPTION]: async (
      runtime: IAgentRuntime,
      params: ImageDescriptionParams | string
    ) => {
      return routeToProvider(runtime, ModelType.IMAGE_DESCRIPTION, params);
    },

    [ModelType.TRANSCRIPTION]: async (runtime: IAgentRuntime, audioBuffer: Buffer) => {
      return routeToProvider(runtime, ModelType.TRANSCRIPTION, audioBuffer);
    },

    [ModelType.TEXT_TO_SPEECH]: async (runtime: IAgentRuntime, text: string) => {
      return routeToProvider(runtime, ModelType.TEXT_TO_SPEECH, text);
    },

    [ModelType.OBJECT_SMALL]: async (runtime: IAgentRuntime, params: ObjectGenerationParams) => {
      return routeToProvider(runtime, ModelType.OBJECT_SMALL, params);
    },

    [ModelType.OBJECT_LARGE]: async (runtime: IAgentRuntime, params: ObjectGenerationParams) => {
      return routeToProvider(runtime, ModelType.OBJECT_LARGE, params);
    },
  },

  tests: [
    {
      name: 'inference_plugin_tests',
      tests: [
        {
          name: 'test_provider_status',
          fn: async (runtime: IAgentRuntime) => {
            const status = await getProviderStatus(runtime);
            logger.log('Provider status:', status);

            if (status.providers.length === 0) {
              throw new Error('No providers registered');
            }

            const availableProviders = status.providers.filter((p) => p.status === 'available');
            logger.log(
              `Available providers: ${availableProviders.length}/${status.providers.length}`
            );
          },
        },
        {
          name: 'test_provider_routing',
          fn: async (runtime: IAgentRuntime) => {
            
              const text = await runtime.useModel(ModelType.TEXT_SMALL, {
                prompt: 'Say "Hello from inference plugin"',
              });
              logger.log('Routed response:', text);
            
          },
        },
      ],
    },
  ],
};

export default inferencePlugin;

// Export Claude handler for external use
export { createClaudeHandler, ClaudeProxy } from './claude-proxy';
