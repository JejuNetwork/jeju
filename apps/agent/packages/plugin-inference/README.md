# ElizaOS Plugin Inference

Dynamic inference plugin that routes AI requests to different Large Language Model (LLM) providers with automatic fallback and provider switching.

## 🎯 Key Features

- **Dynamic Provider Switching**: Automatically route to available providers
- **Fallback Logic**: Seamless fallback when providers are unavailable
- **API Configuration**: REST endpoints for runtime provider management
- **Environment Configuration**: Set preferences via environment variables
- **Validation**: Built-in provider availability checking
- **Dedicated Embeddings**: FastEmbed is used exclusively for all embedding operations

## 🏢 Supported Providers

### LLM Providers (Text Generation)

- **OpenAI** - Cloud API (requires API key)
- **Anthropic Claude** - Cloud API (requires API key)
- **Groq** - Cloud API (requires API key)
- **Ollama** - Local server (requires running service)
- **ElizaOS Services** - Platform API (requires API key)

### Embedding Provider

- **FastEmbed** - Local ONNX-based embeddings (no API required)
  - Model: `BAAI/bge-base-en-v1.5`
  - Completely offline and private
  - Better accuracy than OpenAI Ada-002
  - Faster than API-based solutions

> **⚠️ Important**: All text embedding operations (`TEXT_EMBEDDING`) use the **local FastEmbed plugin exclusively**. This provides fast, private, and consistent embeddings using the BAAI/bge-base-en-v1.5 model without requiring external API calls.

## Installation

```bash
npm install @elizaos/plugin-inference
```

## Usage

### Basic Setup

```typescript
import { inferencePlugin } from '@elizaos/plugin-inference';

// Add to your agent's plugin list
const plugins = [
  inferencePlugin,
  // ... other plugins
];
```

### Configuration

#### Environment Variables

Set provider preferences in order:

```bash
INFERENCE_PREFERENCES=elizaos,anthropic,openai,ollama
```

Select a specific provider:

```bash
SELECTED_PROVIDER=openai
```

#### Provider-specific Configuration

Each provider requires its own configuration:

**OpenAI:**

```bash
OPENAI_API_KEY=your-api-key
OPENAI_BASE_URL=https://api.openai.com/v1  # Optional
```

**Anthropic:**

```bash
ANTHROPIC_API_KEY=your-api-key
```

**Ollama:**

```bash
OLLAMA_API_ENDPOINT=http://localhost:11434  # Optional
```

**ElizaOS Cloud:**

```bash
ELIZAOS_API_KEY=your-api-key
ELIZAOS_API_URL=https://api.elizaos.com  # Optional
```

### API Endpoints

The plugin exposes REST API endpoints for runtime management:

#### Get Provider Status

```bash
GET /api/providers

Response:
{
  "success": true,
  "data": {
    "providers": [
      {
        "name": "openai",
        "displayName": "OpenAI",
        "status": "available",
        "message": null
      },
      {
        "name": "anthropic",
        "displayName": "Anthropic Claude",
        "status": "not_configured",
        "message": "Anthropic API key not configured. Set ANTHROPIC_API_KEY in environment."
      }
    ],
    "selected": "openai",
    "active": "openai"
  }
}
```

#### Set Selected Provider

```bash
PUT /api/providers/selected
Content-Type: application/json

{
  "provider": "anthropic"  // or null to clear selection
}
```

#### Set Provider Preferences

```bash
PUT /api/providers/preferences
Content-Type: application/json

{
  "preferences": ["anthropic", "openai", "ollama", "elizaos"]
}
```

### Programmatic Usage

```typescript
import {
  getProviderStatus,
  setSelectedProvider,
  setProviderPreferences,
} from '@elizaos/plugin-inference';

// Get current provider status
const status = await getProviderStatus(runtime);
console.log('Available providers:', status.providers);
console.log('Active provider:', status.active);

// Select a specific provider
await setSelectedProvider(runtime, 'anthropic');

// Set provider preferences
await setProviderPreferences(runtime, ['anthropic', 'openai', 'ollama']);
```

## Provider Selection Logic

1. **Explicit Selection**: If a provider is explicitly selected, it will be used if available
2. **Preference Order**: Falls back to the first available provider in the preference list
3. **Default Order**: If no preferences are set, uses: ElizaOS → Anthropic → OpenAI → Ollama

## Extending with Custom Providers

To add support for additional LLM providers:

1. Create a plugin that implements the standard Plugin interface
2. Add an `isValid` method to check provider availability
3. Implement handlers for supported model types
4. Import and register in the inference plugin

Example:

```typescript
export const customPlugin: Plugin = {
  name: 'custom-provider',
  description: 'Custom LLM provider',

  async isValid(runtime: IAgentRuntime): Promise<boolean> {
    // Check if provider is configured and available
    return !!runtime.getSetting('CUSTOM_API_KEY');
  },

  models: {
    [ModelType.TEXT_LARGE]: async (runtime, params) => {
      // Implement text generation
    },
    // ... other model types
  },
};
```

## Migration Guide

If you're currently using individual LLM plugins:

1. Remove direct imports of provider plugins:

   ```typescript
   // Remove these
   import { openaiPlugin } from '@elizaos/plugin-openai';
   import { anthropicPlugin } from '@elizaos/plugin-anthropic';
   ```

2. Add the inference plugin:

   ```typescript
   import { inferencePlugin } from '@elizaos/plugin-inference';
   ```

3. Update your plugin list:
   ```typescript
   const plugins = [
     inferencePlugin, // Replaces all individual LLM plugins
     // ... other plugins
   ];
   ```

## Troubleshooting

### No providers available

- Check that at least one provider has required credentials configured
- For Ollama, ensure the service is running locally
- Use the `/api/providers` endpoint to check provider status

### Wrong provider being used

- Check if a provider is explicitly selected with `SELECTED_PROVIDER`
- Verify the preference order with `INFERENCE_PREFERENCES`
- Use `/api/providers` to see which provider is active

### Provider not detected

- Ensure the provider's required environment variables are set
- Check provider-specific configuration (API keys, endpoints)
- Verify the provider plugin is properly installed

## License

MIT
