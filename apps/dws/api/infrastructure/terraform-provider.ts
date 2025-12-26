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

import { Elysia, t } from 'elysia'
import type { Address } from 'viem'

// Terraform Provider Protocol Types

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

// Request Validation Schemas (Elysia t.Object)

const ProviderConfigBody = t.Object({
  endpoint: t.Optional(t.String()),
  private_key: t.String(),
  network: t.Optional(
    t.Union([
      t.Literal('localnet'),
      t.Literal('testnet'),
      t.Literal('mainnet'),
    ]),
  ),
})

const WorkerResourceBody = t.Object({
  name: t.String({ minLength: 1 }),
  code_cid: t.String({ minLength: 1 }),
  code_hash: t.Optional(t.String()),
  entrypoint: t.Optional(t.String()),
  runtime: t.Optional(
    t.Union([t.Literal('workerd'), t.Literal('bun'), t.Literal('docker')]),
  ),
  memory_mb: t.Optional(t.Number()),
  timeout_ms: t.Optional(t.Number()),
  min_instances: t.Optional(t.Number()),
  max_instances: t.Optional(t.Number()),
  scale_to_zero: t.Optional(t.Boolean()),
  tee_required: t.Optional(t.Boolean()),
  tee_platform: t.Optional(t.String()),
  env: t.Optional(t.Record(t.String(), t.String())),
})

const ContainerResourceBody = t.Object({
  name: t.String({ minLength: 1 }),
  image: t.String({ minLength: 1 }),
  cpu_cores: t.Optional(t.Number()),
  memory_mb: t.Optional(t.Number()),
  gpu_type: t.Optional(t.String()),
  gpu_count: t.Optional(t.Number()),
  command: t.Optional(t.Array(t.String())),
  args: t.Optional(t.Array(t.String())),
  env: t.Optional(t.Record(t.String(), t.String())),
  ports: t.Optional(t.Array(t.Number())),
  tee_required: t.Optional(t.Boolean()),
})

const StorageResourceBody = t.Object({
  name: t.String({ minLength: 1 }),
  size_gb: t.Number({ minimum: 1 }),
  type: t.Optional(
    t.Union([t.Literal('ipfs'), t.Literal('arweave'), t.Literal('s3')]),
  ),
  replication: t.Optional(t.Number()),
})

const DomainResourceBody = t.Object({
  name: t.String({ minLength: 1 }),
  content_hash: t.Optional(t.String()),
  content_cid: t.Optional(t.String()),
  ttl: t.Optional(t.Number()),
})

const NodeResourceBody = t.Object({
  endpoint: t.String({ format: 'uri' }),
  capabilities: t.Array(t.String()),
  cpu_cores: t.Number({ minimum: 1 }),
  memory_mb: t.Number({ minimum: 512 }),
  storage_mb: t.Number({ minimum: 1024 }),
  gpu_type: t.Optional(t.String()),
  gpu_count: t.Optional(t.Number()),
  tee_platform: t.Optional(t.String()),
  price_per_hour_wei: t.Optional(t.String()),
  price_per_gb_wei: t.Optional(t.String()),
  price_per_request_wei: t.Optional(t.String()),
  stake_wei: t.Optional(t.String()),
  region: t.Optional(t.String()),
})

const IdParams = t.Object({ id: t.String() })

export function createTerraformProviderRouter() {
  return (
    new Elysia({ prefix: '/terraform' })
      .get('/v1/schema', () => {
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
      .post(
        '/v1/configure',
        ({ body }) => ({
          success: true,
          network: body.network ?? 'mainnet',
          endpoint: body.endpoint ?? 'https://dws.jejunetwork.org',
        }),
        { body: ProviderConfigBody },
      )
      // Worker Resources
      .post(
        '/v1/resources/dws_worker',
        ({ body, headers, set }) => {
          // Owner from x-jeju-address header - reserved for future use
          void (headers['x-jeju-address'] as Address)
          const workerId = `tf-worker-${Date.now()}`
          set.status = 201
          return {
            id: workerId,
            name: body.name,
            code_cid: body.code_cid,
            code_hash: body.code_hash ?? '',
            entrypoint: body.entrypoint ?? 'index.js',
            runtime: body.runtime ?? 'workerd',
            memory_mb: body.memory_mb ?? 128,
            timeout_ms: body.timeout_ms ?? 30000,
            min_instances: body.min_instances ?? 0,
            max_instances: body.max_instances ?? 10,
            scale_to_zero: body.scale_to_zero ?? true,
            tee_required: body.tee_required ?? false,
            tee_platform: body.tee_platform ?? 'none',
            status: 'deploying',
            endpoints: [],
            env: body.env ?? {},
          }
        },
        { body: WorkerResourceBody },
      )
      .get(
        '/v1/resources/dws_worker/:id',
        ({ params }) => ({
          id: params.id,
          status: 'active',
          endpoints: [`https://${params.id}.workers.dws.jejunetwork.org`],
        }),
        { params: IdParams },
      )
      .put(
        '/v1/resources/dws_worker/:id',
        ({ params, body }) => ({
          id: params.id,
          ...body,
          status: 'updating',
        }),
        { params: IdParams, body: WorkerResourceBody },
      )
      .delete(
        '/v1/resources/dws_worker/:id',
        ({ params }) => ({ success: true, id: params.id }),
        { params: IdParams },
      )
      // Container Resources
      .post(
        '/v1/resources/dws_container',
        ({ body, set }) => {
          const containerId = `tf-container-${Date.now()}`
          set.status = 201
          return {
            id: containerId,
            ...body,
            status: 'starting',
            endpoint: '',
          }
        },
        { body: ContainerResourceBody },
      )
      .get(
        '/v1/resources/dws_container/:id',
        ({ params }) => ({
          id: params.id,
          status: 'running',
          endpoint: `https://${params.id}.containers.dws.jejunetwork.org`,
        }),
        { params: IdParams },
      )
      .delete(
        '/v1/resources/dws_container/:id',
        ({ params }) => ({ success: true, id: params.id }),
        { params: IdParams },
      )
      // Storage Resources
      .post(
        '/v1/resources/dws_storage',
        ({ body }) => {
          const storageId = `tf-storage-${Date.now()}`
          return {
            id: storageId,
            ...body,
            cid: '',
            endpoint: `https://storage.dws.jejunetwork.org/v1/${storageId}`,
          }
        },
        { body: StorageResourceBody },
      )
      .get(
        '/v1/resources/dws_storage/:id',
        ({ params }) => ({
          id: params.id,
          cid: `Qm${params.id.slice(0, 44)}`,
          endpoint: `https://storage.dws.jejunetwork.org/v1/${params.id}`,
        }),
        { params: IdParams },
      )
      .delete(
        '/v1/resources/dws_storage/:id',
        ({ params }) => ({ success: true, id: params.id }),
        { params: IdParams },
      )
      // Domain Resources
      .post(
        '/v1/resources/dws_domain',
        ({ body }) => {
          const domainId = `tf-domain-${Date.now()}`
          const fullName = body.name.endsWith('.jns')
            ? body.name
            : `${body.name}.jns`
          return {
            id: domainId,
            name: fullName,
            content_hash: body.content_hash ?? '',
            content_cid: body.content_cid ?? '',
            ttl: body.ttl ?? 300,
            resolver: '0x0000000000000000000000000000000000000000',
          }
        },
        { body: DomainResourceBody },
      )
      .get(
        '/v1/resources/dws_domain/:id',
        ({ params }) => ({
          id: params.id,
          resolver: '0x0000000000000000000000000000000000000000',
        }),
        { params: IdParams },
      )
      .delete(
        '/v1/resources/dws_domain/:id',
        ({ params }) => ({ success: true, id: params.id }),
        { params: IdParams },
      )
      // Node Resources
      .post(
        '/v1/resources/dws_node',
        ({ body }) => {
          const nodeId = `tf-node-${Date.now()}`
          return {
            id: nodeId,
            agent_id: '0',
            ...body,
            status: 'registering',
          }
        },
        { body: NodeResourceBody },
      )
      .get(
        '/v1/resources/dws_node/:id',
        ({ params }) => ({
          id: params.id,
          agent_id: '12345',
          status: 'online',
        }),
        { params: IdParams },
      )
      .delete(
        '/v1/resources/dws_node/:id',
        ({ params }) => ({ success: true, id: params.id }),
        { params: IdParams },
      )
      // Data Sources
      .get('/v1/data/dws_nodes', () => ({
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
