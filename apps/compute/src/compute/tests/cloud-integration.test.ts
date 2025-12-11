/**
 * Cloud-Compute Integration Tests
 *
 * Tests for the cloud-compute integration module that bridges
 * the cloud platform with the decentralized compute marketplace.
 */

import { describe, test, expect, beforeAll, mock, spyOn } from 'bun:test';
import {
  CloudModelBroadcaster,
  CloudProviderBridge,
  UnifiedModelDiscovery,
  createCloudBroadcaster,
  createCloudBridge,
  createUnifiedDiscovery,
  type CloudModelInfo,
  type CloudA2ASkill,
  type CloudIntegrationConfig,
} from '../sdk/cloud-integration';
import { ModelTypeEnum, ModelCapabilityEnum, ModelHostingTypeEnum } from '../sdk/types';

// Mock cloud API responses
const MOCK_CLOUD_MODELS: CloudModelInfo[] = [
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'OpenAI',
    providerId: 'openai',
    modelType: 'llm',
    multiModal: true,
    contextWindow: 128000,
    inputPricePerMillion: 2.5,
    outputPricePerMillion: 10.0,
  },
  {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    provider: 'Anthropic',
    providerId: 'anthropic',
    modelType: 'llm',
    multiModal: true,
    contextWindow: 200000,
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
  },
  {
    id: 'flux-pro',
    name: 'FLUX Pro',
    provider: 'Black Forest Labs',
    providerId: 'flux',
    modelType: 'image',
    maxResolution: '1024x1024',
    pricePerImage: 0.05,
  },
];

const MOCK_CLOUD_SKILLS: CloudA2ASkill[] = [
  { id: 'chat_completion', description: 'Generate text with LLMs' },
  { id: 'image_generation', description: 'Generate images' },
  { id: 'video_generation', description: 'Generate videos (async)' },
  { id: 'check_balance', description: 'Check credit balance' },
  { id: 'list_agents', description: 'List available agents' },
];

const MOCK_AGENT_CARD = {
  protocolVersion: '0.3.0',
  name: 'Eliza Cloud',
  description: 'Cloud AI platform',
  skills: MOCK_CLOUD_SKILLS.map(s => ({ id: s.id, description: s.description })),
};

const MOCK_INFERENCE_RESPONSE = {
  id: 'chatcmpl-123',
  model: 'gpt-4o',
  choices: [{ message: { content: 'Hello! How can I help you?' } }],
  usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
  cost: 0.0001,
};

const MOCK_IMAGE_RESPONSE = {
  data: [{ url: 'https://example.com/generated-image.png' }],
  cost: 0.05,
};

// Test configuration
const TEST_CONFIG: CloudIntegrationConfig = {
  cloudEndpoint: 'https://mock-cloud.example.com',
  cloudApiKey: 'test-api-key',
  rpcUrl: 'http://localhost:9545',
  syncIntervalMs: 0, // Disable interval for tests
};

// Mock fetch for all tests
const originalFetch = global.fetch;
let mockFetch: ReturnType<typeof mock>;

beforeAll(() => {
  mockFetch = mock((url: string, options?: RequestInit) => {
    const urlStr = url.toString();
    
    if (urlStr.includes('/api/v1/models')) {
      return Promise.resolve(new Response(JSON.stringify({ models: MOCK_CLOUD_MODELS }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    }
    
    if (urlStr.includes('/.well-known/agent-card.json')) {
      return Promise.resolve(new Response(JSON.stringify(MOCK_AGENT_CARD), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    }
    
    if (urlStr.includes('/api/v1/chat/completions')) {
      return Promise.resolve(new Response(JSON.stringify(MOCK_INFERENCE_RESPONSE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    }
    
    if (urlStr.includes('/api/v1/images/generations')) {
      return Promise.resolve(new Response(JSON.stringify(MOCK_IMAGE_RESPONSE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    }
    
    if (urlStr.includes('/api/a2a')) {
      return Promise.resolve(new Response(JSON.stringify({
        result: {
          status: {
            message: {
              parts: [{ type: 'text', text: 'Skill executed successfully' }],
            },
          },
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    }
    
    return Promise.resolve(new Response('Not found', { status: 404 }));
  });
  
  global.fetch = mockFetch;
});

// ============================================================================
// CloudModelBroadcaster Tests
// ============================================================================

describe('CloudModelBroadcaster', () => {
  test('creates broadcaster with config', () => {
    const broadcaster = createCloudBroadcaster(TEST_CONFIG);
    expect(broadcaster).toBeInstanceOf(CloudModelBroadcaster);
  });
  
  test('fetches models from cloud endpoint', async () => {
    const broadcaster = createCloudBroadcaster(TEST_CONFIG);
    const models = await broadcaster.fetchCloudModels();
    
    expect(models).toHaveLength(3);
    expect(models[0].id).toBe('gpt-4o');
    expect(models[1].id).toBe('claude-sonnet-4-20250514');
    expect(models[2].id).toBe('flux-pro');
  });
  
  test('fetches A2A skills from cloud', async () => {
    const broadcaster = createCloudBroadcaster(TEST_CONFIG);
    const skills = await broadcaster.fetchCloudSkills();
    
    expect(skills).toHaveLength(5);
    expect(skills[0].id).toBe('chat_completion');
    expect(skills[1].id).toBe('image_generation');
  });
  
  test('syncs models to cache', async () => {
    const broadcaster = createCloudBroadcaster(TEST_CONFIG);
    
    expect(broadcaster.isSynced()).toBe(false);
    
    await broadcaster.sync();
    
    expect(broadcaster.isSynced()).toBe(true);
    expect(broadcaster.getModels()).toHaveLength(3);
    expect(broadcaster.getSkills()).toHaveLength(5);
  });
  
  test('gets model by ID', async () => {
    const broadcaster = createCloudBroadcaster(TEST_CONFIG);
    await broadcaster.sync();
    
    const model = broadcaster.getModel('gpt-4o');
    expect(model).toBeDefined();
    expect(model?.name).toBe('GPT-4o');
    expect(model?.provider).toBe('OpenAI');
    
    const missing = broadcaster.getModel('nonexistent');
    expect(missing).toBeUndefined();
  });
  
  test('caches skills correctly', async () => {
    const broadcaster = createCloudBroadcaster(TEST_CONFIG);
    await broadcaster.sync();
    
    const skills = broadcaster.getSkills();
    expect(skills.find(s => s.id === 'check_balance')).toBeDefined();
    expect(skills.find(s => s.id === 'list_agents')).toBeDefined();
  });
});

// ============================================================================
// CloudProviderBridge Tests
// ============================================================================

describe('CloudProviderBridge', () => {
  test('creates bridge with config', () => {
    const bridge = createCloudBridge(TEST_CONFIG);
    expect(bridge).toBeInstanceOf(CloudProviderBridge);
  });
  
  test('initializes and syncs with cloud', async () => {
    const bridge = createCloudBridge(TEST_CONFIG);
    await bridge.initialize();
    
    const status = await bridge.getStatus();
    expect(status.available).toBe(true);
    expect(status.modelCount).toBe(3);
    expect(status.skillCount).toBe(5);
  });
  
  test('discovers LLM models', async () => {
    const bridge = createCloudBridge(TEST_CONFIG);
    await bridge.initialize();
    
    const results = await bridge.discoverModels({ modelType: ModelTypeEnum.LLM });
    
    expect(results.length).toBe(2); // GPT-4o and Claude
    expect(results[0].model.modelType).toBe(ModelTypeEnum.LLM);
  });
  
  test('discovers image generation models', async () => {
    const bridge = createCloudBridge(TEST_CONFIG);
    await bridge.initialize();
    
    const results = await bridge.discoverModels({ modelType: ModelTypeEnum.IMAGE_GEN });
    
    expect(results.length).toBe(1);
    expect(results[0].model.name).toBe('FLUX Pro');
  });
  
  test('discovers all models without filter', async () => {
    const bridge = createCloudBridge(TEST_CONFIG);
    await bridge.initialize();
    
    const results = await bridge.discoverModels();
    expect(results.length).toBe(3);
  });
  
  test('makes inference request to cloud', async () => {
    const bridge = createCloudBridge(TEST_CONFIG);
    
    const result = await bridge.inference(
      'gpt-4o',
      [{ role: 'user', content: 'Hello!' }],
      { temperature: 0.7, maxTokens: 100 }
    );
    
    expect(result.id).toBe('chatcmpl-123');
    expect(result.model).toBe('gpt-4o');
    expect(result.content).toBe('Hello! How can I help you?');
    expect(result.usage.totalTokens).toBe(18);
    expect(result.cost).toBe(0.0001);
  });
  
  test('generates image via cloud', async () => {
    const bridge = createCloudBridge(TEST_CONFIG);
    
    const result = await bridge.generateImage(
      'A beautiful sunset over the ocean',
      { model: 'flux', size: '1024x1024' }
    );
    
    expect(result.url).toBe('https://example.com/generated-image.png');
    expect(result.cost).toBe(0.05);
  });
  
  test('executes A2A skill', async () => {
    const bridge = createCloudBridge(TEST_CONFIG);
    
    const result = await bridge.executeSkill('check_balance', 'Check my balance');
    expect(result).toBe('Skill executed successfully');
  });
  
  test('returns available skills', async () => {
    const bridge = createCloudBridge(TEST_CONFIG);
    await bridge.initialize();
    
    const skills = bridge.getAvailableSkills();
    expect(skills).toHaveLength(5);
    expect(skills[0].id).toBe('chat_completion');
  });
  
  test('converts cloud models to RegisteredModel format', async () => {
    const bridge = createCloudBridge(TEST_CONFIG);
    await bridge.initialize();
    
    const results = await bridge.discoverModels();
    const gpt4oResult = results.find(r => r.model.modelId.includes('gpt-4o'));
    
    expect(gpt4oResult).toBeDefined();
    expect(gpt4oResult!.model.creator.name).toBe('OpenAI');
    expect(gpt4oResult!.model.contextWindow).toBe(128000);
    expect(gpt4oResult!.model.capabilities & ModelCapabilityEnum.TEXT_GENERATION).toBeTruthy();
    expect(gpt4oResult!.model.capabilities & ModelCapabilityEnum.STREAMING).toBeTruthy();
    expect(gpt4oResult!.model.capabilities & ModelCapabilityEnum.VISION).toBeTruthy();
    expect(gpt4oResult!.model.capabilities & ModelCapabilityEnum.LONG_CONTEXT).toBeTruthy();
  });
  
  test('includes endpoint in discovery results', async () => {
    const bridge = createCloudBridge(TEST_CONFIG);
    await bridge.initialize();
    
    const results = await bridge.discoverModels();
    
    expect(results[0].endpoints).toHaveLength(1);
    expect(results[0].endpoints[0].endpoint).toBe('https://mock-cloud.example.com/api/v1');
    expect(results[0].recommendedEndpoint).toBeDefined();
  });
});

// ============================================================================
// UnifiedModelDiscovery Tests
// ============================================================================

describe('UnifiedModelDiscovery', () => {
  test('creates unified discovery with cloud', () => {
    const discovery = createUnifiedDiscovery(TEST_CONFIG);
    expect(discovery).toBeInstanceOf(UnifiedModelDiscovery);
  });
  
  test('initializes cloud bridge', async () => {
    const discovery = createUnifiedDiscovery(TEST_CONFIG);
    await discovery.initialize();
    
    const bridge = discovery.getCloudBridge();
    expect(bridge).not.toBeNull();
  });
  
  test('discovers models from cloud', async () => {
    const discovery = createUnifiedDiscovery(TEST_CONFIG);
    await discovery.initialize();
    
    const { cloud, combined } = await discovery.discoverAll();
    
    expect(cloud).toHaveLength(3);
    expect(combined).toHaveLength(3);
  });
  
  test('filters by model type', async () => {
    const discovery = createUnifiedDiscovery(TEST_CONFIG);
    await discovery.initialize();
    
    const { combined } = await discovery.discoverAll({ modelType: ModelTypeEnum.IMAGE_GEN });
    
    expect(combined).toHaveLength(1);
    expect(combined[0].model.modelType).toBe(ModelTypeEnum.IMAGE_GEN);
  });
  
  test('selects best model preferring cloud', async () => {
    const discovery = createUnifiedDiscovery(TEST_CONFIG);
    await discovery.initialize();
    
    const result = await discovery.selectBestModel({
      modelType: ModelTypeEnum.LLM,
      preferCloud: true,
    });
    
    expect(result).not.toBeNull();
    expect(result!.model.hostingType).toBe(ModelHostingTypeEnum.CENTRALIZED);
  });
  
  test('returns null when no models match', async () => {
    const discovery = createUnifiedDiscovery(TEST_CONFIG);
    await discovery.initialize();
    
    const result = await discovery.selectBestModel({
      // Impossible combination
      capabilities: 0xFFFFFFFF,
    });
    
    expect(result).toBeNull();
  });
  
  test('sorts by price when selecting best model', async () => {
    const discovery = createUnifiedDiscovery(TEST_CONFIG);
    await discovery.initialize();
    
    const result = await discovery.selectBestModel({
      modelType: ModelTypeEnum.LLM,
    });
    
    // GPT-4o should be selected as it has lower input price
    expect(result).not.toBeNull();
    expect(result!.model.modelId).toContain('gpt-4o');
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Cloud-Compute Integration', () => {
  test('full workflow: discover, select, and infer', async () => {
    const discovery = createUnifiedDiscovery(TEST_CONFIG);
    await discovery.initialize();
    
    // Discover models
    const { combined } = await discovery.discoverAll();
    expect(combined.length).toBeGreaterThan(0);
    
    // Select best LLM
    const selection = await discovery.selectBestModel({ modelType: ModelTypeEnum.LLM });
    expect(selection).not.toBeNull();
    
    // Make inference via cloud bridge
    const bridge = discovery.getCloudBridge();
    expect(bridge).not.toBeNull();
    
    const result = await bridge!.inference(
      selection!.model.modelId.split('/').pop()!,
      [{ role: 'user', content: 'Test message' }]
    );
    
    expect(result.content).toBeDefined();
    expect(result.usage.totalTokens).toBeGreaterThan(0);
  });
  
  test('model pricing conversion from USD to wei', async () => {
    const bridge = createCloudBridge(TEST_CONFIG);
    await bridge.initialize();
    
    const results = await bridge.discoverModels();
    const gpt4o = results.find(r => r.model.modelId.includes('gpt-4o'));
    
    expect(gpt4o).toBeDefined();
    // Pricing should be non-zero (converted from USD)
    expect(gpt4o!.model.pricing.pricePerInputToken).toBeGreaterThan(0n);
    expect(gpt4o!.model.pricing.pricePerOutputToken).toBeGreaterThan(0n);
  });
  
  test('multimodal capability detection', async () => {
    const bridge = createCloudBridge(TEST_CONFIG);
    await bridge.initialize();
    
    const results = await bridge.discoverModels();
    const gpt4o = results.find(r => r.model.modelId.includes('gpt-4o'));
    
    expect(gpt4o).toBeDefined();
    const caps = gpt4o!.model.capabilities;
    
    // Should have vision capability due to multiModal=true
    expect(caps & ModelCapabilityEnum.VISION).toBeTruthy();
    expect(caps & ModelCapabilityEnum.MULTIMODAL).toBeTruthy();
  });
  
  test('long context detection', async () => {
    const bridge = createCloudBridge(TEST_CONFIG);
    await bridge.initialize();
    
    const results = await bridge.discoverModels();
    
    // GPT-4o has 128k context, Claude has 200k - both should have LONG_CONTEXT
    const llms = results.filter(r => r.model.modelType === ModelTypeEnum.LLM);
    
    for (const llm of llms) {
      expect(llm.model.capabilities & ModelCapabilityEnum.LONG_CONTEXT).toBeTruthy();
    }
  });
  
  test('image generation model capabilities', async () => {
    const bridge = createCloudBridge(TEST_CONFIG);
    await bridge.initialize();
    
    const results = await bridge.discoverModels({ modelType: ModelTypeEnum.IMAGE_GEN });
    
    expect(results).toHaveLength(1);
    const flux = results[0];
    
    expect(flux.model.capabilities & ModelCapabilityEnum.IMAGE_GENERATION).toBeTruthy();
    expect(flux.model.pricing.pricePerImageOutput).toBeGreaterThan(0n);
  });
  
  test('provider website mapping', async () => {
    const bridge = createCloudBridge(TEST_CONFIG);
    await bridge.initialize();
    
    const results = await bridge.discoverModels();
    
    const openai = results.find(r => r.model.creator.name === 'OpenAI');
    expect(openai?.model.creator.website).toBe('https://openai.com');
    
    const anthropic = results.find(r => r.model.creator.name === 'Anthropic');
    expect(anthropic?.model.creator.website).toBe('https://anthropic.com');
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Error Handling', () => {
  test('handles fetch failure gracefully', async () => {
    const failingFetch = mock(() => Promise.reject(new Error('Network error')));
    global.fetch = failingFetch;
    
    const broadcaster = createCloudBroadcaster(TEST_CONFIG);
    
    await expect(broadcaster.fetchCloudModels()).rejects.toThrow();
    
    // Restore mock
    global.fetch = mockFetch;
  });
  
  test('handles 404 for agent card', async () => {
    const notFoundFetch = mock((url: string) => {
      if (url.includes('agent-card.json')) {
        return Promise.resolve(new Response('Not found', { status: 404 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ models: [] }), { status: 200 }));
    });
    global.fetch = notFoundFetch;
    
    const broadcaster = createCloudBroadcaster(TEST_CONFIG);
    const skills = await broadcaster.fetchCloudSkills();
    
    // Should return empty array on 404
    expect(skills).toEqual([]);
    
    // Restore mock
    global.fetch = mockFetch;
  });
  
  test('handles cloud inference error', async () => {
    const errorFetch = mock((url: string) => {
      if (url.includes('/chat/completions')) {
        return Promise.resolve(new Response('Internal Server Error', { status: 500 }));
      }
      return mockFetch(url);
    });
    global.fetch = errorFetch;
    
    const bridge = createCloudBridge(TEST_CONFIG);
    
    await expect(bridge.inference('gpt-4o', [{ role: 'user', content: 'test' }]))
      .rejects.toThrow('Cloud inference failed: 500');
    
    // Restore mock
    global.fetch = mockFetch;
  });
  
  test('handles A2A error response', async () => {
    const errorFetch = mock((url: string) => {
      if (url.includes('/api/a2a')) {
        return Promise.resolve(new Response(JSON.stringify({
          error: { message: 'Skill not found' },
        }), { status: 200 }));
      }
      return mockFetch(url);
    });
    global.fetch = errorFetch;
    
    const bridge = createCloudBridge(TEST_CONFIG);
    
    await expect(bridge.executeSkill('invalid_skill', 'test'))
      .rejects.toThrow('A2A error: Skill not found');
    
    // Restore mock
    global.fetch = mockFetch;
  });
});
