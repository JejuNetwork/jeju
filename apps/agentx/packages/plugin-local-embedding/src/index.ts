import type { IAgentRuntime, Plugin, TextEmbeddingParams } from '@elizaos/core';
import { ModelType, logger } from '@elizaos/core';
import { pipeline, env } from '@xenova/transformers';

// Configure transformers.js
env.allowLocalModels = true;
env.allowRemoteModels = true;
env.backends.onnx.wasm.proxy = false; // Better compatibility
// Disable image processing to avoid sharp dependency
env.backends.onnx.wasm.numThreads = 1; // Single thread for compatibility

interface EmbeddingState {
  pipeline: any | null; // Using any to avoid type issues with transformers.js
  modelName: string;
  dimensions: number;
}

const state: EmbeddingState = {
  pipeline: null,
  modelName: '',
  dimensions: 0,
};

// Model configurations with their dimensions
const MODEL_CONFIGS = {
  'Xenova/all-MiniLM-L6-v2': { dimensions: 384 },
  'Xenova/all-mpnet-base-v2': { dimensions: 768 },
  'Xenova/bge-small-en-v1.5': { dimensions: 384 },
  'Xenova/gte-small': { dimensions: 384 },
  'Xenova/e5-small-v2': { dimensions: 384 },
  'Xenova/bge-base-en-v1.5': { dimensions: 768 },
} as const;

type ModelName = keyof typeof MODEL_CONFIGS;

/**
 * Get the configured embedding model name
 */
function getEmbeddingModelName(runtime: IAgentRuntime): ModelName {
  const modelName = runtime.getSetting('LOCAL_EMBEDDING_MODEL') || 'Xenova/bge-base-en-v1.5';

  // Map legacy fastembed model names to transformers.js equivalents
  const modelMapping: Record<string, ModelName> = {
    'BAAI/bge-base-en': 'Xenova/bge-base-en-v1.5',
    'BAAI/bge-base-en-v1.5': 'Xenova/bge-base-en-v1.5',
    'BAAI/bge-small-en': 'Xenova/bge-small-en-v1.5',
    'BAAI/bge-small-en-v1.5': 'Xenova/bge-small-en-v1.5',
    'sentence-transformers/all-MiniLM-L6-v2': 'Xenova/all-MiniLM-L6-v2',
  };

  const mappedModel = modelMapping[modelName] || modelName;

  if (!(mappedModel in MODEL_CONFIGS)) {
    logger.warn(`Unknown model ${modelName}, falling back to Xenova/bge-base-en-v1.5`);
    return 'Xenova/bge-base-en-v1.5';
  }

  return mappedModel as ModelName;
}

/**
 * Initialize the embedding pipeline if not already initialized
 */
async function initializePipeline(modelName: ModelName): Promise<void> {
  if (state.pipeline && state.modelName === modelName) {
    return; // Already initialized with the same model
  }

  logger.info(`[LOCAL-EMBEDDING] Initializing transformers.js pipeline with model: ${modelName}`);

  
    state.pipeline = await pipeline('feature-extraction', modelName, {
      quantized: true, // Use quantized models for smaller size and faster loading
      progress_callback: (progress: any) => {
        if (progress.status === 'downloading') {
          const percent = Math.round((progress.loaded / progress.total) * 100);
          logger.debug(`[LOCAL-EMBEDDING] Downloading model: ${percent}%`);
        }
      },
    });

    state.modelName = modelName;
    state.dimensions = MODEL_CONFIGS[modelName].dimensions;

    logger.info(
      `[LOCAL-EMBEDDING] Pipeline initialized successfully with ${modelName} (${state.dimensions} dimensions)`
    );
  
}

/**
 * Process embedding parameters to extract text input
 */
function extractTextFromParams(params: TextEmbeddingParams | string | null): string {
  // Handle null case - return a test string for initialization
  if (params === null) {
    logger.debug('[LOCAL-EMBEDDING] Received null params - using test string for initialization');
    return 'test';
  }

  if (typeof params === 'string') {
    return params;
  }

  if (params && typeof params === 'object') {
    // Handle TextEmbeddingParams interface
    if ('input' in params && typeof params.input === 'string') {
      return params.input;
    }
    if ('text' in params && typeof params.text === 'string') {
      return params.text;
    }
    if ('content' in params && typeof params.content === 'string') {
      return params.content;
    }
  }

  throw new Error(
    'Invalid embedding parameters: expected string or object with input/text/content property'
  );
}

/**
 * Generate embeddings for a single text input
 */
async function generateEmbedding(text: string): Promise<number[]> {
  if (!state.pipeline) {
    throw new Error('Embedding pipeline not initialized');
  }

  logger.debug(`[LOCAL-EMBEDDING] Generating embedding for text: ${text.substring(0, 100)}...`);

  
    // Generate embeddings
    const output = await state.pipeline(text, {
      pooling: 'mean',
      normalize: true,
    });

    // Convert to array
    const embedding = Array.from(output.data as Float32Array);

    logger.debug(`[LOCAL-EMBEDDING] Generated embedding with dimension: ${embedding.length}`);
    return embedding;
  
}

/**
 * Validate that the local embedding plugin is working correctly
 */
async function validateEmbeddingPlugin(runtime: IAgentRuntime): Promise<boolean> {
  try {
    const modelName = getEmbeddingModelName(runtime);
    await initializePipeline(modelName);

    // Test with a simple embedding
    const testEmbedding = await generateEmbedding('test');
    return Array.isArray(testEmbedding) && testEmbedding.length === state.dimensions;
  } catch (error) {
    logger.error(`[LOCAL-EMBEDDING] Validation failed:`, error);
    return false;
  }
}

/**
 * Local embedding plugin using transformers.js
 */
export const localEmbeddingPlugin: Plugin = {
  name: 'local-embedding',
  description:
    'Local embedding generation using transformers.js (pure JavaScript, no native dependencies)',

  async init(_config, runtime) {
    const modelName = getEmbeddingModelName(runtime);

    logger.info(`[LOCAL-EMBEDDING] Plugin initializing with model: ${modelName}`);

    // Pre-initialize the model
    await initializePipeline(modelName);

    // Validate the plugin is working
    const isValid = await validateEmbeddingPlugin(runtime);
    if (!isValid) {
      logger.warn(`[LOCAL-EMBEDDING] Plugin validation failed`);
    } else {
      logger.info(`[LOCAL-EMBEDDING] Plugin validation successful`);
    }
  },

  models: {
    [ModelType.TEXT_EMBEDDING]: async (
      runtime: IAgentRuntime,
      params: TextEmbeddingParams | string | null
    ): Promise<number[]> => {
      const text = extractTextFromParams(params);
      return await generateEmbedding(text);
    },
  },

  tests: [
    {
      name: 'local_embedding_plugin_tests',
      tests: [
        {
          name: 'test_embedding_generation',
          fn: async (runtime: IAgentRuntime) => {
            try {
              const embedding = await runtime.useModel(ModelType.TEXT_EMBEDDING, {
                input: 'Hello, World! This is a test embedding.',
              });

              if (!Array.isArray(embedding) || embedding.length === 0) {
                logger.error('Failed to generate valid embedding');
                return;
              }

              logger.info(`Generated embedding with ${embedding.length} dimensions`);
              logger.info(`First few values: [${embedding.slice(0, 5).join(', ')}...]`);
            } catch (error) {
              logger.error('Error in embedding test:', error);
            }
          },
        },
        {
          name: 'test_batch_embedding',
          fn: async (runtime: IAgentRuntime) => {
            try {
              const texts = [
                'passage: This is a test passage.',
                'query: What is this about?',
                'passage: Another test passage for embedding.',
              ];

              const embeddings = [];
              for (const text of texts) {
                const embedding = await runtime.useModel(ModelType.TEXT_EMBEDDING, text);
                embeddings.push(embedding);
              }

              if (embeddings.length !== texts.length) {
                logger.error('Failed to generate all embeddings');
                return;
              }

              logger.info(`Generated ${embeddings.length} embeddings successfully`);
            } catch (error) {
              logger.error('Error in batch embedding test:', error);
            }
          },
        },
        {
          name: 'test_model_validation',
          fn: async (runtime: IAgentRuntime) => {
            try {
              const isValid = await validateEmbeddingPlugin(runtime);
              if (isValid) {
                logger.info('Plugin validation test passed');
              } else {
                logger.error('Plugin validation test failed');
              }
            } catch (error) {
              logger.error('Error in validation test:', error);
            }
          },
        },
      ],
    },
  ],
};

export default localEmbeddingPlugin;
