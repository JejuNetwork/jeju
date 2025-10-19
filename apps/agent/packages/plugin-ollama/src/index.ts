import type { ObjectGenerationParams, Plugin, TextEmbeddingParams } from '@elizaos/core';
import {
  type GenerateTextParams,
  ModelType,
  logger,
  Service,
  type ServiceTypeName,
} from '@elizaos/core';
import { generateObject, generateText, embed } from 'ai';
import { createOllama } from 'ollama-ai-provider';

// Default Ollama API URL
const OLLAMA_API_URL = 'http://localhost:11434/api';

/**
 * Validation service for Ollama plugin
 * Provides runtime validation for API availability
 */
class OllamaValidationService extends Service {
  static override serviceType: ServiceTypeName = 'ollama-validation' as ServiceTypeName;
  static serviceName = 'ollama-validation';

  override capabilityDescription = 'Validates Ollama plugin configuration and API availability';

  constructor(runtime: any) {
    super(runtime);
  }

  static async start(runtime: any): Promise<OllamaValidationService> {
    return new OllamaValidationService(runtime);
  }

  async stop(): Promise<void> {
    // No cleanup needed
  }

  /**
   * Check if Ollama is properly configured and available
   */
  async isValid(): Promise<boolean> {
    
      const baseURL = getBaseURL(this.runtime);
      // Remove /api suffix for direct API calls
      const apiBase = baseURL.endsWith('/api') ? baseURL.slice(0, -4) : baseURL;
      const response = await fetch(`${apiBase}/api/tags`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      return response.ok;
    
  }
}

/**
 * Retrieves the Ollama API base URL from runtime settings.
 *
 * If the API endpoint is not set in the runtime, defaults to the standard Ollama URL.
 * The URL should include the /api path for ollama-ai-provider compatibility.
 *
 * @returns The base URL for the Ollama API.
 */
function getBaseURL(runtime: { getSetting: (key: string) => string | undefined }): string {
  const apiEndpoint =
    runtime.getSetting('OLLAMA_API_ENDPOINT') ||
    runtime.getSetting('OLLAMA_API_URL') ||
    OLLAMA_API_URL;

  // Ensure the URL ends with /api for ollama-ai-provider
  if (!apiEndpoint.endsWith('/api')) {
    return apiEndpoint.endsWith('/') ? `${apiEndpoint}api` : `${apiEndpoint}/api`;
  }
  return apiEndpoint;
}

/**
 * Ensures that the specified Ollama model is available locally, downloading it if necessary.
 *
 * Checks for the presence of the model via the Ollama API and attempts to download it if not found. Logs progress and errors during the process.
 */
async function ensureModelAvailable(
  runtime: {
    getSetting: (key: string) => string | undefined;
    fetch?: typeof fetch;
  },
  model: string,
  providedBaseURL?: string
) {
  const baseURL = providedBaseURL || getBaseURL(runtime);
  // Remove /api suffix for direct API calls
  const apiBase = baseURL.endsWith('/api') ? baseURL.slice(0, -4) : baseURL;
  try {
    const showRes = await fetch(`${apiBase}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    });
    if (showRes.ok) return;
    logger.info(`[Ollama] Model ${model} not found locally. Downloading...`);
    const pullRes = await fetch(`${apiBase}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: false }),
    });
    if (!pullRes.ok) {
      logger.error(`Failed to pull model ${model}: ${pullRes.statusText}`);
    } else {
      logger.info(`[Ollama] Downloaded model ${model}`);
    }
  } catch (err) {
    logger.error('Error ensuring model availability:', err);
  }
}

/**
 * Converts a messages array to a prompt string
 */
function messagesToPrompt(messages: any[]): string {
  if (!Array.isArray(messages)) {
    return '';
  }

  return messages
    .map((msg) => {
      if (typeof msg === 'string') {
        return msg;
      }

      // Handle standard message format
      if (msg.role && msg.content) {
        const role =
          msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : msg.role;

        // Handle content that's an array of parts
        if (Array.isArray(msg.content)) {
          const textParts = msg.content
            .filter((part: any) => part.type === 'text')
            .map((part: any) => part.text)
            .join(' ');
          return `${role}: ${textParts}`;
        }

        // Handle content that's a string
        if (typeof msg.content === 'string') {
          return `${role}: ${msg.content}`;
        }
      }

      return '';
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * Generates text from the Ollama API using the specified model and parameters.
 *
 * Returns the generated text, or an error message if generation fails.
 */
async function generateOllamaText(
  ollama: ReturnType<typeof createOllama>,
  model: string,
  params: {
    prompt: string;
    system?: string;
    temperature: number;
    maxTokens: number;
    frequencyPenalty: number;
    presencePenalty: number;
    stopSequences: string[];
  }
) {
  try {
    const { text: ollamaResponse } = await generateText({
      model: ollama(model),
      prompt: params.prompt,
      system: params.system,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
      frequencyPenalty: params.frequencyPenalty,
      presencePenalty: params.presencePenalty,
      stopSequences: params.stopSequences,
    });
    return ollamaResponse;
  } catch (error: unknown) {
    logger.error('Error in generateOllamaText:', error);
    return 'Error generating text. Please try again later.';
  }
}

/**
 * Generates an object from the Ollama API using the specified model and parameters.
 *
 * Returns the generated object, or an empty object if generation fails.
 */
async function generateOllamaObject(
  ollama: ReturnType<typeof createOllama>,
  model: string,
  params: ObjectGenerationParams
) {
  try {
    const { object } = await generateObject({
      model: ollama(model),
      output: 'no-schema',
      prompt: params.prompt,
      temperature: params.temperature,
    });
    return object;
  } catch (error: unknown) {
    logger.error('Error generating object:', error);
    return {};
  }
}

export const ollamaPlugin: Plugin = {
  name: 'ollama',
  description: 'Ollama plugin',
  config: {
    OLLAMA_API_ENDPOINT: process.env.OLLAMA_API_ENDPOINT,
    OLLAMA_SMALL_MODEL: process.env.OLLAMA_SMALL_MODEL,
    OLLAMA_MEDIUM_MODEL: process.env.OLLAMA_MEDIUM_MODEL,
    OLLAMA_LARGE_MODEL: process.env.OLLAMA_LARGE_MODEL,
    OLLAMA_EMBEDDING_MODEL: process.env.OLLAMA_EMBEDDING_MODEL,
  },
  async init(_config, runtime) {
    // Register the validation service
    await runtime.registerService(OllamaValidationService);

    const baseURL = getBaseURL(runtime);

    // Check if endpoint is configured
    if (!baseURL || baseURL === 'http://localhost:11434/api') {
      const endpoint = runtime.getSetting('OLLAMA_API_ENDPOINT');
      if (!endpoint) {
        logger.warn(
          'OLLAMA_API_ENDPOINT is not set in environment - Ollama functionality will use default localhost:11434'
        );
      }
    }

    try {
      // Validate Ollama API endpoint by checking if it's accessible
      // Remove /api suffix for direct API calls
      const apiBase = baseURL.endsWith('/api') ? baseURL.slice(0, -4) : baseURL;
      const response = await fetch(`${apiBase}/api/tags`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        logger.warn(`Ollama API endpoint validation failed: ${response.statusText}`);
        logger.warn('Ollama functionality will be limited until a valid endpoint is provided');
      } else {
        const data = (await response.json()) as {
          models?: Array<{ name: string }>;
        };
        const modelCount = data?.models?.length || 0;
        logger.log(
          `Ollama API endpoint validated successfully. Found ${modelCount} models available.`
        );
      }
    } catch (fetchError: unknown) {
      const message = fetchError instanceof Error ? fetchError.message : String(fetchError);
      logger.warn(`Error validating Ollama API endpoint: ${message}`);
      logger.warn(
        'Ollama functionality will be limited until a valid endpoint is provided - Make sure Ollama is running at ${baseURL}'
      );
    }
  },

  models: {
    [ModelType.TEXT_EMBEDDING]: async (
      runtime,
      params: TextEmbeddingParams | string | null
    ): Promise<number[]> => {
      try {
        const baseURL = getBaseURL(runtime);
        const ollama = createOllama({
          fetch: runtime.fetch,
          baseURL,
        });

        const modelName = runtime.getSetting('OLLAMA_EMBEDDING_MODEL') || 'nomic-embed-text';
        logger.log(`[Ollama] Using TEXT_EMBEDDING model: ${modelName}`);
        await ensureModelAvailable(runtime, modelName, baseURL);

        // Handle initialization case where params is null
        if (params === null) {
          logger.debug('Creating test embedding for initialization');

          // Get the expected dimension from runtime settings or use default based on model
          const embeddingDimension = runtime.getSetting('EMBEDDING_DIMENSION');
          let dimension = 768; // Default for nomic-embed-text

          if (embeddingDimension) {
            dimension = parseInt(embeddingDimension, 10);
          } else {
            // Use known dimensions for common models
            const modelDimensions: Record<string, number> = {
              'nomic-embed-text': 768,
              'mxbai-embed-large': 1024,
              'all-minilm': 384,
              'bge-small-en': 384,
              'bge-base-en': 768,
              'bge-large-en': 1024,
            };

            // Check if we know the dimension for this model
            for (const [modelKey, dim] of Object.entries(modelDimensions)) {
              if (modelName.toLowerCase().includes(modelKey)) {
                dimension = dim;
                break;
              }
            }
          }

          logger.debug(`Returning test embedding with dimension: ${dimension}`);
          const testVector = Array(dimension).fill(0);
          testVector[0] = 0.1; // Set first element to non-zero for validation
          return testVector;
        }

        let text: string;
        if (typeof params === 'string') {
          text = params;
        } else if (typeof params === 'object' && params && 'text' in params) {
          text = params.text || '';
        } else {
          logger.warn('Invalid input format for embedding');
          const embeddingDimension = parseInt(
            runtime.getSetting('EMBEDDING_DIMENSION') || '768',
            10
          );
          const fallbackVector = Array(embeddingDimension).fill(0);
          fallbackVector[0] = 0.2; // Different marker for invalid format
          return fallbackVector;
        }

        if (!text.trim()) {
          logger.warn('Empty text for embedding');
          const embeddingDimension = parseInt(
            runtime.getSetting('EMBEDDING_DIMENSION') || '768',
            10
          );
          const emptyVector = Array(embeddingDimension).fill(0);
          emptyVector[0] = 0.3; // Different marker for empty text
          return emptyVector;
        }

        // Use ollama.embedding() as shown in the docs
        try {
          const { embedding } = await embed({
            model: ollama.embedding(modelName),
            value: text,
          });
          return embedding;
        } catch (embeddingError) {
          logger.error('Error generating embedding:', embeddingError);
          const embeddingDimension = parseInt(
            runtime.getSetting('EMBEDDING_DIMENSION') || '768',
            10
          );
          return Array(embeddingDimension).fill(0);
        }
      } catch (error) {
        logger.error('Error in TEXT_EMBEDDING model:', error);
        // Return a fallback vector rather than crashing
        const embeddingDimension = parseInt(runtime.getSetting('EMBEDDING_DIMENSION') || '768', 10);
        return Array(embeddingDimension).fill(0);
      }
    },
    [ModelType.TEXT_SMALL]: async (runtime, params: any) => {
      try {
        const temperature = 0.7;
        const frequency_penalty = 0.7;
        const presence_penalty = 0.7;
        const max_response_length = 8000;
        const baseURL = getBaseURL(runtime);
        const ollama = createOllama({
          fetch: runtime.fetch,
          baseURL,
        });

        const model =
          runtime.getSetting('OLLAMA_SMALL_MODEL') ||
          runtime.getSetting('SMALL_MODEL') ||
          'llama3.2:3b';

        logger.log(`[Ollama] Using TEXT_SMALL model: ${model}`);
        await ensureModelAvailable(runtime, model, baseURL);

        // Handle both prompt and messages format
        let prompt = params.prompt;
        if (!prompt && params.messages) {
          prompt = messagesToPrompt(params.messages);
        }

        if (!prompt) {
          logger.error('No prompt or messages provided');
          return 'Error: No prompt provided';
        }

        logger.log('generating text');
        logger.log(prompt);

        return await generateOllamaText(ollama, model, {
          prompt,
          system: runtime.character?.system || undefined,
          temperature,
          maxTokens: max_response_length,
          frequencyPenalty: frequency_penalty,
          presencePenalty: presence_penalty,
          stopSequences: params.stopSequences || [],
        });
      } catch (error) {
        logger.error('Error in TEXT_SMALL model:', error);
        return 'Error generating text. Please try again later.';
      }
    },
    [ModelType.TEXT_LARGE]: async (runtime, params: any) => {
      try {
        const model =
          runtime.getSetting('OLLAMA_LARGE_MODEL') ||
          runtime.getSetting('LARGE_MODEL') ||
          'llama3.2:3b';
        const baseURL = getBaseURL(runtime);
        const ollama = createOllama({
          fetch: runtime.fetch,
          baseURL,
        });

        // Handle both prompt and messages format
        let prompt = params.prompt;
        if (!prompt && params.messages) {
          prompt = messagesToPrompt(params.messages);
        }

        if (!prompt) {
          logger.error('No prompt or messages provided');
          return 'Error: No prompt provided';
        }

        logger.log(`[Ollama] Using TEXT_LARGE model: ${model}`);
        await ensureModelAvailable(runtime, model, baseURL);
        return await generateOllamaText(ollama, model, {
          prompt,
          system: runtime.character?.system || undefined,
          temperature: params.temperature || 0.7,
          maxTokens: params.maxTokens || 8192,
          frequencyPenalty: params.frequencyPenalty || 0.7,
          presencePenalty: params.presencePenalty || 0.7,
          stopSequences: params.stopSequences || [],
        });
      } catch (error) {
        logger.error('Error in TEXT_LARGE model:', error);
        return 'Error generating text. Please try again later.';
      }
    },
    [ModelType.OBJECT_SMALL]: async (runtime, params: ObjectGenerationParams) => {
      try {
        const baseURL = getBaseURL(runtime);
        const ollama = createOllama({
          fetch: runtime.fetch,
          baseURL,
        });
        const model =
          runtime.getSetting('OLLAMA_SMALL_MODEL') ||
          runtime.getSetting('SMALL_MODEL') ||
          'llama3.2:3b';

        logger.log(`[Ollama] Using OBJECT_SMALL model: ${model}`);
        await ensureModelAvailable(runtime, model, baseURL);
        if (params.schema) {
          logger.info('Using OBJECT_SMALL without schema validation');
        }

        return await generateOllamaObject(ollama, model, params);
      } catch (error) {
        logger.error('Error in OBJECT_SMALL model:', error);
        // Return empty object instead of crashing
        return {};
      }
    },
    [ModelType.OBJECT_LARGE]: async (runtime, params: ObjectGenerationParams) => {
      try {
        const baseURL = getBaseURL(runtime);
        const ollama = createOllama({
          fetch: runtime.fetch,
          baseURL,
        });
        const model =
          runtime.getSetting('OLLAMA_LARGE_MODEL') ||
          runtime.getSetting('LARGE_MODEL') ||
          'llama3.2:3b';

        logger.log(`[Ollama] Using OBJECT_LARGE model: ${model}`);
        await ensureModelAvailable(runtime, model, baseURL);
        if (params.schema) {
          logger.info('Using OBJECT_LARGE without schema validation');
        }

        return await generateOllamaObject(ollama, model, params);
      } catch (error) {
        logger.error('Error in OBJECT_LARGE model:', error);
        // Return empty object instead of crashing
        return {};
      }
    },
  },
  tests: [
    {
      name: 'ollama_plugin_tests',
      tests: [
        {
          name: 'ollama_test_url_validation',
          fn: async (runtime) => {
            try {
              const baseURL = getBaseURL(runtime);
              // Remove /api suffix for direct API calls
              const apiBase = baseURL.endsWith('/api') ? baseURL.slice(0, -4) : baseURL;
              const response = await fetch(`${apiBase}/api/tags`);
              const data = await response.json();
              logger.log(
                'Models Available:',
                data && typeof data === 'object' && 'models' in data && Array.isArray(data.models)
                  ? data.models.length
                  : 0
              );
              if (!response.ok) {
                logger.error(`Failed to validate Ollama API: ${response.statusText}`);
                return;
              }
            } catch (error) {
              logger.error('Error in ollama_test_url_validation:', error);
            }
          },
        },
        {
          name: 'ollama_test_text_embedding',
          fn: async (runtime) => {
            try {
              const embedding = await runtime.useModel(ModelType.TEXT_EMBEDDING, {
                text: 'Hello, world!',
              });
              logger.log('embedding', embedding);
            } catch (error) {
              logger.error('Error in test_text_embedding:', error);
            }
          },
        },
        {
          name: 'ollama_test_text_large',
          fn: async (runtime) => {
            try {
              const text = await runtime.useModel(ModelType.TEXT_LARGE, {
                messages: [
                  {
                    role: 'user' as const,
                    content: [
                      {
                        type: 'text' as const,
                        text: 'What is the nature of reality in 10 words?',
                      },
                    ],
                  },
                ],
              });
              if (text.length === 0) {
                logger.error('Failed to generate text');
                return;
              }
              logger.log('generated with test_text_large:', text);
            } catch (error) {
              logger.error('Error in test_text_large:', error);
            }
          },
        },
        {
          name: 'ollama_test_text_small',
          fn: async (runtime) => {
            try {
              const text = await runtime.useModel(ModelType.TEXT_SMALL, {
                prompt: 'What is the nature of reality in 10 words?',
              });
              if (text.length === 0) {
                logger.error('Failed to generate text');
                return;
              }
              logger.log('generated with test_text_small:', text);
            } catch (error) {
              logger.error('Error in test_text_small:', error);
            }
          },
        },
        {
          name: 'ollama_test_object_small',
          fn: async (runtime) => {
            try {
              const object = await runtime.useModel(ModelType.OBJECT_SMALL, {
                prompt:
                  'Generate a JSON object representing a user profile with name, age, and hobbies',
                temperature: 0.7,
                schema: undefined,
              });
              logger.log('Generated object:', object);
            } catch (error) {
              logger.error('Error in test_object_small:', error);
            }
          },
        },
        {
          name: 'ollama_test_object_large',
          fn: async (runtime) => {
            try {
              const object = await runtime.useModel(ModelType.OBJECT_LARGE, {
                prompt:
                  'Generate a detailed JSON object representing a restaurant with name, cuisine type, menu items with prices, and customer reviews',
                temperature: 0.7,
                schema: undefined,
              });
              logger.log('Generated object:', object);
            } catch (error) {
              logger.error('Error in test_object_large:', error);
            }
          },
        },
      ],
    },
  ],
};
export default ollamaPlugin;
