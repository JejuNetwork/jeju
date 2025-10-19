/**
 * ElizaOS API Provider
 * Calls the centralized ElizaOS API service instead of direct provider APIs
 */

import { IAgentRuntime, ModelTypeName, logger } from '@elizaos/core';

/**
 * Structured error type for ElizaOS API responses
 */
export interface ElizaOSAPIError extends Error {
  code: string;
  status: number;
  details?: any;
  retryable?: boolean;
  requestId?: string;
}

/**
 * Creates a structured ElizaOS API error
 */
export function createElizaOSError(
  message: string,
  status: number,
  code?: string,
  details?: any,
  retryable = false
): ElizaOSAPIError {
  const error = new Error(message) as ElizaOSAPIError;
  error.name = 'ElizaOSAPIError';
  error.code = code || `HTTP_${status}`;
  error.status = status;
  error.details = details;
  error.retryable = retryable;
  return error;
}

export interface ElizaOSAPIResponse {
  id: string;
  object: 'chat.completion' | 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'system' | 'user' | 'assistant' | 'tool';
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_cost: number;
    completion_cost: number;
    total_cost: number;
  };
  system_fingerprint?: string;
}

export interface ElizaOSChatCompletionRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content:
      | string
      | Array<{
          type: 'text' | 'image_url';
          text?: string;
          image_url?: {
            url: string;
            detail?: 'low' | 'high' | 'auto';
          };
        }>;
    name?: string;
    tool_calls?: Array<{
      id: string;
      type: 'function';
      function: {
        name: string;
        arguments: string;
      };
    }>;
    tool_call_id?: string;
  }>;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  stream?: boolean;
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, any>;
    };
  }>;
  tool_choice?:
    | 'none'
    | 'auto'
    | string
    | {
        type: 'function';
        function: { name: string };
      };
  user?: string;
}

/**
 * Get ElizaOS API URL from runtime settings
 */
function getAPIUrl(runtime: IAgentRuntime): string {
  return (
    runtime.getSetting('ELIZAOS_API_URL') ?? process.env.ELIZAOS_API_URL ?? 'https://api.elizaos.ai'
  );
}

/**
 * Get ElizaOS API key from runtime settings
 */
function getAPIKey(runtime: IAgentRuntime): string | undefined {
  return runtime.getSetting('ELIZAOS_API_KEY') ?? process.env.ELIZAOS_API_KEY;
}

/**
 * Makes a chat completion request to the ElizaOS API service
 *
 * @param runtime - Agent runtime for configuration access
 * @param request - OpenAI-compatible chat completion request
 * @returns Promise resolving to the API response
 * @throws {ElizaOSAPIError} When API request fails
 *
 * @example
 * ```typescript
 * const response = await makeElizaOSRequest(runtime, {
 *   model: 'gpt-4o-mini',
 *   messages: [{ role: 'user', content: 'Hello' }]
 * });
 * ```
 */
export async function makeElizaOSRequest(
  runtime: IAgentRuntime,
  request: ElizaOSChatCompletionRequest
): Promise<ElizaOSAPIResponse> {
  const apiUrl = getAPIUrl(runtime);
  const apiKey = getAPIKey(runtime);

  if (!apiKey) {
    throw createElizaOSError(
      'ELIZAOS_API_KEY is required but not configured',
      401,
      'MISSING_API_KEY'
    );
  }

  const url = `${apiUrl}/api/v1/chat/completions`;
  const requestId = generateRequestId();

  logger.debug(`Making request to ElizaOS API: ${url} [${requestId}]`);
  logger.debug(`Request payload:`, request);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Request-ID': requestId,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      let errorDetails: any;
      let errorText: string;

      try {
        errorDetails = await response.json();
        errorText = errorDetails.error?.message || response.statusText;
      } catch {
        errorText = (await response.text()) || response.statusText;
      }

      logger.error(`ElizaOS API error ${response.status}: ${errorText} [${requestId}]`);

      const isRetryable = response.status >= 500 || response.status === 429;

      throw createElizaOSError(
        errorText,
        response.status,
        errorDetails?.error?.code || `HTTP_${response.status}`,
        errorDetails,
        isRetryable
      );
    }

    const data = await response.json();
    logger.debug(`ElizaOS API response: [${requestId}]`, data);

    return data;
  } catch (error) {
    if (error instanceof Error && error.name === 'ElizaOSAPIError') {
      throw error;
    }

    logger.error(`ElizaOS API request failed: [${requestId}]`, error);

    throw createElizaOSError(
      `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      0,
      'NETWORK_ERROR',
      { originalError: error },
      true
    );
  }
}

/**
 * Generates a unique request ID for tracing
 */
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Get the appropriate model for a given model type
 */
export function getModelForType(modelType: ModelTypeName): string {
  switch (modelType) {
    case 'TEXT_SMALL':
      return 'gpt-4o-mini';
    case 'TEXT_LARGE':
      return 'gpt-4o';
    case 'IMAGE_DESCRIPTION':
      return 'gpt-4o';
    case 'OBJECT_SMALL':
      return 'gpt-4o-mini';
    case 'OBJECT_LARGE':
      return 'gpt-4o';
    case 'EMBEDDING':
      return 'text-embedding-3-small';
    case 'TEXT_EMBEDDING':
      return 'text-embedding-3-small';
    default:
      return 'gpt-4o-mini';
  }
}

/**
 * Check if ElizaOS API is available and accessible
 *
 * @param runtime - Agent runtime for configuration access
 * @returns Promise resolving to true if API is accessible, false otherwise
 *
 * @example
 * ```typescript
 * const isAvailable = await checkElizaOSAPI(runtime);
 * if (isAvailable) {
 *   console.log('ElizaOS API is ready');
 * }
 * ```
 */
export async function checkElizaOSAPI(runtime: IAgentRuntime): Promise<boolean> {
  const apiUrl = getAPIUrl(runtime);
  const apiKey = getAPIKey(runtime);

  if (!apiKey) {
    logger.warn('ElizaOS API key not configured');
    return false;
  }

  try {
    const response = await fetch(`${apiUrl}/api/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      // Add timeout to prevent hanging
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    if (response.ok) {
      logger.debug('ElizaOS API health check passed');
      return true;
    } else {
      logger.warn(`ElizaOS API health check failed: ${response.status}`);
      return false;
    }
  } catch (error) {
    logger.warn(
      `ElizaOS API health check error: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    return false;
  }
}
