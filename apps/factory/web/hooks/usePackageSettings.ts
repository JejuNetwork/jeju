import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

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
  token: string
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

// Browser-only hook - API is same origin
const API_BASE = ''

async function fetchApi<T>(
  path: string,
  options?: RequestInit,
): Promise<T | null> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  if (!response.ok) {
    return null
  }

  return response.json()
}

async function fetchPackageSettings(
  scope: string,
  name: string,
): Promise<PackageSettings | null> {
  return fetchApi<PackageSettings>(`/api/packages/${scope}/${name}/settings`)
}

async function updatePackageSettings(
  scope: string,
  name: string,
  settings: Partial<PackageSettings>,
): Promise<boolean> {
  const response = await fetchApi(`/api/packages/${scope}/${name}/settings`, {
    method: 'PATCH',
    body: JSON.stringify(settings),
  })
  return response !== null
}

async function addMaintainer(
  scope: string,
  name: string,
  data: { login: string; role: 'owner' | 'maintainer' },
): Promise<boolean> {
  const response = await fetchApi(
    `/api/packages/${scope}/${name}/settings/maintainers`,
    {
      method: 'POST',
      body: JSON.stringify(data),
    },
  )
  return response !== null
}

async function removeMaintainer(
  scope: string,
  name: string,
  login: string,
): Promise<boolean> {
  const response = await fetchApi(
    `/api/packages/${scope}/${name}/settings/maintainers/${login}`,
    { method: 'DELETE' },
  )
  return response !== null
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
  return fetchApi<PackageAccessToken>(
    `/api/packages/${scope}/${name}/settings/tokens`,
    {
      method: 'POST',
      body: JSON.stringify(data),
    },
  )
}

async function revokeAccessToken(
  scope: string,
  name: string,
  tokenId: string,
): Promise<boolean> {
  const response = await fetchApi(
    `/api/packages/${scope}/${name}/settings/tokens/${tokenId}`,
    { method: 'DELETE' },
  )
  return response !== null
}

async function deprecatePackage(
  scope: string,
  name: string,
  message: string,
): Promise<boolean> {
  const response = await fetchApi(
    `/api/packages/${scope}/${name}/settings/deprecate`,
    {
      method: 'POST',
      body: JSON.stringify({ message }),
    },
  )
  return response !== null
}

async function undeprecatePackage(
  scope: string,
  name: string,
): Promise<boolean> {
  const response = await fetchApi(
    `/api/packages/${scope}/${name}/settings/undeprecate`,
    { method: 'POST' },
  )
  return response !== null
}

async function unpublishPackage(
  _scope: string,
  _name: string,
  _version?: string,
): Promise<boolean> {
  // Unpublish would need separate endpoint
  return false
}

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
