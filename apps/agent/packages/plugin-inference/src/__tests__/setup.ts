import { vi } from 'vitest';
import { ModelType, IAgentRuntime } from '@elizaos/core';

// Define a mock runtime interface for tests
interface MockRuntime {
  getSetting: (key: string) => string | undefined;
}

// Mock the OpenAI plugin
vi.mock('@elizaos/plugin-openai', () => ({
  openaiPlugin: {
    name: 'openai',
    description: 'OpenAI plugin',
    async isValid(runtime: MockRuntime) {
      return !!runtime.getSetting('OPENAI_API_KEY');
    },
    async init() {
      // Mock init
    },
    models: {
      [ModelType.TEXT_SMALL]: vi.fn().mockResolvedValue('OpenAI response'),
      [ModelType.TEXT_LARGE]: vi.fn().mockResolvedValue('OpenAI response'),
      [ModelType.TEXT_EMBEDDING]: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    },
  },
}));

// Mock the Anthropic plugin
vi.mock('@elizaos/plugin-anthropic', () => ({
  anthropicPlugin: {
    name: 'anthropic',
    description: 'Anthropic plugin',
    async isValid(runtime: MockRuntime) {
      return !!runtime.getSetting('ANTHROPIC_API_KEY');
    },
    async init() {
      // Mock init
    },
    models: {
      [ModelType.TEXT_SMALL]: vi.fn().mockResolvedValue('Anthropic response'),
      [ModelType.TEXT_LARGE]: vi.fn().mockResolvedValue('Anthropic response'),
    },
  },
}));

// Mock the Groq plugin
vi.mock('@elizaos/plugin-groq', () => ({
  groqPlugin: {
    name: 'groq',
    description: 'Groq plugin',
    async isValid(runtime: MockRuntime) {
      return !!runtime.getSetting('GROQ_API_KEY');
    },
    async init() {
      // Mock init
    },
    models: {
      [ModelType.TEXT_SMALL]: vi.fn().mockResolvedValue('Groq response'),
      [ModelType.TEXT_LARGE]: vi.fn().mockResolvedValue('Groq response'),
    },
  },
}));

vi.mock('@elizaos/plugin-ollama', () => ({
  ollamaPlugin: {
    name: 'ollama',
    description: 'Ollama plugin',
    async isValid(runtime: MockRuntime) {
      // Check OLLAMA_AVAILABLE flag first
      const available = runtime.getSetting('OLLAMA_AVAILABLE');

      // If explicitly set to false, ollama is not available
      if (available === 'false') {
        return false;
      }

      const endpoint = runtime.getSetting('OLLAMA_API_ENDPOINT');
      if (endpoint && endpoint.includes('invalid-endpoint')) {
        return false;
      }

      // Default to available if not explicitly disabled
      return available === 'true' || (!available && endpoint === 'http://localhost:11434');
    },
    async init() {
      // Mock init
    },
    models: {
      [ModelType.TEXT_SMALL]: vi.fn().mockImplementation(async (runtime: MockRuntime) => {
        const available = runtime.getSetting('OLLAMA_AVAILABLE');
        if (available === 'false') {
          throw new Error('Ollama is not available');
        }
        return 'Ollama response';
      }),
      [ModelType.TEXT_LARGE]: vi.fn().mockImplementation(async (runtime: MockRuntime) => {
        const available = runtime.getSetting('OLLAMA_AVAILABLE');
        if (available === 'false') {
          throw new Error('Ollama is not available');
        }
        return 'Ollama response';
      }),
      [ModelType.TEXT_EMBEDDING]: vi.fn().mockImplementation(async (runtime: MockRuntime) => {
        const available = runtime.getSetting('OLLAMA_AVAILABLE');
        if (available === 'false') {
          throw new Error('Ollama is not available');
        }
        return [0.4, 0.5, 0.6];
      }),
    },
  },
}));

// Mock the ElizaOS Services plugin
vi.mock('@elizaos/plugin-elizaos-services', () => ({
  elizaOSServicesPlugin: {
    name: 'elizaos',
    description: 'ElizaOS Services plugin',
    async isValid(runtime: MockRuntime) {
      return !!runtime.getSetting('ELIZAOS_API_KEY');
    },
    async init(config: Record<string, unknown>, runtime: MockRuntime) {
      // Only throw if no API key
      if (!runtime.getSetting('ELIZAOS_API_KEY')) {
        throw new Error('Mock initialization failure');
      }
    },
    models: {
      [ModelType.TEXT_SMALL]: vi.fn().mockResolvedValue('ElizaOS response'),
      [ModelType.TEXT_LARGE]: vi.fn().mockResolvedValue('ElizaOS response'),
    },
  },
}));

// Mock the local embedding plugin
vi.mock('@elizaos/plugin-local-embedding', () => ({
  localEmbeddingPlugin: {
    name: 'local-embedding',
    description: 'Local embedding plugin',
    async init() {
      // Mock init
    },
    async isValid() {
      return true; // FastEmbed is always available
    },
    models: {
      [ModelType.TEXT_EMBEDDING]: vi.fn().mockResolvedValue([0.1, 0.2, 0.3, 0.4, 0.5]),
    },
  },
}));

// Mock fetch to prevent real API calls
global.fetch = vi.fn().mockImplementation(() =>
  Promise.resolve({
    ok: false,
    json: () => Promise.resolve({}),
  })
) as unknown as typeof fetch;
