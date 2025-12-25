/**
 * Containers Actions - OCI Container Registry
 */

import type {
  Action,
  ActionExample,
  HandlerCallback,
  HandlerOptions,
  IAgentRuntime,
  Memory,
  State,
} from '@elizaos/core'
import { getNetworkName } from '@jejunetwork/config'
import type { Address } from 'viem'
import { JEJU_SERVICE_NAME, type JejuService } from '../service'
import { getMessageText, validateServiceExists } from '../validation'

const networkName = getNetworkName()

// ============================================================================
// Create Repository
// ============================================================================

export const createRepoAction: Action = {
  name: 'CREATE_CONTAINER_REPO',
  similes: ['create repo', 'create container repository', 'new container repo'],
  description: `Create a new container repository on ${networkName}`,
  validate: async (runtime: IAgentRuntime): Promise<boolean> =>
    validateServiceExists(runtime),
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService
    const sdk = service.getClient()

    const text = getMessageText(message)

    // Parse: "create repo myorg/myimage"
    const repoMatch = text.match(
      /repo(?:sitory)?\s+([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)/i,
    )
    if (!repoMatch) {
      await callback?.({
        text: "Please specify the repository name as 'namespace/name'. Example: 'Create repo myorg/myimage'",
      })
      return
    }

    const namespace = repoMatch[1]
    const name = repoMatch[2]

    // Check for visibility flag
    const isPrivate = /private/i.test(text)
    const visibility = isPrivate ? 'PRIVATE' : 'PUBLIC'

    // Check for description
    const descMatch = text.match(/description[:\s]+["']?([^"']+)["']?/i)
    const description = descMatch ? descMatch[1].trim() : ''

    const txHash = await sdk.containers.createRepository({
      name,
      namespace,
      description,
      visibility: visibility as 'PUBLIC' | 'PRIVATE' | 'ORGANIZATION',
    })

    await callback?.({
      text: `Created container repository: ${namespace}/${name}
- Visibility: ${visibility}
- Transaction: ${txHash}

Push images with: docker push ${networkName.toLowerCase()}.xyz/${namespace}/${name}:tag`,
    })

    return
  },
  examples: [
    [
      {
        name: 'user',
        content: { text: 'Create repo myorg/myimage' },
      },
      {
        name: 'assistant',
        content: { text: 'Created container repository: myorg/myimage' },
      },
    ],
  ] as ActionExample[][],
}

// ============================================================================
// Get Repository Info
// ============================================================================

export const getRepoInfoAction: Action = {
  name: 'GET_CONTAINER_REPO',
  similes: ['get repo', 'repo info', 'container info', 'show repo'],
  description: `Get container repository information from ${networkName}`,
  validate: async (runtime: IAgentRuntime): Promise<boolean> =>
    validateServiceExists(runtime),
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService
    const sdk = service.getClient()

    const text = getMessageText(message)

    // Parse repo name
    const repoMatch = text.match(/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)/)
    if (!repoMatch) {
      await callback?.({
        text: "Please specify the repository as 'namespace/name'. Example: 'Get repo info myorg/myimage'",
      })
      return
    }

    const fullName = `${repoMatch[1]}/${repoMatch[2]}`
    const repo = await sdk.containers.getRepositoryByName(fullName)

    await callback?.({
      text: `Repository: ${repo.namespace}/${repo.name}
- Owner: ${repo.owner}
- Visibility: ${repo.visibility}
- Description: ${repo.description ? repo.description : '(none)'}
- Tags: ${repo.tags.length > 0 ? repo.tags.join(', ') : '(none)'}
- Pull Count: ${repo.pullCount.toString()}
- Star Count: ${repo.starCount.toString()}
- Verified: ${repo.isVerified}
- Created: ${new Date(Number(repo.createdAt) * 1000).toISOString()}`,
    })

    return
  },
  examples: [
    [
      {
        name: 'user',
        content: { text: 'Get repo info myorg/myimage' },
      },
      {
        name: 'assistant',
        content: {
          text: 'Repository: myorg/myimage\n- Pull Count: 100\n- Verified: true',
        },
      },
    ],
  ] as ActionExample[][],
}

// ============================================================================
// List My Repositories
// ============================================================================

export const listMyReposAction: Action = {
  name: 'LIST_MY_REPOS',
  similes: ['my repos', 'my repositories', 'list my containers', 'my images'],
  description: `List your container repositories on ${networkName}`,
  validate: async (runtime: IAgentRuntime): Promise<boolean> =>
    validateServiceExists(runtime),
  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService
    const sdk = service.getClient()

    const repos = await sdk.containers.listMyRepositories()

    if (repos.length === 0) {
      await callback?.({
        text: "You don't have any container repositories yet. Create one with 'create repo namespace/name'",
      })
      return
    }

    const repoList = repos
      .map(
        (r: {
          namespace: string
          name: string
          visibility: string
          pullCount: number | bigint
        }) =>
          `- ${r.namespace}/${r.name} (${r.visibility}, ${r.pullCount} pulls)`,
      )
      .join('\n')

    await callback?.({
      text: `Your Container Repositories (${repos.length}):\n${repoList}`,
    })

    return
  },
  examples: [
    [
      {
        name: 'user',
        content: { text: 'Show my container repos' },
      },
      {
        name: 'assistant',
        content: {
          text: 'Your Container Repositories (2):\n- myorg/api (PUBLIC, 50 pulls)\n- myorg/worker (PRIVATE, 10 pulls)',
        },
      },
    ],
  ] as ActionExample[][],
}

// ============================================================================
// Get Image Manifest
// ============================================================================

export const getManifestAction: Action = {
  name: 'GET_IMAGE_MANIFEST',
  similes: ['get manifest', 'image manifest', 'image info', 'tag info'],
  description: `Get container image manifest from ${networkName}`,
  validate: async (runtime: IAgentRuntime): Promise<boolean> =>
    validateServiceExists(runtime),
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService
    const sdk = service.getClient()

    const text = getMessageText(message)

    // Parse: myorg/myimage:tag
    const imageMatch = text.match(
      /([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+):([a-zA-Z0-9_.-]+)/,
    )
    if (!imageMatch) {
      await callback?.({
        text: "Please specify the image as 'namespace/name:tag'. Example: 'Get manifest myorg/myimage:latest'",
      })
      return
    }

    const fullName = `${imageMatch[1]}/${imageMatch[2]}`
    const tag = imageMatch[3]

    const repo = await sdk.containers.getRepositoryByName(fullName)
    const manifest = await sdk.containers.getManifestByTag(repo.repoId, tag)

    await callback?.({
      text: `Image: ${fullName}:${tag}
- Digest: ${manifest.digest}
- Size: ${(Number(manifest.size) / 1024 / 1024).toFixed(2)} MB
- Architectures: ${manifest.architectures.join(', ')}
- Layers: ${manifest.layers.length}
- Publisher: ${manifest.publisher}
- Published: ${new Date(Number(manifest.publishedAt) * 1000).toISOString()}`,
    })

    return
  },
  examples: [
    [
      {
        name: 'user',
        content: { text: 'Get manifest myorg/myimage:latest' },
      },
      {
        name: 'assistant',
        content: {
          text: 'Image: myorg/myimage:latest\n- Size: 150.5 MB\n- Architectures: amd64, arm64',
        },
      },
    ],
  ] as ActionExample[][],
}

// ============================================================================
// Star Repository
// ============================================================================

export const starRepoAction: Action = {
  name: 'STAR_CONTAINER_REPO',
  similes: ['star repo', 'star repository', 'favorite repo'],
  description: `Star a container repository on ${networkName}`,
  validate: async (runtime: IAgentRuntime): Promise<boolean> =>
    validateServiceExists(runtime),
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService
    const sdk = service.getClient()

    const text = getMessageText(message)

    const repoMatch = text.match(/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)/)
    if (!repoMatch) {
      await callback?.({
        text: "Please specify the repository as 'namespace/name'. Example: 'Star repo myorg/myimage'",
      })
      return
    }

    const fullName = `${repoMatch[1]}/${repoMatch[2]}`
    const repo = await sdk.containers.getRepositoryByName(fullName)
    const txHash = await sdk.containers.starRepository(repo.repoId)

    await callback?.({
      text: `Starred ${fullName}\nTransaction: ${txHash}`,
    })

    return
  },
  examples: [
    [
      {
        name: 'user',
        content: { text: 'Star repo myorg/myimage' },
      },
      {
        name: 'assistant',
        content: { text: 'Starred myorg/myimage' },
      },
    ],
  ] as ActionExample[][],
}

// ============================================================================
// Grant Access
// ============================================================================

export const grantAccessAction: Action = {
  name: 'GRANT_REPO_ACCESS',
  similes: ['grant access', 'add collaborator', 'share repo'],
  description: `Grant access to a private container repository on ${networkName}`,
  validate: async (runtime: IAgentRuntime): Promise<boolean> =>
    validateServiceExists(runtime),
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService
    const sdk = service.getClient()

    const text = getMessageText(message)

    const repoMatch = text.match(/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)/)
    const addressMatch = text.match(/0x[a-fA-F0-9]{40}/)

    if (!repoMatch || !addressMatch) {
      await callback?.({
        text: "Please specify the repository and address. Example: 'Grant access to myorg/myimage for 0x1234...'",
      })
      return
    }

    const fullName = `${repoMatch[1]}/${repoMatch[2]}`
    const user = addressMatch[0] as Address

    const repo = await sdk.containers.getRepositoryByName(fullName)
    const txHash = await sdk.containers.grantAccess(repo.repoId, user)

    await callback?.({
      text: `Granted access to ${fullName} for ${user}\nTransaction: ${txHash}`,
    })

    return
  },
  examples: [
    [
      {
        name: 'user',
        content: {
          text: 'Grant access to myorg/myimage for 0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
        },
      },
      {
        name: 'assistant',
        content: { text: 'Granted access to myorg/myimage' },
      },
    ],
  ] as ActionExample[][],
}
