import type {
  GenerateTextParams,
  IAgentRuntime,
  ImageDescriptionParams,
  ObjectGenerationParams,
  Plugin,
  ServiceTypeName,
  TextEmbeddingParams,
} from '@elizaos/core';
import { logger, ModelType, Service } from '@elizaos/core';
import { z } from 'zod';
import {
  AgentAuthService,
  authPluginIntegration,
  AuthStatusChecker,
  QuickAuthSetup,
} from './auth/index';
// Removed multi-provider imports - now using ElizaOS API service directly
import { ElizaOSServicesTestSuite } from './tests';
import { RealIntegrationTestSuite } from './tests/real-integration.test';
import { StorageIntegrationTestSuite } from './tests/storage-integration.test';
import { ValidationSummaryTestSuite } from './tests/validation-summary.test';
import {
  makeElizaOSRequest,
  getModelForType,
  checkElizaOSAPI,
  type ElizaOSChatCompletionRequest,
} from './providers/elizaos-provider.js';
/**
 * Dynamically import AWS SDK packages with fallback handling
 */
async function importAWSSDK() {
  
    // Use dynamic imports that will be resolved at runtime
    const s3Module = await import('@aws-sdk/client-s3').catch(() => null);
    const presignerModule = await import('@aws-sdk/s3-request-presigner').catch(() => null);
    const mimeModule = await import('mime-types').catch(() => null);

    if (!s3Module || !presignerModule || !mimeModule) {
      throw new Error('AWS SDK modules not available');
    }

    return {
      S3Client: s3Module.S3Client,
      PutObjectCommand: s3Module.PutObjectCommand,
      GetObjectCommand: s3Module.GetObjectCommand,
      DeleteObjectCommand: s3Module.DeleteObjectCommand,
      HeadObjectCommand: s3Module.HeadObjectCommand,
      ListObjectsV2Command: s3Module.ListObjectsV2Command,
      getSignedUrl: presignerModule.getSignedUrl,
      lookup: mimeModule.lookup,
    };
  } catch (_error) {
    logger.warn('AWS SDK packages not available - storage functionality will be limited');
    return null;
  }
}

/**
 * Configuration schema for ElizaOS Services plugin
 */
const configSchema = z.object({
  ELIZAOS_API_URL: z.string().url('Invalid ElizaOS API URL').default('https://api.elizaos.ai'),
  ELIZAOS_API_KEY: z
    .string()
    .min(1, 'ElizaOS API key is required')
    .optional()
    .transform((val) => {
      if (!val) {
        logger.warn('ElizaOS API key not provided - some features will be limited');
      }
      return val;
    }),
  ELIZAOS_STORAGE_ENDPOINT: z.string().url('Invalid storage endpoint URL').optional(),
  ELIZAOS_STORAGE_BUCKET: z.string().min(1, 'Storage bucket name is required').optional(),
  ELIZAOS_STORAGE_ACCESS_KEY: z.string().min(1, 'Storage access key is required').optional(),
  ELIZAOS_STORAGE_SECRET_KEY: z.string().min(1, 'Storage secret key is required').optional(),
});

/**
 * Helper functions for API interactions
 */
function getSetting(
  runtime: IAgentRuntime,
  key: string,
  defaultValue?: string
): string | undefined {
  return runtime.getSetting(key) ?? process.env[key] ?? defaultValue;
}

function getStorageConfig(runtime: IAgentRuntime) {
  return {
    endpoint: getSetting(runtime, 'ELIZAOS_STORAGE_ENDPOINT'),
    bucket: getSetting(runtime, 'ELIZAOS_STORAGE_BUCKET'),
    accessKey: getSetting(runtime, 'ELIZAOS_STORAGE_ACCESS_KEY'),
    secretKey: getSetting(runtime, 'ELIZAOS_STORAGE_SECRET_KEY'),
  };
}

/**
 * Create S3 client for storage operations
 */
async function createS3Client(runtime: IAgentRuntime): Promise<any | null> {
  const config = getStorageConfig(runtime);

  if (!config.endpoint || !config.accessKey || !config.secretKey) {
    return null;
  }

  try {
    const aws = await importAWSSDK();
    if (!aws) {
      logger.warn('AWS SDK not available - cannot create S3 client');
      return null;
    }

    return new aws.S3Client({
      endpoint: config.endpoint,
      region: 'auto', // Cloudflare R2 uses 'auto' region
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
      forcePathStyle: true, // Required for R2 compatibility
    });
  } catch (error) {
    logger.error(
      `Failed to create S3 client: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    return null;
  }
}

/**
 * Storage service for file uploads and management
 */
export class ElizaOSStorageService {
  private s3Client: any | null = null;
  private bucket: string;
  private runtime: IAgentRuntime;
  private awsSDK: any | null = null;
  private clientInitialized = false;

  constructor(runtime: IAgentRuntime) {
    this.runtime = runtime;
    this.bucket = getSetting(runtime, 'ELIZAOS_STORAGE_BUCKET') || 'elizaos-storage';
  }

  private async ensureInitialized(): Promise<void> {
    if (this.clientInitialized) {
      return;
    }

    try {
      this.awsSDK = await importAWSSDK();
      this.s3Client = await createS3Client(this.runtime);
      this.clientInitialized = true;
    } catch (error) {
      logger.error(
        `Failed to initialize storage service: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      this.clientInitialized = true; // Mark as initialized even on error to avoid repeated attempts
    }
  }

  async uploadFile(key: string, data: Buffer | Uint8Array, contentType?: string): Promise<string> {
    await this.ensureInitialized();

    if (!this.s3Client || !this.awsSDK) {
      throw new Error('Storage not configured - missing endpoint, credentials, or AWS SDK');
    }

    try {
      const detectedContentType =
        contentType || this.awsSDK.lookup(key) || 'application/octet-stream';

      const command = new this.awsSDK.PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: detectedContentType,
        Metadata: {
          uploadedAt: new Date().toISOString(),
          source: 'elizaos-services',
        },
      });

      await this.s3Client.send(command);
      logger.info(`Successfully uploaded file: ${key} (${data.length} bytes)`);
      return key;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to upload file ${key}: ${errorMessage}`);
      throw new Error(`Storage upload failed: ${errorMessage}`);
    }
  }

  async downloadFile(key: string): Promise<Buffer> {
    await this.ensureInitialized();

    if (!this.s3Client || !this.awsSDK) {
      throw new Error('Storage not configured - missing endpoint, credentials, or AWS SDK');
    }

    try {
      const command = new this.awsSDK.GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const response = await this.s3Client.send(command);

      if (!response.Body) {
        throw new Error('No data returned from storage');
      }

      // Convert stream to buffer
      const chunks: Uint8Array[] = [];
      const readable = response.Body as any;

      return new Promise((resolve, reject) => {
        readable.on('data', (chunk: Uint8Array) => chunks.push(chunk));
        readable.on('end', () => resolve(Buffer.concat(chunks)));
        readable.on('error', reject);
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to download file ${key}: ${errorMessage}`);
      throw new Error(`Storage download failed: ${errorMessage}`);
    }
  }

  async deleteFile(key: string): Promise<void> {
    await this.ensureInitialized();

    if (!this.s3Client || !this.awsSDK) {
      throw new Error('Storage not configured - missing endpoint, credentials, or AWS SDK');
    }

    try {
      const command = new this.awsSDK.DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      await this.s3Client.send(command);
      logger.info(`Successfully deleted file: ${key}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to delete file ${key}: ${errorMessage}`);
      throw new Error(`Storage delete failed: ${errorMessage}`);
    }
  }

  async getSignedUrl(
    key: string,
    operation: 'get' | 'put' = 'get',
    expiresIn: number = 3600
  ): Promise<string> {
    await this.ensureInitialized();

    if (!this.s3Client || !this.awsSDK) {
      throw new Error('Storage not configured - missing endpoint, credentials, or AWS SDK');
    }

    try {
      let command;

      if (operation === 'put') {
        command = new this.awsSDK.PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
        });
      } else {
        command = new this.awsSDK.GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        });
      }

      const signedUrl = await this.awsSDK.getSignedUrl(this.s3Client, command, { expiresIn });
      logger.debug(`Generated signed URL for ${operation} operation on ${key}`);
      return signedUrl;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to generate signed URL for ${key}: ${errorMessage}`);
      throw new Error(`Signed URL generation failed: ${errorMessage}`);
    }
  }

  async fileExists(key: string): Promise<boolean> {
    await this.ensureInitialized();

    if (!this.s3Client || !this.awsSDK) {
      return false;
    }

    try {
      const command = new this.awsSDK.HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      await this.s3Client.send(command);
      return true;
    } catch (error: any) {
      // S3 returns 404 for missing files
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return false;
      }

      // Log other errors but still return false
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.warn(`Error checking file existence for ${key}: ${errorMessage}`);
      return false;
    }
  }

  /**
   * List files in the bucket with optional prefix filter
   */
  async listFiles(prefix?: string, maxKeys: number = 1000): Promise<string[]> {
    await this.ensureInitialized();

    if (!this.s3Client || !this.awsSDK) {
      throw new Error('Storage not configured - missing endpoint, credentials, or AWS SDK');
    }

    try {
      const command = new this.awsSDK.ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        MaxKeys: maxKeys,
      });

      const response = await this.s3Client.send(command);
      return response.Contents?.map((obj: any) => obj.Key || '') || [];
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to list files: ${errorMessage}`);
      throw new Error(`Storage list failed: ${errorMessage}`);
    }
  }

  /**
   * Get file metadata without downloading the file
   */
  async getFileMetadata(
    key: string
  ): Promise<{ size: number; lastModified: Date; contentType: string } | null> {
    await this.ensureInitialized();

    if (!this.s3Client || !this.awsSDK) {
      throw new Error('Storage not configured - missing endpoint, credentials, or AWS SDK');
    }

    try {
      const command = new this.awsSDK.HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const response = await this.s3Client.send(command);

      return {
        size: response.ContentLength || 0,
        lastModified: response.LastModified || new Date(),
        contentType: response.ContentType || 'application/octet-stream',
      };
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return null;
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to get file metadata for ${key}: ${errorMessage}`);
      throw new Error(`Storage metadata failed: ${errorMessage}`);
    }
  }
}

/**
 * ElizaOS Services main service class
 */
export class ElizaOSService extends Service {
  static override serviceType: ServiceTypeName = 'elizaos-services' as ServiceTypeName;

  override capabilityDescription =
    'ElizaOS hosted AI inference and storage services with multi-provider support';

  private storage: ElizaOSStorageService;

  constructor(runtime: IAgentRuntime) {
    super(runtime);
    this.storage = new ElizaOSStorageService(runtime);
  }

  static async start(runtime: IAgentRuntime): Promise<ElizaOSService> {
    logger.info('Starting ElizaOS Services');

    // Test API connection
    const isConnected = await checkElizaOSAPI(runtime);
    if (isConnected) {
      logger.info('Successfully connected to ElizaOS API');
    } else {
      logger.warn('Failed to connect to ElizaOS API - check your API key and URL');
    }

    const service = new ElizaOSService(runtime);
    return service;
  }

  async stop(): Promise<void> {
    logger.info('Stopping ElizaOS Services');
  }

  static async stop(runtime: IAgentRuntime): Promise<void> {
    const service = runtime.getService<ElizaOSService>(ElizaOSService.serviceType);
    if (!service) {
      throw new Error('ElizaOS service not found');
    }
    await service.stop();
  }

  getStorage(): ElizaOSStorageService {
    return this.storage;
  }
}

/**
 * ElizaOS Services Plugin - hosted AI inference and storage
 */
export const elizaOSServicesPlugin: Plugin = {
  name: 'elizaos-services',
  description: 'ElizaOS hosted services for AI inference and storage',
  config: {
    ELIZAOS_API_URL: process.env.ELIZAOS_API_URL,
    ELIZAOS_API_KEY: process.env.ELIZAOS_API_KEY,
    ELIZAOS_STORAGE_ENDPOINT: process.env.ELIZAOS_STORAGE_ENDPOINT,
    ELIZAOS_STORAGE_BUCKET: process.env.ELIZAOS_STORAGE_BUCKET,
    ELIZAOS_STORAGE_ACCESS_KEY: process.env.ELIZAOS_STORAGE_ACCESS_KEY,
    ELIZAOS_STORAGE_SECRET_KEY: process.env.ELIZAOS_STORAGE_SECRET_KEY,
  },

  async init(config: Record<string, string>, runtime: IAgentRuntime) {
    logger.info('Initializing ElizaOS Services plugin with comprehensive authentication');

    try {
      const validatedConfig = await configSchema.parseAsync(config);

      // Set environment variables
      for (const [key, value] of Object.entries(validatedConfig)) {
        if (value) {
          process.env[key] = value;
        }
      }

      // Initialize authentication system
      logger.info('Initializing authentication system...');
      await authPluginIntegration.init?.(config, runtime);

      // Perform comprehensive authentication validation
      try {
        const authValidation = await QuickAuthSetup.quickValidation(runtime);

        if (authValidation.overall) {
          logger.info(`Authentication validation passed: ${authValidation.summary}`);
        } else {
          logger.warn(`Authentication validation issues: ${authValidation.summary}`);
          logger.info('Use `elizaos auth:setup` for configuration help');
        }

        // Check production readiness
        const productionCheck = await AuthStatusChecker.isProductionReady(runtime);
        if (!productionCheck.ready) {
          logger.warn('Production readiness issues detected:');
          productionCheck.issues.forEach((issue) => logger.warn(`  - ${issue}`));

          logger.info('Recommendations:');
          productionCheck.recommendations.forEach((rec) => logger.info(`  - ${rec}`));
        }
      } catch (authError) {
        logger.error('Authentication validation failed:', authError);
        logger.info('Plugin will continue with limited functionality');
      }

      // Register CLI commands if in CLI environment
      if (typeof process !== 'undefined' && process.argv) {
        try {
          const cliCommands = await QuickAuthSetup.initializeForCLI(runtime);
          logger.debug(`Registered ${cliCommands.length} authentication CLI commands`);
        } catch (cliError) {
          logger.warn('Failed to register CLI commands:', cliError);
        }
      }

      // Legacy provider validation (for backward compatibility)
      const availableProviders: string[] = [];
      const providerKeys = [
        { key: 'OPENAI_API_KEY', name: 'OpenAI' },
        { key: 'GROQ_API_KEY', name: 'Groq' },
        { key: 'ANTHROPIC_API_KEY', name: 'Anthropic' },
      ];

      for (const { key, name } of providerKeys) {
        const apiKey = runtime.getSetting(key) || process.env[key];
        if (apiKey && apiKey.length > 10) {
          availableProviders.push(name);
        }
      }

      if (availableProviders.length === 0) {
        logger.error('No valid AI provider API keys found.');
        logger.info(
          'At least one of OPENAI_API_KEY, GROQ_API_KEY, or ANTHROPIC_API_KEY must be configured.'
        );
        logger.info('Use `elizaos auth:setup` for guided configuration.');
        throw new Error('No valid AI provider API keys configured');
      }

      logger.info(
        `ElizaOS Services plugin initialized with providers: ${availableProviders.join(', ')}`
      );

      // Validate storage configuration if provided
      const storageKeys = [
        'ELIZAOS_STORAGE_ENDPOINT',
        'ELIZAOS_STORAGE_ACCESS_KEY',
        'ELIZAOS_STORAGE_SECRET_KEY',
      ];
      const storageConfigured = storageKeys.every(
        (key) => runtime.getSetting(key) || process.env[key]
      );

      if (storageConfigured) {
        logger.info('Storage service configured and available');
      } else {
        logger.warn('Storage service not fully configured - storage features will be limited');
      }

      // Final health check
      try {
        const healthReport = await AuthStatusChecker.getHealthReport(runtime);
        logger.info(`System health score: ${healthReport.healthScore}/100`);

        if (healthReport.healthScore >= 80) {
          logger.info('🎉 Plugin is ready for production deployment!');
        } else if (healthReport.healthScore >= 60) {
          logger.info('⚠️  Plugin is functional but could be improved');
        } else {
          logger.warn('⚠️  Plugin has significant configuration issues');
        }
      } catch (healthError) {
        logger.warn('Failed to generate health report:', healthError);
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(
          `Invalid ElizaOS Services configuration: ${error.errors.map((e) => e.message).join(', ')}`
        );
      }
      throw error;
    }
  },
  models: {
    [ModelType.TEXT_EMBEDDING]: async (
      runtime: IAgentRuntime,
      params: TextEmbeddingParams | string | null
    ): Promise<number[]> => {
      if (params === null) {
        logger.debug('Creating test embedding for initialization');
        return Array(1536)
          .fill(0)
          .map((_, i) => (i === 0 ? 0.1 : 0));
      }

      let text: string;
      if (typeof params === 'string') {
        text = params;
      } else if (typeof params === 'object' && params.text) {
        text = params.text;
      } else {
        throw new Error(
          'Invalid input format for embedding - expected string or object with text property'
        );
      }

      if (!text.trim()) {
        throw new Error('Empty text provided for embedding generation');
      }

      try {
        const apiUrl =
          runtime.getSetting('ELIZAOS_API_URL') ??
          process.env.ELIZAOS_API_URL ??
          'https://api.elizaos.ai';
        const apiKey = runtime.getSetting('ELIZAOS_API_KEY') ?? process.env.ELIZAOS_API_KEY;

        if (!apiKey) {
          throw new Error('ELIZAOS_API_KEY is required for embeddings');
        }

        const url = `${apiUrl}/api/v1/chat/embeddings`;
        const model = getModelForType(ModelType.TEXT_EMBEDDING);

        logger.debug(`Generating embedding for text of length ${text.length}`);

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            input: text,
            model,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          logger.error(`ElizaOS API embeddings error ${response.status}: ${errorText}`);
          throw new Error(`ElizaOS API embeddings error ${response.status}: ${errorText}`);
        }

        const data = await response.json();

        // Extract embedding from OpenAI-compatible response
        if (data.data && data.data.length > 0 && data.data[0].embedding) {
          return data.data[0].embedding;
        }

        throw new Error('Invalid embeddings response format');
      
    },

    [ModelType.TEXT_SMALL]: async (
      runtime: IAgentRuntime,
      { prompt, stopSequences = [], maxTokens = 4096, temperature = 0.7 }: GenerateTextParams
    ) => {
      try {
        const model = getModelForType(ModelType.TEXT_SMALL);
        const request: ElizaOSChatCompletionRequest = {
          model,
          messages: [
            { role: 'system', content: runtime.character.system || 'You are a helpful assistant.' },
            { role: 'user', content: prompt },
          ],
          max_tokens: maxTokens,
          temperature,
          stop: stopSequences.length > 0 ? stopSequences : undefined,
        };

        const data = await makeElizaOSRequest(runtime, request);
        return data.choices[0].message.content || '';
      } catch (error) {
        logger.error(
          `Error generating text (small): ${error instanceof Error ? error.message : 'Unknown error'}`
        );
        throw error;
      }
    },

    [ModelType.TEXT_LARGE]: async (
      runtime: IAgentRuntime,
      {
        prompt,
        stopSequences = [],
        maxTokens = 8192,
        temperature = 0.7,
        frequencyPenalty = 0,
        presencePenalty = 0,
      }: GenerateTextParams
    ) => {
      try {
        const model = getModelForType(ModelType.TEXT_LARGE);
        const request: ElizaOSChatCompletionRequest = {
          model,
          messages: [
            { role: 'system', content: runtime.character.system || 'You are a helpful assistant.' },
            { role: 'user', content: prompt },
          ],
          max_tokens: maxTokens,
          temperature,
          frequency_penalty: frequencyPenalty,
          presence_penalty: presencePenalty,
          stop: stopSequences.length > 0 ? stopSequences : undefined,
        };

        const data = await makeElizaOSRequest(runtime, request);
        return data.choices[0].message.content || '';
      } catch (error) {
        logger.error(
          `Error generating text (large): ${error instanceof Error ? error.message : 'Unknown error'}`
        );
        throw error;
      }
    },

    [ModelType.IMAGE_DESCRIPTION]: async (
      runtime: IAgentRuntime,
      params: ImageDescriptionParams | string
    ) => {
      let imageUrl: string;
      let promptText: string;

      if (typeof params === 'string') {
        imageUrl = params;
        promptText = 'Please analyze this image and provide a title and detailed description.';
      } else {
        imageUrl = params.imageUrl;
        promptText =
          params.prompt ||
          'Please analyze this image and provide a title and detailed description.';
      }

      try {
        const model = getModelForType(ModelType.IMAGE_DESCRIPTION);
        const request: ElizaOSChatCompletionRequest = {
          model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: promptText },
                { type: 'image_url', image_url: { url: imageUrl } },
              ] as any, // ElizaOS API supports vision content
            },
          ],
          max_tokens: 2048,
        };

        const data = await makeElizaOSRequest(runtime, request);
        const content = data.choices[0].message.content;

        // Check if custom prompt - return raw content
        const isCustomPrompt =
          typeof params === 'object' &&
          params.prompt &&
          params.prompt !==
            'Please analyze this image and provide a title and detailed description.';

        if (isCustomPrompt) {
          return content;
        }

        // Parse for title/description format
        const titleMatch = content?.match(/title[:\s]+(.+?)(?:\n|$)/i);
        const title = titleMatch?.[1]?.trim() || 'Image Analysis';
        const description = content?.replace(/title[:\s]+(.+?)(?:\n|$)/i, '').trim() || '';

        return { title, description };
      } catch (error) {
        logger.error(
          `Error analyzing image: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
        return {
          title: 'Failed to analyze image',
          description: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
      }
    },

    [ModelType.OBJECT_SMALL]: async (runtime: IAgentRuntime, params: ObjectGenerationParams) => {
      try {
        const model = getModelForType(ModelType.OBJECT_SMALL);
        const request: ElizaOSChatCompletionRequest = {
          model,
          messages: [
            { role: 'user', content: `${params.prompt}\n\nRespond with valid JSON only.` },
          ],
          temperature: params.temperature || 0,
          max_tokens: 4096,
        };

        const data = await makeElizaOSRequest(runtime, request);
        const content = data.choices[0].message.content;

        // Try to parse JSON from content
        try {
          const cleanedContent = (content || '').replace(/```json\n?|\n?```/g, '').trim();
          return JSON.parse(cleanedContent);
        } catch (_parseError) {
          logger.warn('Failed to parse JSON response, returning raw content');
          return { text: content || '' };
        }
      } catch (error) {
        logger.error(
          `Error generating object (small): ${error instanceof Error ? error.message : 'Unknown error'}`
        );
        throw error;
      }
    },

    [ModelType.OBJECT_LARGE]: async (runtime: IAgentRuntime, params: ObjectGenerationParams) => {
      try {
        const model = getModelForType(ModelType.OBJECT_LARGE);
        const request: ElizaOSChatCompletionRequest = {
          model,
          messages: [
            { role: 'user', content: `${params.prompt}\n\nRespond with valid JSON only.` },
          ],
          temperature: params.temperature || 0,
          max_tokens: 8192,
        };

        const data = await makeElizaOSRequest(runtime, request);
        const content = data.choices[0].message.content;

        // Try to parse JSON from content
        try {
          const cleanedContent = (content || '').replace(/```json\n?|\n?```/g, '').trim();
          return JSON.parse(cleanedContent);
        } catch (_parseError) {
          logger.warn('Failed to parse JSON response, returning raw content');
          return { text: content || '' };
        }
      } catch (error) {
        logger.error(
          `Error generating object (large): ${error instanceof Error ? error.message : 'Unknown error'}`
        );
        throw error;
      }
    },
  },
  services: [ElizaOSService, AgentAuthService],
  tests: [
    ElizaOSServicesTestSuite,
    RealIntegrationTestSuite,
    StorageIntegrationTestSuite,
    ValidationSummaryTestSuite,
  ],
};

export default elizaOSServicesPlugin;
