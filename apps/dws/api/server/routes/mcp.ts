/**
 * MCP Routes - Model Context Protocol implementation for DWS
 * Enables AI agents to interact with DWS services
 */

import { getDWSUrl } from '@jejunetwork/config'
import {
  getOptionalString,
  getString,
  validateOrNull,
} from '@jejunetwork/types'
import { Elysia, t } from 'elysia'
import { z } from 'zod'
import type { BackendManager } from '../../storage/backends'

interface MCPContext {
  backend?: BackendManager
}

const CidResponseSchema = z.object({ cid: z.string() })

const InferenceChoicesResponseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })),
})

const HelmManifestsSchema = z.array(z.record(z.string(), z.unknown()))

function getStringOr(
  args: Record<string, unknown>,
  key: string,
  defaultVal: string,
): string {
  return getOptionalString(args, key) ?? defaultVal
}

export function createMCPRouter(_ctx: MCPContext = {}) {
  return new Elysia({ prefix: '/mcp' })
    .post('/initialize', () => ({
      protocolVersion: '2024-11-05',
      capabilities: {
        resources: { subscribe: true, listChanged: true },
        tools: {},
        prompts: {},
      },
      serverInfo: {
        name: 'dws-mcp',
        version: '1.0.0',
        description:
          'Decentralized Web Services - Storage, Compute, CDN, Git, Pkg, Infrastructure',
      },
    }))
    .post('/resources/list', () => ({
      resources: [
        {
          uri: 'dws://storage/stats',
          name: 'Storage Statistics',
          mimeType: 'application/json',
          description: 'Current storage usage and health',
        },
        {
          uri: 'dws://compute/status',
          name: 'Compute Status',
          mimeType: 'application/json',
          description: 'Compute marketplace status and active jobs',
        },
        {
          uri: 'dws://cdn/stats',
          name: 'CDN Statistics',
          mimeType: 'application/json',
          description: 'CDN cache hit rates and edge node status',
        },
        {
          uri: 'dws://git/repos',
          name: 'Git Repositories',
          mimeType: 'application/json',
          description: 'List of Git repositories',
        },
        {
          uri: 'dws://pkg/packages',
          name: 'Packages',
          mimeType: 'application/json',
          description: 'Published packages',
        },
        {
          uri: 'dws://ci/runs',
          name: 'CI/CD Runs',
          mimeType: 'application/json',
          description: 'Recent workflow runs',
        },
        {
          uri: 'dws://workerd/workers',
          name: 'Workerd Workers',
          mimeType: 'application/json',
          description: 'Deployed V8 isolate workers',
        },
        {
          uri: 'dws://k8s/clusters',
          name: 'Kubernetes Clusters',
          mimeType: 'application/json',
          description: 'K3s/K3d managed clusters',
        },
        {
          uri: 'dws://helm/deployments',
          name: 'Helm Deployments',
          mimeType: 'application/json',
          description: 'Helm chart deployments to DWS network',
        },
        {
          uri: 'dws://mesh/services',
          name: 'Service Mesh',
          mimeType: 'application/json',
          description: 'Service mesh status and policies',
        },
      ],
    }))
    .post(
      '/resources/read',
      async ({ body, set }) => {
        const baseUrl = getDWSUrl()

        const fetchResource = async (
          path: string,
        ): Promise<Record<string, unknown>> => {
          const response = await fetch(`${baseUrl}${path}`)
          if (!response.ok)
            return { error: `Failed to fetch: ${response.status}` }
          return response.json() as Promise<Record<string, unknown>>
        }

        let data: Record<string, unknown>

        switch (body.uri) {
          case 'dws://storage/stats':
            data = await fetchResource('/storage/health')
            break
          case 'dws://compute/status':
            data = await fetchResource('/compute/health')
            break
          case 'dws://cdn/stats':
            data = await fetchResource('/cdn/stats')
            break
          case 'dws://git/repos':
            data = await fetchResource('/git/repos')
            break
          case 'dws://pkg/packages':
            data = await fetchResource('/pkg/-/v1/search?text=')
            break
          case 'dws://ci/runs':
            data = { runs: [], total: 0 }
            break
          case 'dws://workerd/workers':
            data = await fetchResource('/workerd')
            break
          case 'dws://k8s/clusters':
            data = await fetchResource('/k3s/clusters')
            break
          case 'dws://helm/deployments':
            data = await fetchResource('/helm/deployments')
            break
          case 'dws://mesh/services':
            data = await fetchResource('/mesh/health')
            break
          default:
            set.status = 400
            return { error: `Unknown resource: ${body.uri}` }
        }

        return {
          contents: [
            {
              uri: body.uri,
              mimeType: 'application/json',
              text: JSON.stringify(data, null, 2),
            },
          ],
        }
      },
      { body: t.Object({ uri: t.String({ minLength: 1 }) }) },
    )
    .post('/tools/list', () => ({
      tools: [
        {
          name: 'dws_upload',
          description: 'Upload content to decentralized storage (IPFS)',
          inputSchema: {
            type: 'object',
            properties: {
              content: {
                type: 'string',
                description: 'Content to upload (string or base64)',
              },
              filename: { type: 'string', description: 'Optional filename' },
              encoding: {
                type: 'string',
                enum: ['utf8', 'base64'],
                description: 'Content encoding',
              },
            },
            required: ['content'],
          },
        },
        {
          name: 'dws_download',
          description: 'Download content from decentralized storage by CID',
          inputSchema: {
            type: 'object',
            properties: {
              cid: { type: 'string', description: 'Content identifier (CID)' },
            },
            required: ['cid'],
          },
        },
        {
          name: 'dws_create_repo',
          description: 'Create a new Git repository',
          inputSchema: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Repository name' },
              description: {
                type: 'string',
                description: 'Repository description',
              },
              visibility: { type: 'string', enum: ['public', 'private'] },
            },
            required: ['name'],
          },
        },
        {
          name: 'dws_run_compute',
          description: 'Submit a compute job to the marketplace',
          inputSchema: {
            type: 'object',
            properties: {
              command: {
                type: 'string',
                description: 'Shell command to execute',
              },
              shell: {
                type: 'string',
                enum: ['bash', 'sh', 'pwsh'],
                description: 'Shell type',
              },
              timeout: {
                type: 'number',
                description: 'Timeout in milliseconds',
              },
            },
            required: ['command'],
          },
        },
        {
          name: 'dws_chat',
          description:
            'Send a chat completion request to available LLM providers',
          inputSchema: {
            type: 'object',
            properties: {
              model: { type: 'string', description: 'Model name' },
              prompt: { type: 'string', description: 'User prompt' },
              systemPrompt: { type: 'string', description: 'System prompt' },
            },
            required: ['prompt'],
          },
        },
        {
          name: 'dws_deploy_worker',
          description:
            'Deploy a V8 isolate worker (Cloudflare Workers compatible)',
          inputSchema: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Worker name' },
              code: {
                type: 'string',
                description: 'Worker code (base64 encoded)',
              },
              entrypoint: {
                type: 'string',
                description: 'Entrypoint file (default: worker.js)',
              },
              memoryMb: {
                type: 'number',
                description: 'Memory limit in MB (default: 128)',
              },
              timeoutMs: {
                type: 'number',
                description: 'Timeout in ms (default: 30000)',
              },
            },
            required: ['name', 'code'],
          },
        },
        {
          name: 'dws_invoke_worker',
          description: 'Invoke a deployed workerd worker',
          inputSchema: {
            type: 'object',
            properties: {
              workerId: { type: 'string', description: 'Worker ID' },
              method: {
                type: 'string',
                enum: ['GET', 'POST', 'PUT', 'DELETE'],
                description: 'HTTP method',
              },
              path: { type: 'string', description: 'Request path' },
              body: { type: 'string', description: 'Request body (optional)' },
            },
            required: ['workerId'],
          },
        },
        {
          name: 'dws_list_workers',
          description: 'List deployed workerd workers',
          inputSchema: { type: 'object', properties: {} },
        },
        {
          name: 'dws_create_cluster',
          description: 'Create a K3s/K3d Kubernetes cluster',
          inputSchema: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Cluster name' },
              provider: {
                type: 'string',
                enum: ['k3d', 'k3s', 'minikube'],
                description: 'Cluster provider',
              },
              nodes: {
                type: 'number',
                description: 'Number of nodes (default: 1)',
              },
            },
            required: ['name'],
          },
        },
        {
          name: 'dws_list_clusters',
          description: 'List K3s/K3d clusters',
          inputSchema: { type: 'object', properties: {} },
        },
        {
          name: 'dws_helm_deploy',
          description: 'Deploy Kubernetes manifests via Helm provider',
          inputSchema: {
            type: 'object',
            properties: {
              release: { type: 'string', description: 'Release name' },
              namespace: {
                type: 'string',
                description: 'Namespace (default: default)',
              },
              manifests: {
                type: 'string',
                description: 'JSON array of K8s manifest objects',
              },
            },
            required: ['release', 'manifests'],
          },
        },
        {
          name: 'dws_helm_list',
          description: 'List Helm deployments',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    }))
    .post(
      '/tools/call',
      async ({ body, request }) => {
        const baseUrl = getDWSUrl()
        const userAddress =
          request.headers.get('x-jeju-address') ||
          '0x0000000000000000000000000000000000000000'

        switch (body.name) {
          case 'dws_upload': {
            const contentStr = getString(body.arguments, 'content')
            const content =
              body.arguments.encoding === 'base64'
                ? Buffer.from(contentStr, 'base64')
                : Buffer.from(contentStr)

            const formData = new FormData()
            formData.append(
              'file',
              new Blob([content]),
              getStringOr(body.arguments, 'filename', 'upload'),
            )

            const response = await fetch(`${baseUrl}/storage/upload`, {
              method: 'POST',
              body: formData,
            })
            const result = validateOrNull(
              CidResponseSchema,
              await response.json(),
            )
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    cid: result?.cid ?? 'unknown',
                  }),
                },
              ],
            }
          }

          case 'dws_download': {
            const response = await fetch(
              `${baseUrl}/storage/download/${body.arguments.cid}`,
            )
            if (!response.ok) {
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({ error: 'Content not found' }),
                  },
                ],
              }
            }
            const content = await response.text()
            return { content: [{ type: 'text', text: content }] }
          }

          case 'dws_create_repo': {
            const response = await fetch(`${baseUrl}/git/repos`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-jeju-address': userAddress,
              },
              body: JSON.stringify({
                name: body.arguments.name,
                description: body.arguments.description ?? '',
                visibility: body.arguments.visibility ?? 'public',
              }),
            })
            const result = await response.json()
            return { content: [{ type: 'text', text: JSON.stringify(result) }] }
          }

          case 'dws_run_compute': {
            const response = await fetch(`${baseUrl}/compute/jobs`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-jeju-address': userAddress,
              },
              body: JSON.stringify({
                command: body.arguments.command,
                shell: body.arguments.shell ?? 'bash',
                timeout: body.arguments.timeout ?? 60000,
              }),
            })
            const result = await response.json()
            return { content: [{ type: 'text', text: JSON.stringify(result) }] }
          }

          case 'dws_chat': {
            const response = await fetch(
              `${baseUrl}/compute/chat/completions`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  model: body.arguments.model ?? 'default',
                  messages: [
                    ...(body.arguments.systemPrompt
                      ? [
                          {
                            role: 'system',
                            content: body.arguments.systemPrompt,
                          },
                        ]
                      : []),
                    { role: 'user', content: body.arguments.prompt },
                  ],
                }),
              },
            )
            const result = validateOrNull(
              InferenceChoicesResponseSchema,
              await response.json(),
            )
            const choice = result?.choices[0]
            return {
              content: [
                {
                  type: 'text',
                  text: choice?.message.content ?? '',
                },
              ],
            }
          }

          case 'dws_deploy_worker': {
            const response = await fetch(`${baseUrl}/workerd`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-jeju-address': userAddress,
              },
              body: JSON.stringify({
                name: body.arguments.name,
                code: body.arguments.code,
                entrypoint: body.arguments.entrypoint ?? 'worker.js',
                memoryMb: body.arguments.memoryMb ?? 128,
                timeoutMs: body.arguments.timeoutMs ?? 30000,
              }),
            })
            const result = await response.json()
            return { content: [{ type: 'text', text: JSON.stringify(result) }] }
          }

          case 'dws_invoke_worker': {
            const workerId = getString(body.arguments, 'workerId')
            const method = getStringOr(body.arguments, 'method', 'GET')
            const path = getStringOr(body.arguments, 'path', '/')
            const reqBody = getOptionalString(body.arguments, 'body')

            const response = await fetch(
              `${baseUrl}/workerd/${workerId}/http${path}`,
              {
                method,
                headers: {
                  'Content-Type': 'application/json',
                  'x-jeju-address': userAddress,
                },
                body: reqBody,
              },
            )
            const result = await response.text()
            return { content: [{ type: 'text', text: result }] }
          }

          case 'dws_list_workers': {
            const response = await fetch(`${baseUrl}/workerd`, {
              headers: { 'x-jeju-address': userAddress },
            })
            const result = await response.json()
            return { content: [{ type: 'text', text: JSON.stringify(result) }] }
          }

          case 'dws_create_cluster': {
            const response = await fetch(`${baseUrl}/k3s/clusters`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-jeju-address': userAddress,
              },
              body: JSON.stringify({
                name: body.arguments.name,
                provider: body.arguments.provider ?? 'k3d',
                nodes: body.arguments.nodes ?? 1,
              }),
            })
            const result = await response.json()
            return { content: [{ type: 'text', text: JSON.stringify(result) }] }
          }

          case 'dws_list_clusters': {
            const response = await fetch(`${baseUrl}/k3s/clusters`, {
              headers: { 'x-jeju-address': userAddress },
            })
            const result = await response.json()
            return { content: [{ type: 'text', text: JSON.stringify(result) }] }
          }

          case 'dws_helm_deploy': {
            const manifests = HelmManifestsSchema.parse(
              JSON.parse(getString(body.arguments, 'manifests')),
            )
            const response = await fetch(`${baseUrl}/helm/apply`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-jeju-address': userAddress,
              },
              body: JSON.stringify({
                release: body.arguments.release,
                namespace: body.arguments.namespace ?? 'default',
                manifests,
              }),
            })
            const result = await response.json()
            return { content: [{ type: 'text', text: JSON.stringify(result) }] }
          }

          case 'dws_helm_list': {
            const response = await fetch(`${baseUrl}/helm/deployments`, {
              headers: { 'x-jeju-address': userAddress },
            })
            const result = await response.json()
            return { content: [{ type: 'text', text: JSON.stringify(result) }] }
          }

          default:
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ error: `Unknown tool: ${body.name}` }),
                },
              ],
              isError: true,
            }
        }
      },
      {
        body: t.Object({
          name: t.String({ minLength: 1 }),
          arguments: t.Record(
            t.String(),
            t.Union([t.String(), t.Number(), t.Null()]),
          ),
        }),
      },
    )
}
