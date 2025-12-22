import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getDwsUrl } from '../config/contracts'

// ============ Types ============

export interface PackageWebhook {
  id: string
  url: string
  events: ('publish' | 'unpublish' | 'download')[]
  active: boolean
  createdAt: number
}

export interface PackageAccessToken {
  id: string
  name: string
  token: string // Only shown on creation
  permissions: ('read' | 'write' | 'delete')[]
  createdAt: number
  expiresAt?: number
  lastUsed?: number
}

export interface PackageMaintainer {
  login: string
  avatar: string
  role: 'owner' | 'maintainer'
}

export interface PackageSettings {
  scope: string
  name: string
  description: string
  visibility: 'public' | 'private'
  maintainers: PackageMaintainer[]
  webhooks: PackageWebhook[]
  downloadCount: number
  publishEnabled: boolean
  deprecated: boolean
  deprecationMessage?: string
}

// ============ Fetchers ============

async function fetchPackageSettings(
  scope: string,
  name: string,
): Promise<PackageSettings | null> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(`${dwsUrl}/api/packages/${scope}/${name}/settings`)
  if (!res.ok) return null
  return res.json()
}

async function updatePackageSettings(
  scope: string,
  name: string,
  settings: Partial<PackageSettings>,
): Promise<boolean> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(`${dwsUrl}/api/packages/${scope}/${name}/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
  return res.ok
}

async function addMaintainer(
  scope: string,
  name: string,
  data: { login: string; role: 'owner' | 'maintainer' },
): Promise<boolean> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(
    `${dwsUrl}/api/packages/${scope}/${name}/maintainers`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    },
  )
  return res.ok
}

async function removeMaintainer(
  scope: string,
  name: string,
  login: string,
): Promise<boolean> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(
    `${dwsUrl}/api/packages/${scope}/${name}/maintainers/${login}`,
    {
      method: 'DELETE',
    },
  )
  return res.ok
}

async function createAccessToken(
  scope: string,
  name: string,
  data: {
    name: string
    permissions: ('read' | 'write' | 'delete')[]
    expiresIn?: number
  },
): Promise<PackageAccessToken | null> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(`${dwsUrl}/api/packages/${scope}/${name}/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) return null
  return res.json()
}

async function revokeAccessToken(
  scope: string,
  name: string,
  tokenId: string,
): Promise<boolean> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(
    `${dwsUrl}/api/packages/${scope}/${name}/tokens/${tokenId}`,
    {
      method: 'DELETE',
    },
  )
  return res.ok
}

async function deprecatePackage(
  scope: string,
  name: string,
  message: string,
): Promise<boolean> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(`${dwsUrl}/api/packages/${scope}/${name}/deprecate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  })
  return res.ok
}

async function undeprecatePackage(
  scope: string,
  name: string,
): Promise<boolean> {
  const dwsUrl = getDwsUrl()
  const res = await fetch(
    `${dwsUrl}/api/packages/${scope}/${name}/undeprecate`,
    {
      method: 'POST',
    },
  )
  return res.ok
}

async function unpublishPackage(
  scope: string,
  name: string,
  version?: string,
): Promise<boolean> {
  const dwsUrl = getDwsUrl()
  const url = version
    ? `${dwsUrl}/api/packages/${scope}/${name}/versions/${version}`
    : `${dwsUrl}/api/packages/${scope}/${name}`
  const res = await fetch(url, { method: 'DELETE' })
  return res.ok
}

// ============ Hooks ============

export function usePackageSettings(scope: string, name: string) {
  const {
    data: settings,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['packageSettings', scope, name],
    queryFn: () => fetchPackageSettings(scope, name),
    enabled: !!scope && !!name,
    staleTime: 60000,
  })

  return {
    settings,
    isLoading,
    error,
    refetch,
  }
}

export function useUpdatePackageSettings(scope: string, name: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (settings: Partial<PackageSettings>) =>
      updatePackageSettings(scope, name, settings),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['packageSettings', scope, name],
      })
      queryClient.invalidateQueries({ queryKey: ['package', scope, name] })
    },
  })
}

export function useAddMaintainer(scope: string, name: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: { login: string; role: 'owner' | 'maintainer' }) =>
      addMaintainer(scope, name, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['packageSettings', scope, name],
      })
    },
  })
}

export function useRemoveMaintainer(scope: string, name: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (login: string) => removeMaintainer(scope, name, login),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['packageSettings', scope, name],
      })
    },
  })
}

export function useCreateAccessToken(scope: string, name: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: {
      name: string
      permissions: ('read' | 'write' | 'delete')[]
      expiresIn?: number
    }) => createAccessToken(scope, name, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['packageSettings', scope, name],
      })
    },
  })
}

export function useRevokeAccessToken(scope: string, name: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (tokenId: string) => revokeAccessToken(scope, name, tokenId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['packageSettings', scope, name],
      })
    },
  })
}

export function useDeprecatePackage(scope: string, name: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (message: string) => deprecatePackage(scope, name, message),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['packageSettings', scope, name],
      })
      queryClient.invalidateQueries({ queryKey: ['package', scope, name] })
    },
  })
}

export function useUndeprecatePackage(scope: string, name: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => undeprecatePackage(scope, name),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['packageSettings', scope, name],
      })
      queryClient.invalidateQueries({ queryKey: ['package', scope, name] })
    },
  })
}

export function useUnpublishPackage(scope: string, name: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (version?: string) => unpublishPackage(scope, name, version),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['packages'] })
      queryClient.invalidateQueries({ queryKey: ['package', scope, name] })
    },
  })
}
