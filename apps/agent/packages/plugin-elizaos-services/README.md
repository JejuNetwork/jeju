# ElizaOS Services Plugin

A hosted AI inference and storage plugin for ElizaOS that provides
OpenAI-compatible APIs with multi-provider support and integrated Cloudflare R2
storage.

## Features

- **Multi-Provider AI Inference**: Support for OpenAI, Anthropic, Google Gemini,
  and xAI models
- **OpenAI-Compatible API**: Drop-in replacement for OpenAI API endpoints
- **Cost Optimization**: Real-time pricing with 10% markup for sustainable
  operations
- **Integrated Storage**: S3-compatible storage with Cloudflare R2
- **Comprehensive Testing**: End-to-end tests for all functionality
- **Enterprise Ready**: Built for scale with authentication and rate limiting

## Supported Models

### Text Generation

- **Small Models**: `gpt-4o-mini`, `claude-3-5-haiku`, `gemini-1.5-flash`
- **Large Models**: `gpt-4o`, `claude-3-5-sonnet`, `gemini-1.5-pro`, `grok-beta`
- **Reasoning Models**: `o1-preview`, `o1-mini`

### Specialized Models

- **Embeddings**: `text-embedding-3-small`, `text-embedding-3-large`
- **Vision**: All models support image analysis
- **Object Generation**: Structured JSON output

## Configuration

Add the following environment variables to your `.env` file:

```bash
# Required: API Authentication
ELIZAOS_API_KEY=your_api_key_here

# Optional: Custom API URL (defaults to https://api.elizaos.ai)
ELIZAOS_API_URL=https://api.elizaos.ai

# Optional: Storage Configuration (for file uploads)
ELIZAOS_STORAGE_ENDPOINT=https://your-account.r2.cloudflarestorage.com
ELIZAOS_STORAGE_BUCKET=your-bucket-name
ELIZAOS_STORAGE_ACCESS_KEY=your-access-key
ELIZAOS_STORAGE_SECRET_KEY=your-secret-key
```

## Usage

### Installation

```bash
# Install the plugin
npm install @elizaos/plugin-elizaos-services

# Or with the ElizaOS CLI
elizaos plugins add elizaos-services
```

### Basic Usage

```typescript
import { elizaOSServicesPlugin } from '@elizaos/plugin-elizaos-services';

// Add to your agent configuration
const character = {
  name: 'My Agent',
  plugins: [elizaOSServicesPlugin],
  // ... other config
};
```

### Using as OpenAI Replacement

You can use existing OpenAI plugins by pointing them to the ElizaOS API:

```bash
# Configure existing OpenAI plugin to use ElizaOS
OPENAI_BASE_URL=https://api.elizaos.ai/v1
OPENAI_API_KEY=your_elizaos_api_key
```

### Storage Operations

```typescript
// Get storage service from runtime
const service = runtime.getService('elizaos-services');
const storage = service.getStorage();

// Upload a file
const fileKey = await storage.uploadFile('my-file.txt', buffer, 'text/plain');

// Download a file
const fileBuffer = await storage.downloadFile('my-file.txt');

// Generate signed URLs
const downloadUrl = await storage.getSignedUrl('my-file.txt', 'get');
const uploadUrl = await storage.getSignedUrl('my-file.txt', 'put');

// Check if file exists
const exists = await storage.fileExists('my-file.txt');

// Delete a file
await storage.deleteFile('my-file.txt');
```

## API Compatibility

This plugin provides full compatibility with:

- **OpenAI Chat Completions API** (`/v1/chat/completions`)
- **OpenAI Embeddings API** (`/v1/embeddings`)
- **OpenAI Models API** (`/v1/models`)
- **S3 Storage API** (via integrated Cloudflare R2)

## Development

```bash
# Start development with hot-reloading
elizaos dev

# Run tests
elizaos test

# Build the plugin
npm run build
```

## Testing

The plugin includes comprehensive tests:

```bash
# Run all tests
elizaos test

# Run specific test suites
elizaos test e2e  # End-to-end tests
elizaos test component  # Unit tests
```

### Test Coverage

- ✅ Plugin initialization
- ✅ Text embeddings
- ✅ Text generation (small & large models)
- ✅ Object generation
- ✅ Image description
- ✅ Storage operations
- ✅ API authentication
- ✅ Error handling

## Pricing

All requests include:

- Real-time cost calculation
- 10% markup on provider pricing
- Detailed usage tracking
- Organization-level limits

Example costs (with 10% markup):

- GPT-4o: ~$0.0055 per 1K input tokens
- Claude 3.5 Sonnet: ~$0.0033 per 1K input tokens
- Gemini 1.5 Pro: ~$0.00138 per 1K input tokens

## Enterprise Features

- **Authentication**: JWT and API key support
- **Rate Limiting**: Configurable per-organization limits
- **Usage Tracking**: Detailed metrics and billing
- **Multi-tenancy**: Organization-based isolation
- **Cost Control**: Real-time pricing and budgets

## Support

- **Documentation**: [ElizaOS Docs](https://docs.elizaos.ai)
- **Community**: [Discord](https://discord.gg/elizaos)
- **Issues**: [GitHub Issues](https://github.com/elizaos/eliza/issues)

## License

MIT License - see LICENSE file for details.
