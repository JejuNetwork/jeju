# Compute

Compute is Jeju's decentralized AI and GPU marketplace. It provides OpenAI-compatible inference APIs, SSH/Docker access to GPU servers, and a marketplace for compute providers. Think of it as a decentralized version of OpenAI combined with vast.ai.

**URLs:** Localnet at http://127.0.0.1:4007, testnet at https://compute-testnet.jeju.network, mainnet at https://compute.jeju.network

## AI Inference

Compute provides OpenAI-compatible APIs, so existing code works with minimal changes.

### API Compatibility

Compute supports `/v1/chat/completions` for chat, `/v1/completions` for text completion, `/v1/embeddings` for vector embeddings, and `/v1/models` for listing available models.

### Basic Usage

```bash
curl http://localhost:4007/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama2",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Explain quantum computing in simple terms."}
    ]
  }'
```

### Switching from OpenAI

```typescript
import OpenAI from 'openai';

// Just change the baseURL
const openai = new OpenAI({
  baseURL: 'https://compute.jeju.network/v1',
  apiKey: 'optional-for-public-models',
});

// Same API calls work
const response = await openai.chat.completions.create({
  model: 'llama2',
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

### Available Models

Models vary by provider. Common ones include llama2 and llama3 from Meta, mixtral (Mixtral 8x7B MoE), codellama for code, phi (Microsoft Phi-2), and mock-model for testing. Check available models with `curl http://localhost:4007/v1/models`.

### Streaming

For real-time token streaming:

```typescript
const stream = await openai.chat.completions.create({
  model: 'llama2',
  messages: [{ role: 'user', content: 'Write a story' }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || '');
}
```

### Embeddings

For semantic search and RAG:

```bash
curl http://localhost:4007/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{
    "model": "nomic-embed-text",
    "input": "What is the meaning of life?"
  }'
```

## Compute Rentals

Rent bare metal or VMs with SSH/Docker access, similar to vast.ai or Lambda Labs.

### How Rentals Work

Browse available providers to see their hardware, pricing, and availability. Create a session by paying upfront for the desired duration. You receive SSH credentials and can connect directly to the machine. When done, end the session to receive a refund for unused time.

### Browsing Providers

```bash
curl http://localhost:4007/v1/providers
```

This returns available providers with their hardware specs (GPUs, CPU, memory, storage), pricing (hourly rate in USDC), availability (GPUs available, active rentals), and TEE status (type and verification).

### Creating a Rental Session

```typescript
import { ComputeClient } from '@jeju/compute-sdk';

const compute = new ComputeClient({
  endpoint: 'https://compute.jeju.network',
  wallet,
});

const session = await compute.createSession({
  providerId: 'provider-0x1234...',
  durationHours: 24,
  sshPublicKey: 'ssh-rsa AAAA... user@host',
  gpuCount: 2,
});

console.log(session.ssh); // { host, port, username }
```

### SSH Access

Once you have a session, connect directly with `ssh -p 2222 user@provider-node.example.com` or via the gateway with `ssh -p 2222 user@compute.jeju.network`.

### Docker Support

Run containers on rented hardware:

```bash
curl -X POST http://localhost:4007/v1/sessions/{sessionId}/containers \
  -H "Content-Type: application/json" \
  -d '{
    "image": "pytorch/pytorch:2.0.0-cuda11.7-cudnn8-runtime",
    "command": ["python", "train.py"],
    "gpus": "all",
    "volumes": ["/data:/workspace/data"],
    "ports": {"8000": 8000}
  }'
```

### Ending a Session

Sessions can be ended early with `await compute.endSession(sessionId)`. Unused time is refunded based on (prepaidHours - usedHours) × hourlyRate.

## Confidential Computing (TEE)

Some providers offer Trusted Execution Environments for confidential workloads. TEE provides encrypted memory that even the host can't read, remote attestation to prove code is running correctly, and protection against physical access attacks.

Supported TEE types include Intel TDX for general confidential VMs, NVIDIA CC (H100/A100) for confidential AI inference, and AMD SEV-SNP for general confidential VMs.

### Verifying Attestation

```bash
curl http://localhost:4007/v1/providers/{providerId}/attestation
```

This returns the TEE type, verification status, attestation report, and measurements including mrenclave and mrsigner.

## Provider Registration

Run your own compute node and earn by serving requests.

### Requirements

Nodes need a GPU (minimum GTX 1080, recommended H100/A100), CPU (minimum 8 cores, recommended 32+), RAM (minimum 16 GB, recommended 128+), storage (minimum 500 GB SSD, recommended 2+ TB NVMe), network (minimum 100 Mbps, recommended 1+ Gbps), and a stake of 0.1 ETH.

### Starting a Compute Node

Install with `cd apps/compute && bun install`.

Configure environment variables: `PRIVATE_KEY` for the provider wallet, `COMPUTE_PORT` for the API port (default 4007), `SSH_PORT` for SSH access (default 2222), `DOCKER_ENABLED` for container support, `MAX_RENTALS` for maximum concurrent rentals, and backend settings like `MODEL_BACKEND=ollama` and `OLLAMA_HOST`.

Start Ollama if using that backend with `ollama serve &` and `ollama pull llama2`, then start the compute node with `bun run node`.

### Registering On-Chain

```bash
cast send $COMPUTE_REGISTRY \
  "register(string,string,uint256)" \
  "https://mynode.example.com:4007" \
  "$ATTESTATION_DATA" \
  $(cast --to-wei 0.01) \
  --value 0.1ether \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

Or use the Gateway UI at `/nodes`.

### Pricing Your Services

Set competitive prices based on your hardware. Market rates are approximately $2.00-$3.00/hour for H100 80GB, $1.20-$1.80/hour for A100 80GB, $0.80-$1.20/hour for A100 40GB, $0.30-$0.50/hour for RTX 4090, and $0.05-$0.15/hour for CPU only.

### Earnings and Slashing

Providers earn from inference requests (per-token pricing), rental sessions (hourly rates), and TEE premium (extra for confidential compute). Providers can be slashed for extended downtime over 4 hours, returning incorrect results, or failing to serve paid requests.

## Payment Models

### Pay-per-Request (x402)

For inference, users pay per request. The first request returns 402 Payment Required with payment details. Pay and retry with the X-Payment header.

### Prepaid Sessions

For rentals, users pay upfront for the desired duration. Unused time is refunded on early termination.

### Multi-Token Payments

Pay in any registered token:

```typescript
await compute.createSession({
  ...
  paymentToken: USDC_ADDRESS,
});
```

## Agent Integration

Crucible agents use Compute for inference. When an agent needs to think, Crucible routes the request to a compute provider, the agent vault pays for the inference, and the provider returns the result.

A2A skills include `inference` for chat/completion, `embed` for generating embeddings, `rent_compute` for creating rental sessions, and `list_providers` for browsing available providers.

```bash
curl -X POST http://localhost:4007/a2a \
  -H "Content-Type: application/json" \
  -d '{
    "type": "task",
    "task": {
      "skill": "inference",
      "parameters": {
        "model": "llama2",
        "messages": [{"role": "user", "content": "Analyze this market data..."}]
      }
    }
  }'
```

## API Reference

Inference endpoints include `/v1/chat/completions` (POST) for chat completion, `/v1/completions` (POST) for text completion, `/v1/embeddings` (POST) for generating embeddings, and `/v1/models` (GET) for listing available models.

Compute endpoints include `/v1/providers` (GET) for listing providers, `/v1/providers/:id` (GET) for provider details, `/v1/sessions` (POST) for creating rentals, `/v1/sessions/:id` (GET) for session status, `/v1/sessions/:id` (DELETE) for ending sessions, and `/v1/hardware` (GET) for local hardware info.

Agent endpoints include `/a2a` (POST) for Agent-to-Agent, `/mcp` (POST) for Model Context Protocol, and `/health` (GET) for health checks.

## Testing

Run unit tests with `bun run test` and validate that the node is working with `bun run validate`.

## Deployment

### Localnet

Compute starts automatically with `bun run dev` from the root.

### Compute Marketplace (Testnet/Mainnet)

Build and deploy the marketplace API:

```bash
cd apps/compute
bun run build
```

Deploy via Kubernetes:

```bash
cd packages/deployment/kubernetes/helmfile
helmfile -e testnet -l app=compute sync
```

### Compute Node (Provider)

For running as a compute provider, see [Run a Compute Node](/guides/run-compute-node).

### Required Secrets

For the marketplace:
- `PRIVATE_KEY` — Wallet for contract interactions
- `OPENAI_API_KEY` — Optional, for OpenAI fallback

For compute nodes:
- `PRIVATE_KEY` — Provider wallet for registration and earnings
- `OLLAMA_HOST` — Ollama endpoint if using local models

### Docker

```bash
docker build -t jeju-compute .
docker run -p 4007:4007 -e NETWORK=testnet jeju-compute
```

## Common Issues

"No providers available" means no providers are registered or all are busy. Check the provider list with `/v1/providers`, run a local node for development, or use mock-model for testing.

"Model not found" means the requested model isn't available on any provider. Check available models with `curl http://localhost:4007/v1/models`.

"Session creation failed" means the provider couldn't provision your session. Check that you have sufficient balance for prepayment, the provider has available capacity, and your SSH public key is valid.

## Next Steps

- [Run a Compute Node](/guides/run-compute-node) — Become a provider
- [Deploy an Agent](/guides/deploy-agent) — Build agents that use compute
- [x402 Payments](/api-reference/x402) — Understand the payment protocol
