# ElizaOS Plugin Local Embedding

Fast, private, and accurate text embeddings using Transformers.js with WebAssembly runtime.

## 🎯 Key Features

- **100% Local**: No API calls, complete privacy
- **Pure JavaScript**: No native dependencies, runs everywhere
- **WebAssembly Powered**: Fast inference without native binaries
- **Accurate**: High-quality embeddings from Xenova models
- **Easy Integration**: Drop-in replacement for API-based embeddings
- **Multiple Models**: Support for various embedding models
- **Auto-download**: Models downloaded automatically on first use

## 🏢 Supported Models

- **Xenova/bge-base-en-v1.5** (default, 768 dims) - Best overall performance
- **Xenova/all-MiniLM-L6-v2** (384 dims) - Lightweight and fast
- **Xenova/all-mpnet-base-v2** (768 dims) - High quality embeddings
- **Xenova/bge-small-en-v1.5** (384 dims) - Smaller, faster variant
- **Xenova/gte-small** (384 dims) - Good balance of size and quality
- **Xenova/e5-small-v2** (384 dims) - Efficient E5 model

## Installation

```bash
npm install @elizaos/plugin-local-embedding
```

## Usage

### Basic Usage

```typescript
import { localEmbeddingPlugin } from '@elizaos/plugin-local-embedding';
import { ModelType } from '@elizaos/core';

// Initialize the plugin
await localEmbeddingPlugin.init({}, runtime);

// Generate embeddings
const embedding = await runtime.useModel(ModelType.TEXT_EMBEDDING, {
  input: 'Hello, World! This is a test.',
});

console.log(`Embedding dimensions: ${embedding.length}`); // 768 for BAAI models
```

### Configuration

Set environment variables to customize behavior:

```bash
# Choose embedding model (default: BAAI/bge-base-en-v1.5)
LOCAL_EMBEDDING_MODEL="BAAI/bge-base-en-v1.5"

# Set batch size for processing (default: 32)
LOCAL_EMBEDDING_BATCH_SIZE=32
```

### Integration with Plugin-Inference

When used with `@elizaos/plugin-inference`, all embedding requests automatically route to this plugin:

```typescript
import { inferencePlugin } from '@elizaos/plugin-inference';

// All TEXT_EMBEDDING requests use local FastEmbed
const embedding = await runtime.useModel(ModelType.TEXT_EMBEDDING, {
  input: 'This will use local embeddings automatically',
});
```

## 🚀 Performance

- **Speed**: 10-50ms per embedding on modern CPUs
- **Memory**: ~200-500MB depending on model
- **Dimensions**: 768 (BAAI models) or 384 (MiniLM)

## 🔧 Advanced Usage

### Batch Processing

```typescript
const texts = ['First document', 'Second document', 'Third document'];

const embeddings = [];
for (const text of texts) {
  const embedding = await runtime.useModel(ModelType.TEXT_EMBEDDING, text);
  embeddings.push(embedding);
}
```

### Direct Plugin Usage

```typescript
import { localEmbeddingPlugin } from '@elizaos/plugin-local-embedding';

// Use the plugin directly
if (localEmbeddingPlugin.models) {
  const embedding = await localEmbeddingPlugin.models[ModelType.TEXT_EMBEDDING](runtime, {
    input: 'Direct plugin usage',
  });
}
```

## 📊 Model Selection Guide

| Model                  | Dimensions | Speed     | Quality   | Use Case                          |
| ---------------------- | ---------- | --------- | --------- | --------------------------------- |
| BAAI/bge-base-en-v1.5  | 768        | Medium    | Excellent | General purpose (recommended)     |
| BAAI/bge-small-en-v1.5 | 384        | Fast      | Good      | Resource-constrained environments |
| all-MiniLM-L6-v2       | 384        | Very Fast | Good      | Low-latency applications          |
| multilingual-e5-large  | 1024       | Slow      | Excellent | Multilingual content              |

## 🛠️ Troubleshooting

### Common Issues

1. **Module not found errors**: Install dependencies with `bun install` or `npm install`
2. **Out of memory**: Use a smaller model like `bge-small-en-v1.5`
3. **Slow performance**: Reduce batch size or use a smaller model

### Debug Logging

Enable debug logs to see detailed information:

```typescript
import { logger } from '@elizaos/core';
logger.level = 'debug';
```

## 📝 License

MIT © 2024 ElizaOS

## 🔗 Links

- [FastEmbed-js](https://github.com/Anush008/fastembed-js)
- [BAAI BGE Models](https://huggingface.co/BAAI)
- [MTEB Leaderboard](https://huggingface.co/spaces/mteb/leaderboard)
