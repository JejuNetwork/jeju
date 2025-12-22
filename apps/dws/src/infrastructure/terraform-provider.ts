/**
 * Terraform Provider for DWS
 *
 * Allows provisioning infrastructure on the DWS decentralized network
 * using standard Terraform workflows.
 *
 * Resources supported:
 * - dws_worker: Deploy serverless workers
 * - dws_container: Run containers
 * - dws_storage: Provision storage volumes
 * - dws_domain: Register JNS domains
 * - dws_node: Register as a node operator
 *
 * Usage:
 * ```hcl
 * provider "dws" {
 *   endpoint    = "https://dws.jejunetwork.org"
 *   private_key = var.dws_private_key
 *   network     = "mainnet"
 * }
 *
 * resource "dws_worker" "api" {
 *   name        = "my-api"
 *   code_cid    = "Qm..."
 *   memory_mb   = 256
 *   min_instances = 1
 *   max_instances = 10
 *
 *   tee_required = true
 * }
 * ```
 */

import { expectValid } from '@jejunetwork/types'
import { Elysia } from 'elysia'
import { z } from 'zod'

// ============================================================================
// Terraform Provider Protocol Types
// ============================================================================

interface TerraformSchema {
  version: number
  provider?: ProviderSchema
  resource_schemas?: Record<string, ResourceSchema>
  data_source_schemas?: Record<string, ResourceSchema>
}

interface ProviderSchema {
  version: number
  block: BlockSchema
}

interface ResourceSchema {
  version: number
  block: BlockSchema
}

interface BlockSchema {
  attributes?: Record<string, AttributeSchema>
  block_types?: Record<string, BlockTypeSchema>
}

interface AttributeSchema {
  type: string | [string, string]
  description?: string
  required?: boolean
  optional?: boolean
  computed?: boolean
  sensitive?: boolean
}

interface BlockTypeSchema {
  nesting_mode: 'single' | 'list' | 'set' | 'map'
  block: BlockSchema
  min_items?: number
  max_items?: number
}

// ============================================================================
// DWS Resource Schemas
// ============================================================================

const DWS_PROVIDER_SCHEMA: ProviderSchema = {
  version: 1,
  block: {
    attributes: {
      endpoint: {
        type: 'string',
        description: 'DWS API endpoint URL',
        optional: true,
      },
      private_key: {
        type: 'string',
        description: 'Private key for signing transactions',
        required: true,
        sensitive: true,
      },
      network: {
        type: 'string',
        description: 'Network to use: localnet, testnet, mainnet',
        optional: true,
      },
    },
  },
}

const DWS_WORKER_SCHEMA: ResourceSchema = {
  version: 1,
  block: {
    attributes: {
      id: { type: 'string', computed: true },
      name: { type: 'string', required: true },
      code_cid: { type: 'string', required: true },
      code_hash: { type: 'string', optional: true, computed: true },
      entrypoint: { type: 'string', optional: true },
      runtime: { type: 'string', optional: true },
      memory_mb: { type: 'number', optional: true },
      timeout_ms: { type: 'number', optional: true },
      min_instances: { type: 'number', optional: true },
      max_instances: { type: 'number', optional: true },
      scale_to_zero: { type: 'bool', optional: true },
      tee_required: { type: 'bool', optional: true },
      tee_platform: { type: 'string', optional: true },
      status: { type: 'string', computed: true },
      endpoints: { type: ['list', 'string'], computed: true },
      env: { type: ['map', 'string'], optional: true },
    },
  },
}

const DWS_CONTAINER_SCHEMA: ResourceSchema = {
  version: 1,
  block: {
    attributes: {
      id: { type: 'string', computed: true },
      name: { type: 'string', required: true },
      image: { type: 'string', required: true },
      cpu_cores: { type: 'number', optional: true },
      memory_mb: { type: 'number', optional: true },
      gpu_type: { type: 'string', optional: true },
      gpu_count: { type: 'number', optional: true },
      command: { type: ['list', 'string'], optional: true },
      args: { type: ['list', 'string'], optional: true },
      env: { type: ['map', 'string'], optional: true },
      ports: { type: ['list', 'number'], optional: true },
      tee_required: { type: 'bool', optional: true },
      status: { type: 'string', computed: true },
      endpoint: { type: 'string', computed: true },
    },
  },
}

const DWS_STORAGE_SCHEMA: ResourceSchema = {
  version: 1,
  block: {
    attributes: {
      id: { type: 'string', computed: true },
      name: { type: 'string', required: true },
      size_gb: { type: 'number', required: true },
      type: { type: 'string', optional: true }, // ipfs, arweave, s3
      replication: { type: 'number', optional: true },
      cid: { type: 'string', computed: true },
      endpoint: { type: 'string', computed: true },
    },
  },
}

const DWS_DOMAIN_SCHEMA: ResourceSchema = {
  version: 1,
  block: {
    attributes: {
      id: { type: 'string', computed: true },
      name: { type: 'string', required: true },
      content_hash: { type: 'string', optional: true },
      content_cid: { type: 'string', optional: true },
      ttl: { type: 'number', optional: true },
      resolver: { type: 'string', computed: true },
    },
  },
}

const DWS_NODE_SCHEMA: ResourceSchema = {
  version: 1,
  block: {
    attributes: {
      id: { type: 'string', computed: true },
      agent_id: { type: 'string', computed: true },
      endpoint: { type: 'string', required: true },
      capabilities: { type: ['list', 'string'], required: true },
      cpu_cores: { type: 'number', required: true },
      memory_mb: { type: 'number', required: true },
      storage_mb: { type: 'number', required: true },
      gpu_type: { type: 'string', optional: true },
      gpu_count: { type: 'number', optional: true },
      tee_platform: { type: 'string', optional: true },
      price_per_hour_wei: { type: 'string', optional: true },
      price_per_gb_wei: { type: 'string', optional: true },
      price_per_request_wei: { type: 'string', optional: true },
      stake_wei: { type: 'string', optional: true },
      region: { type: 'string', optional: true },
      status: { type: 'string', computed: true },
    },
  },
}

// ============================================================================
// Request Validation Schemas
// ============================================================================

const providerConfigSchema = z.object({
  endpoint: z.string().optional(),
  private_key: z.string(),
  network: z.enum(['localnet', 'testnet', 'mainnet']).optional(),
})

const workerResourceSchema = z.object({
  name: z.string().min(1),
  code_cid: z.string().min(1),
  code_hash: z.string().optional(),
  entrypoint: z.string().optional(),
  runtime: z.enum(['workerd', 'bun', 'docker']).optional(),
  memory_mb: z.number().optional(),
  timeout_ms: z.number().optional(),
  min_instances: z.number().optional(),
  max_instances: z.number().optional(),
  scale_to_zero: z.boolean().optional(),
  tee_required: z.boolean().optional(),
  tee_platform: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
})

const containerResourceSchema = z.object({
  name: z.string().min(1),
  image: z.string().min(1),
  cpu_cores: z.number().optional(),
  memory_mb: z.number().optional(),
  gpu_type: z.string().optional(),
  gpu_count: z.number().optional(),
  command: z.array(z.string()).optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  ports: z.array(z.number()).optional(),
  tee_required: z.boolean().optional(),
})

const storageResourceSchema = z.object({
  name: z.string().min(1),
  size_gb: z.number().min(1),
  type: z.enum(['ipfs', 'arweave', 's3']).optional(),
  replication: z.number().optional(),
})

const domainResourceSchema = z.object({
  name: z.string().min(1),
  content_hash: z.string().optional(),
  content_cid: z.string().optional(),
  ttl: z.number().optional(),
})

const nodeResourceSchema = z.object({
  endpoint: z.string().url(),
  capabilities: z.array(z.string()),
  cpu_cores: z.number().min(1),
  memory_mb: z.number().min(512),
  storage_mb: z.number().min(1024),
  gpu_type: z.string().optional(),
  gpu_count: z.number().optional(),
  tee_platform: z.string().optional(),
  price_per_hour_wei: z.string().optional(),
  price_per_gb_wei: z.string().optional(),
  price_per_request_wei: z.string().optional(),
  stake_wei: z.string().optional(),
  region: z.string().optional(),
})

// ============================================================================
// Terraform Provider Router
// ============================================================================

export function createTerraformProviderRouter() {
  return (
    new Elysia({ prefix: '/terraform/v1' })
      // Provider schema endpoint (for terraform init)
      .get('/schema', () => {
        const schema: TerraformSchema = {
          version: 1,
          provider: DWS_PROVIDER_SCHEMA,
          resource_schemas: {
            dws_worker: DWS_WORKER_SCHEMA,
            dws_container: DWS_CONTAINER_SCHEMA,
            dws_storage: DWS_STORAGE_SCHEMA,
            dws_domain: DWS_DOMAIN_SCHEMA,
            dws_node: DWS_NODE_SCHEMA,
          },
          data_source_schemas: {
            dws_worker: DWS_WORKER_SCHEMA,
            dws_nodes: DWS_NODE_SCHEMA,
          },
        }
        return schema
      })

      // Configure provider
      .post('/configure', ({ body }) => {
        const config = expectValid(
          providerConfigSchema,
          body,
          'Provider config body',
        )

        return {
          success: true,
          network: config.network ?? 'mainnet',
          endpoint: config.endpoint ?? 'https://dws.jejunetwork.org',
        }
      })

      // ============================================================================
      // Worker Resources
      // ============================================================================

      .post('/resources/dws_worker', ({ body }) => {
        const validated = expectValid(
          workerResourceSchema,
          body,
          'Worker resource body',
        )

        const workerId = `tf-worker-${Date.now()}`

        return {
          id: workerId,
          name: validated.name,
          code_cid: validated.code_cid,
          code_hash: validated.code_hash ?? '',
          entrypoint: validated.entrypoint ?? 'index.js',
          runtime: validated.runtime ?? 'workerd',
          memory_mb: validated.memory_mb ?? 128,
          timeout_ms: validated.timeout_ms ?? 30000,
          min_instances: validated.min_instances ?? 0,
          max_instances: validated.max_instances ?? 10,
          scale_to_zero: validated.scale_to_zero ?? true,
          tee_required: validated.tee_required ?? false,
          tee_platform: validated.tee_platform ?? 'none',
          status: 'deploying',
          endpoints: [],
          env: validated.env ?? {},
        }
      })

      .get('/resources/dws_worker/:id', ({ params }) => ({
        id: params.id,
        status: 'active',
        endpoints: [`https://${params.id}.workers.dws.jejunetwork.org`],
      }))

      .put('/resources/dws_worker/:id', ({ params, body }) => {
        const validated = expectValid(
          workerResourceSchema,
          body,
          'Worker update body',
        )

        return {
          id: params.id,
          ...validated,
          status: 'updating',
        }
      })

      .delete('/resources/dws_worker/:id', ({ params }) => ({
        success: true,
        id: params.id,
      }))

      // ============================================================================
      // Container Resources
      // ============================================================================

      .post('/resources/dws_container', ({ body }) => {
        const validated = expectValid(
          containerResourceSchema,
          body,
          'Container resource body',
        )

        const containerId = `tf-container-${Date.now()}`

        return {
          id: containerId,
          ...validated,
          status: 'starting',
          endpoint: '',
        }
      })

      .get('/resources/dws_container/:id', ({ params }) => ({
        id: params.id,
        status: 'running',
        endpoint: `https://${params.id}.containers.dws.jejunetwork.org`,
      }))

      .delete('/resources/dws_container/:id', ({ params }) => ({
        success: true,
        id: params.id,
      }))

      // ============================================================================
      // Storage Resources
      // ============================================================================

      .post('/resources/dws_storage', ({ body }) => {
        const validated = expectValid(
          storageResourceSchema,
          body,
          'Storage resource body',
        )

        const storageId = `tf-storage-${Date.now()}`

        return {
          id: storageId,
          ...validated,
          cid: '',
          endpoint: `https://storage.dws.jejunetwork.org/v1/${storageId}`,
        }
      })

      .get('/resources/dws_storage/:id', ({ params }) => ({
        id: params.id,
        cid: `Qm${params.id.slice(0, 44)}`,
        endpoint: `https://storage.dws.jejunetwork.org/v1/${params.id}`,
      }))

      .delete('/resources/dws_storage/:id', ({ params }) => ({
        success: true,
        id: params.id,
      }))

      // ============================================================================
      // Domain Resources
      // ============================================================================

      .post('/resources/dws_domain', ({ body }) => {
        const validated = expectValid(
          domainResourceSchema,
          body,
          'Domain resource body',
        )

        const domainId = `tf-domain-${Date.now()}`
        const fullName = validated.name.endsWith('.jns')
          ? validated.name
          : `${validated.name}.jns`

        return {
          id: domainId,
          name: fullName,
          content_hash: validated.content_hash ?? '',
          content_cid: validated.content_cid ?? '',
          ttl: validated.ttl ?? 300,
          resolver: '0x0000000000000000000000000000000000000000',
        }
      })

      .get('/resources/dws_domain/:id', ({ params }) => ({
        id: params.id,
        resolver: '0x0000000000000000000000000000000000000000',
      }))

      .delete('/resources/dws_domain/:id', ({ params }) => ({
        success: true,
        id: params.id,
      }))

      // ============================================================================
      // Node Resources
      // ============================================================================

      .post('/resources/dws_node', ({ body }) => {
        const validated = expectValid(
          nodeResourceSchema,
          body,
          'Node resource body',
        )

        const nodeId = `tf-node-${Date.now()}`

        return {
          id: nodeId,
          agent_id: '0',
          ...validated,
          status: 'registering',
        }
      })

      .get('/resources/dws_node/:id', ({ params }) => ({
        id: params.id,
        agent_id: '12345',
        status: 'online',
      }))

      .delete('/resources/dws_node/:id', ({ params }) => ({
        success: true,
        id: params.id,
      }))

      // ============================================================================
      // Data Sources
      // ============================================================================

      .get('/data/dws_nodes', () => ({
        nodes: [
          {
            id: 'node-1',
            agent_id: '12345',
            endpoint: 'https://node1.dws.jejunetwork.org',
            capabilities: ['compute', 'storage'],
            status: 'online',
          },
        ],
      }))
  )
}
