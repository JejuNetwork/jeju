/**
 * Pre-configured API Providers
 *
 * All supported providers with their auth patterns and default pricing
 */

import type { APIProvider, ProviderCategory } from './types';

// ============================================================================
// AI/Inference Providers
// ============================================================================

const inferenceProviders: APIProvider[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT-4o, o1, o3, DALL-E, Whisper, Embeddings',
    baseUrl: 'https://api.openai.com/v1',
    authType: 'bearer',
    authConfig: { headerName: 'Authorization', prefix: 'Bearer ' },
    schemaType: 'openapi',
    schemaUrl: 'https://raw.githubusercontent.com/openai/openai-openapi/master/openapi.yaml',
    categories: ['inference'],
    envVar: 'OPENAI_API_KEY',
    defaultPricePerRequest: 100000000000000n, // 0.0001 ETH
    knownEndpoints: ['/chat/completions', '/completions', '/embeddings', '/images/generations', '/audio/transcriptions'],
    supportsStreaming: true,
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude 3.5, Claude 3 Opus/Sonnet/Haiku',
    baseUrl: 'https://api.anthropic.com/v1',
    authType: 'header',
    authConfig: { headerName: 'x-api-key' },
    schemaType: 'rest',
    categories: ['inference'],
    envVar: 'ANTHROPIC_API_KEY',
    defaultPricePerRequest: 150000000000000n, // 0.00015 ETH
    knownEndpoints: ['/messages'],
    supportsStreaming: true,
  },
  {
    id: 'groq',
    name: 'Groq',
    description: 'Ultra-fast inference for Llama, Mixtral, Gemma',
    baseUrl: 'https://api.groq.com/openai/v1',
    authType: 'bearer',
    authConfig: { headerName: 'Authorization', prefix: 'Bearer ' },
    schemaType: 'openapi',
    categories: ['inference'],
    envVar: 'GROQ_API_KEY',
    defaultPricePerRequest: 10000000000000n, // 0.00001 ETH (cheap)
    knownEndpoints: ['/chat/completions', '/models'],
    supportsStreaming: true,
  },
  {
    id: 'google',
    name: 'Google AI',
    description: 'Gemini Pro, Gemini Ultra',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    authType: 'query',
    authConfig: { queryParam: 'key' },
    schemaType: 'rest',
    categories: ['inference'],
    envVar: 'GOOGLE_AI_API_KEY',
    defaultPricePerRequest: 50000000000000n, // 0.00005 ETH
    knownEndpoints: ['/models/gemini-pro:generateContent', '/models/gemini-pro-vision:generateContent'],
    supportsStreaming: true,
  },
  {
    id: 'xai',
    name: 'xAI',
    description: 'Grok models',
    baseUrl: 'https://api.x.ai/v1',
    authType: 'bearer',
    authConfig: { headerName: 'Authorization', prefix: 'Bearer ' },
    schemaType: 'openapi',
    categories: ['inference'],
    envVar: 'XAI_API_KEY',
    defaultPricePerRequest: 100000000000000n,
    knownEndpoints: ['/chat/completions'],
    supportsStreaming: true,
  },
  {
    id: 'cohere',
    name: 'Cohere',
    description: 'Command, Embed, Rerank models',
    baseUrl: 'https://api.cohere.ai/v1',
    authType: 'bearer',
    authConfig: { headerName: 'Authorization', prefix: 'Bearer ' },
    schemaType: 'openapi',
    categories: ['inference'],
    envVar: 'COHERE_API_KEY',
    defaultPricePerRequest: 50000000000000n,
    knownEndpoints: ['/chat', '/generate', '/embed', '/rerank'],
    supportsStreaming: true,
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    description: 'Mistral Large, Medium, Small, Codestral',
    baseUrl: 'https://api.mistral.ai/v1',
    authType: 'bearer',
    authConfig: { headerName: 'Authorization', prefix: 'Bearer ' },
    schemaType: 'openapi',
    categories: ['inference'],
    envVar: 'MISTRAL_API_KEY',
    defaultPricePerRequest: 50000000000000n,
    knownEndpoints: ['/chat/completions', '/embeddings'],
    supportsStreaming: true,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    description: 'DeepSeek Coder, DeepSeek Chat',
    baseUrl: 'https://api.deepseek.com/v1',
    authType: 'bearer',
    authConfig: { headerName: 'Authorization', prefix: 'Bearer ' },
    schemaType: 'openapi',
    categories: ['inference'],
    envVar: 'DEEPSEEK_API_KEY',
    defaultPricePerRequest: 20000000000000n,
    knownEndpoints: ['/chat/completions'],
    supportsStreaming: true,
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    description: 'Perplexity Online, Sonar models with web search',
    baseUrl: 'https://api.perplexity.ai',
    authType: 'bearer',
    authConfig: { headerName: 'Authorization', prefix: 'Bearer ' },
    schemaType: 'openapi',
    categories: ['inference', 'search'],
    envVar: 'PERPLEXITY_API_KEY',
    defaultPricePerRequest: 100000000000000n,
    knownEndpoints: ['/chat/completions'],
    supportsStreaming: true,
  },
  {
    id: 'together',
    name: 'Together AI',
    description: 'Open source models at scale',
    baseUrl: 'https://api.together.xyz/v1',
    authType: 'bearer',
    authConfig: { headerName: 'Authorization', prefix: 'Bearer ' },
    schemaType: 'openapi',
    categories: ['inference'],
    envVar: 'TOGETHER_API_KEY',
    defaultPricePerRequest: 30000000000000n,
    knownEndpoints: ['/chat/completions', '/completions', '/embeddings', '/images/generations'],
    supportsStreaming: true,
  },
  {
    id: 'fireworks',
    name: 'Fireworks AI',
    description: 'Fast inference for open models',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    authType: 'bearer',
    authConfig: { headerName: 'Authorization', prefix: 'Bearer ' },
    schemaType: 'openapi',
    categories: ['inference'],
    envVar: 'FIREWORKS_API_KEY',
    defaultPricePerRequest: 20000000000000n,
    knownEndpoints: ['/chat/completions', '/completions', '/embeddings'],
    supportsStreaming: true,
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    description: 'Ultra-fast inference on Cerebras hardware',
    baseUrl: 'https://api.cerebras.ai/v1',
    authType: 'bearer',
    authConfig: { headerName: 'Authorization', prefix: 'Bearer ' },
    schemaType: 'openapi',
    categories: ['inference'],
    envVar: 'CEREBRAS_API_KEY',
    defaultPricePerRequest: 10000000000000n,
    knownEndpoints: ['/chat/completions'],
    supportsStreaming: true,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Unified API for 100+ models',
    baseUrl: 'https://openrouter.ai/api/v1',
    authType: 'bearer',
    authConfig: { headerName: 'Authorization', prefix: 'Bearer ' },
    schemaType: 'openapi',
    categories: ['inference'],
    envVar: 'OPENROUTER_API_KEY',
    defaultPricePerRequest: 50000000000000n,
    knownEndpoints: ['/chat/completions', '/models'],
    supportsStreaming: true,
  },
  {
    id: 'ai21',
    name: 'AI21 Labs',
    description: 'Jamba, Jurassic models',
    baseUrl: 'https://api.ai21.com/studio/v1',
    authType: 'bearer',
    authConfig: { headerName: 'Authorization', prefix: 'Bearer ' },
    schemaType: 'rest',
    categories: ['inference'],
    envVar: 'AI21_API_KEY',
    defaultPricePerRequest: 80000000000000n,
    knownEndpoints: ['/chat/completions', '/j2-ultra/complete'],
    supportsStreaming: false,
  },
];

// ============================================================================
// Blockchain/RPC Providers
// ============================================================================

const blockchainProviders: APIProvider[] = [
  {
    id: 'helius',
    name: 'Helius',
    description: 'Solana RPC, DAS API, webhooks, NFT APIs',
    baseUrl: 'https://mainnet.helius-rpc.com',
    authType: 'query',
    authConfig: { queryParam: 'api-key' },
    schemaType: 'rest',
    categories: ['blockchain'],
    envVar: 'HELIUS_API_KEY',
    defaultPricePerRequest: 1000000000000n, // 0.000001 ETH (very cheap)
    knownEndpoints: ['/', '/v0/addresses', '/v0/tokens', '/v1/nfts'],
    supportsStreaming: false,
  },
  {
    id: 'alchemy',
    name: 'Alchemy',
    description: 'Multi-chain RPC, NFT API, webhooks',
    baseUrl: 'https://eth-mainnet.g.alchemy.com/v2',
    authType: 'query',
    authConfig: { queryParam: 'apiKey' },
    schemaType: 'rest',
    categories: ['blockchain'],
    envVar: 'ALCHEMY_API_KEY',
    defaultPricePerRequest: 1000000000000n,
    knownEndpoints: ['/', '/getNFTs', '/getTokenBalances'],
    supportsStreaming: false,
  },
  {
    id: 'etherscan',
    name: 'Etherscan',
    description: 'Ethereum block explorer API',
    baseUrl: 'https://api.etherscan.io/api',
    authType: 'query',
    authConfig: { queryParam: 'apikey' },
    schemaType: 'rest',
    categories: ['blockchain', 'data'],
    envVar: 'ETHERSCAN_API_KEY',
    defaultPricePerRequest: 500000000000n,
    knownEndpoints: ['?module=account', '?module=contract', '?module=transaction'],
    supportsStreaming: false,
  },
];

// ============================================================================
// Data/Analytics Providers
// ============================================================================

const dataProviders: APIProvider[] = [
  {
    id: 'birdeye',
    name: 'Birdeye',
    description: 'Solana token analytics, prices, charts',
    baseUrl: 'https://public-api.birdeye.so',
    authType: 'header',
    authConfig: { headerName: 'X-API-KEY' },
    schemaType: 'rest',
    categories: ['data', 'blockchain'],
    envVar: 'BIRDEYE_API_KEY',
    defaultPricePerRequest: 5000000000000n,
    knownEndpoints: ['/defi/price', '/defi/tokenlist', '/defi/history_price', '/trader/gainers-losers'],
    supportsStreaming: false,
  },
  {
    id: 'coingecko',
    name: 'CoinGecko',
    description: 'Crypto prices, market data, exchanges',
    baseUrl: 'https://pro-api.coingecko.com/api/v3',
    authType: 'header',
    authConfig: { headerName: 'x-cg-pro-api-key' },
    schemaType: 'rest',
    categories: ['data'],
    envVar: 'COINGECKO_API_KEY',
    defaultPricePerRequest: 2000000000000n,
    knownEndpoints: ['/simple/price', '/coins/markets', '/coins/list'],
    supportsStreaming: false,
  },
];

// ============================================================================
// Search/Scraping Providers
// ============================================================================

const searchProviders: APIProvider[] = [
  {
    id: 'tavily',
    name: 'Tavily',
    description: 'AI-powered web search API',
    baseUrl: 'https://api.tavily.com',
    authType: 'header',
    authConfig: { headerName: 'Authorization', prefix: 'Bearer ' },
    schemaType: 'rest',
    categories: ['search'],
    envVar: 'TAVILY_API_KEY',
    defaultPricePerRequest: 10000000000000n,
    knownEndpoints: ['/search'],
    supportsStreaming: false,
  },
  {
    id: 'firecrawl',
    name: 'Firecrawl',
    description: 'Web scraping and crawling API',
    baseUrl: 'https://api.firecrawl.dev/v1',
    authType: 'bearer',
    authConfig: { headerName: 'Authorization', prefix: 'Bearer ' },
    schemaType: 'rest',
    categories: ['search'],
    envVar: 'FIRECRAWL_API_KEY',
    defaultPricePerRequest: 20000000000000n,
    knownEndpoints: ['/scrape', '/crawl', '/map'],
    supportsStreaming: false,
  },
];

// ============================================================================
// Media Generation Providers
// ============================================================================

const mediaProviders: APIProvider[] = [
  {
    id: 'fal',
    name: 'Fal',
    description: 'Fast AI image generation (FLUX, SD)',
    baseUrl: 'https://fal.run',
    authType: 'header',
    authConfig: { headerName: 'Authorization', prefix: 'Key ' },
    schemaType: 'rest',
    categories: ['media', 'inference'],
    envVar: 'FAL_API_KEY',
    defaultPricePerRequest: 50000000000000n,
    knownEndpoints: ['/fal-ai/flux/dev', '/fal-ai/flux-pro', '/fal-ai/stable-diffusion-v3-medium'],
    supportsStreaming: false,
  },
  {
    id: 'replicate',
    name: 'Replicate',
    description: 'Run open-source ML models',
    baseUrl: 'https://api.replicate.com/v1',
    authType: 'bearer',
    authConfig: { headerName: 'Authorization', prefix: 'Bearer ' },
    schemaType: 'rest',
    categories: ['media', 'inference'],
    envVar: 'REPLICATE_API_KEY',
    defaultPricePerRequest: 30000000000000n,
    knownEndpoints: ['/predictions', '/models'],
    supportsStreaming: false,
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    description: 'AI voice synthesis and cloning',
    baseUrl: 'https://api.elevenlabs.io/v1',
    authType: 'header',
    authConfig: { headerName: 'xi-api-key' },
    schemaType: 'rest',
    categories: ['media'],
    envVar: 'ELEVENLABS_API_KEY',
    defaultPricePerRequest: 100000000000000n,
    knownEndpoints: ['/text-to-speech', '/voices', '/voice-generation'],
    supportsStreaming: true,
  },
];

// ============================================================================
// All Providers
// ============================================================================

export const ALL_PROVIDERS: APIProvider[] = [
  ...inferenceProviders,
  ...blockchainProviders,
  ...dataProviders,
  ...searchProviders,
  ...mediaProviders,
];

export const PROVIDERS_BY_ID = new Map<string, APIProvider>(
  ALL_PROVIDERS.map((p) => [p.id, p])
);

export const PROVIDERS_BY_CATEGORY = new Map<ProviderCategory, APIProvider[]>();
for (const provider of ALL_PROVIDERS) {
  for (const category of provider.categories) {
    const existing = PROVIDERS_BY_CATEGORY.get(category) || [];
    existing.push(provider);
    PROVIDERS_BY_CATEGORY.set(category, existing);
  }
}

/**
 * Get provider by ID
 */
export function getProvider(id: string): APIProvider | undefined {
  return PROVIDERS_BY_ID.get(id);
}

/**
 * Get providers by category
 */
export function getProvidersByCategory(category: ProviderCategory): APIProvider[] {
  return PROVIDERS_BY_CATEGORY.get(category) || [];
}

/**
 * Get all configured providers (those with env vars set)
 */
export function getConfiguredProviders(): APIProvider[] {
  return ALL_PROVIDERS.filter((p) => process.env[p.envVar]);
}

/**
 * Check if a provider is configured
 */
export function isProviderConfigured(id: string): boolean {
  const provider = PROVIDERS_BY_ID.get(id);
  return provider ? !!process.env[provider.envVar] : false;
}
