import { describe, test, expect, beforeEach, mock } from 'bun:test';
import {
  CloudModelBroadcaster,
  CloudProviderBridge,
  ModelDiscovery,
  createCloudBroadcaster,
  createCloudBridge,
  createModelDiscovery,
  type CloudModelInfo,
  type CloudIntegrationConfig,
} from '../sdk/cloud-integration';
import { ModelTypeEnum, ModelCapabilityEnum } from '../sdk/types';

const MOCK_CLOUD_MODELS: CloudModelInfo[] = [
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'OpenAI',
    modelType: 'llm',
    multiModal: true,
    contextWindow: 128000,
    inputPricePerMillion: 2.5,
    outputPricePerMillion: 10.0,
  },
  {
    id: 'claude-sonnet-4',
    name: 'Claude Sonnet 4',
    provider: 'Anthropic',
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
    modelType: 'image',
    pricePerImage: 0.05,
  },
];

const MOCK_INFERENCE_RESPONSE = {
  id: 'chatcmpl-123',
  model: 'gpt-4o',
  choices: [{ message: { content: 'Hello! How can I help you?' } }],
  usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
};

const TEST_CONFIG: CloudIntegrationConfig = {
  cloudEndpoint: 'https://mock-cloud.example.com',
  cloudApiKey: 'test-api-key',
  rpcUrl: 'http://localhost:9545',
  syncIntervalMs: 0,
};

const mockFetch = mock((url: string) => {
  const urlStr = url.toString();

  if (urlStr.includes('/api/v1/models')) {
    return Promise.resolve(new Response(JSON.stringify({ models: MOCK_CLOUD_MODELS }), {
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

  return Promise.resolve(new Response('Not found', { status: 404 }));
});

(globalThis as unknown as { fetch: typeof mockFetch }).fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockClear();
});

describe('CloudModelBroadcaster', () => {
  test('creates broadcaster with config', () => {
    const broadcaster = createCloudBroadcaster(TEST_CONFIG);
    expect(broadcaster).toBeInstanceOf(CloudModelBroadcaster);
  });

  test('starts unsynced', () => {
    const broadcaster = createCloudBroadcaster(TEST_CONFIG);
    expect(broadcaster.isSynced()).toBe(false);
  });

  test('syncs models from cloud endpoint', async () => {
    const broadcaster = createCloudBroadcaster(TEST_CONFIG);
    await broadcaster.sync();

    expect(broadcaster.isSynced()).toBe(true);
    expect(broadcaster.getModels()).toHaveLength(3);
  });

  test('gets model by ID after sync', async () => {
    const broadcaster = createCloudBroadcaster(TEST_CONFIG);
    await broadcaster.sync();

    const model = broadcaster.getModel('gpt-4o');
    expect(model).toBeDefined();
    expect(model?.name).toBe('GPT-4o');
    expect(model?.provider).toBe('OpenAI');

    expect(broadcaster.getModel('nonexistent')).toBeUndefined();
  });
});

describe('CloudProviderBridge', () => {
  test('creates bridge with config', () => {
    const bridge = createCloudBridge(TEST_CONFIG);
    expect(bridge).toBeInstanceOf(CloudProviderBridge);
  });

  test('initializes and syncs', async () => {
    const bridge = createCloudBridge(TEST_CONFIG);
    await bridge.initialize();
    // If no error, initialization succeeded
    expect(true).toBe(true);
  });

  test('discovers LLM models', async () => {
    const bridge = createCloudBridge(TEST_CONFIG);
    await bridge.initialize();

    const results = await bridge.discoverModels({ modelType: ModelTypeEnum.LLM });
    expect(results.length).toBe(2);
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

  test('makes inference request', async () => {
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
  });

  test('includes endpoint in discovery results', async () => {
    const bridge = createCloudBridge(TEST_CONFIG);
    await bridge.initialize();

    const results = await bridge.discoverModels();

    expect(results[0].endpoints).toHaveLength(1);
    expect(results[0].endpoints[0].endpoint).toBe('https://mock-cloud.example.com/api/v1');
    expect(results[0].recommendedEndpoint).toBeDefined();
  });

  test('getStatus returns endpoint and model count', async () => {
    const bridge = createCloudBridge(TEST_CONFIG);
    await bridge.initialize();

    const status = await bridge.getStatus();

    expect(status.endpoint).toBe('https://mock-cloud.example.com');
    expect(status.modelCount).toBe(3);
    expect(status.skillCount).toBe(0);
  });

  test('getAvailableSkills returns empty array', () => {
    const bridge = createCloudBridge(TEST_CONFIG);
    const skills = bridge.getAvailableSkills();

    expect(skills).toEqual([]);
  });

  test('executeSkill throws not implemented error', async () => {
    const bridge = createCloudBridge(TEST_CONFIG);

    await expect(bridge.executeSkill('some-skill', 'input'))
      .rejects.toThrow('A2A skills not implemented in cloud bridge');
  });
});

describe('ModelDiscovery', () => {
  test('creates model discovery', () => {
    const discovery = createModelDiscovery(TEST_CONFIG);
    expect(discovery).toBeInstanceOf(ModelDiscovery);
  });

  test('initializes cloud bridge', async () => {
    const discovery = createModelDiscovery(TEST_CONFIG);
    await discovery.initialize();

    expect(discovery.getCloudBridge()).not.toBeNull();
  });

  test('discovers models from cloud', async () => {
    const discovery = createModelDiscovery(TEST_CONFIG);
    await discovery.initialize();

    const { cloud, combined } = await discovery.discoverAll();

    expect(cloud).toHaveLength(3);
    expect(combined).toHaveLength(3);
  });

  test('filters by model type', async () => {
    const discovery = createModelDiscovery(TEST_CONFIG);
    await discovery.initialize();

    const { combined } = await discovery.discoverAll({ modelType: ModelTypeEnum.IMAGE_GEN });

    expect(combined).toHaveLength(1);
    expect(combined[0].model.modelType).toBe(ModelTypeEnum.IMAGE_GEN);
  });
});

describe('Integration', () => {
  test('full workflow: discover, select, and infer', async () => {
    const discovery = createModelDiscovery(TEST_CONFIG);
    await discovery.initialize();

    const { combined } = await discovery.discoverAll();
    expect(combined.length).toBeGreaterThan(0);

    const bridge = discovery.getCloudBridge();
    expect(bridge).not.toBeNull();

    const modelId = combined[0].model.modelId.split('/').pop()!;
    const result = await bridge!.inference(
      modelId,
      [{ role: 'user', content: 'Test message' }]
    );

    expect(result.content).toBeDefined();
    expect(result.usage.totalTokens).toBeGreaterThan(0);
  });

  test('model pricing conversion', async () => {
    const bridge = createCloudBridge(TEST_CONFIG);
    await bridge.initialize();

    const results = await bridge.discoverModels();
    const gpt4o = results.find(r => r.model.modelId.includes('gpt-4o'));

    expect(gpt4o).toBeDefined();
    expect(gpt4o!.model.pricing.pricePerInputToken).toBeGreaterThan(0n);
    expect(gpt4o!.model.pricing.pricePerOutputToken).toBeGreaterThan(0n);
  });

  test('multimodal capability detection', async () => {
    const bridge = createCloudBridge(TEST_CONFIG);
    await bridge.initialize();

    const results = await bridge.discoverModels();
    const gpt4o = results.find(r => r.model.modelId.includes('gpt-4o'));

    expect(gpt4o).toBeDefined();
    expect(gpt4o!.model.capabilities & ModelCapabilityEnum.VISION).toBeTruthy();
    expect(gpt4o!.model.capabilities & ModelCapabilityEnum.MULTIMODAL).toBeTruthy();
  });

  test('long context detection', async () => {
    const bridge = createCloudBridge(TEST_CONFIG);
    await bridge.initialize();

    const results = await bridge.discoverModels();
    const llms = results.filter(r => r.model.modelType === ModelTypeEnum.LLM);

    for (const llm of llms) {
      expect(llm.model.capabilities & ModelCapabilityEnum.LONG_CONTEXT).toBeTruthy();
    }
  });
});

describe('Error Handling', () => {
  test('handles inference error', async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = ((url: string) => {
      if (url.includes('/chat/completions')) {
        return Promise.resolve(new Response('Internal Server Error', { status: 500 }));
      }
      return mockFetch(url);
    }) as typeof fetch;

    const bridge = createCloudBridge(TEST_CONFIG);

    await expect(bridge.inference('gpt-4o', [{ role: 'user', content: 'test' }]))
      .rejects.toThrow();

    (globalThis as unknown as { fetch: typeof mockFetch }).fetch = mockFetch;
  });

  test('handles sync failure', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.resolve(new Response('Error', { status: 500 }))) as unknown as typeof fetch;

    const broadcaster = createCloudBroadcaster(TEST_CONFIG);
    await expect(broadcaster.sync()).rejects.toThrow();

    globalThis.fetch = originalFetch;
  });
});
