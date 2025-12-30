/**
 * ConfigMap-based persistence for deployed apps
 *
 * Stores app registrations in a Kubernetes ConfigMap for persistence
 * across pod restarts without requiring SQLit or any external database.
 *
 * This is preferred over SQLit-as-Kubernetes because:
 * - Simpler infrastructure (no additional pods)
 * - ConfigMaps are native Kubernetes resources
 * - SQLit's value is in decentralization, which K8s deployment defeats
 */

import { existsSync, readFileSync } from 'node:fs'

// ConfigMap configuration
const CONFIGMAP_NAME = 'dws-deployed-apps'
const CONFIGMAP_NAMESPACE = process.env.POD_NAMESPACE || 'dws'
const CONFIGMAP_KEY = 'apps.json'

// Kubernetes API access
const K8S_API_SERVER = 'https://kubernetes.default.svc'
const SERVICE_ACCOUNT_PATH = '/var/run/secrets/kubernetes.io/serviceaccount'

interface DeployedAppConfig {
  name: string
  jnsName: string
  frontendCid: string | null
  backendWorkerId: string | null
  backendEndpoint: string | null
  apiPaths: string[]
  spa: boolean
  enabled: boolean
  deployedAt: number
  updatedAt: number
}

/**
 * Check if running in Kubernetes
 */
function isRunningInKubernetes(): boolean {
  return existsSync(`${SERVICE_ACCOUNT_PATH}/token`)
}

/**
 * Get Kubernetes API headers with service account token
 */
function getK8sHeaders(): Record<string, string> {
  if (!isRunningInKubernetes()) {
    throw new Error('Not running in Kubernetes')
  }

  const token = readFileSync(`${SERVICE_ACCOUNT_PATH}/token`, 'utf-8')
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

/**
 * Get CA certificate for Kubernetes API
 */
function getK8sCaCert(): string | undefined {
  const caPath = `${SERVICE_ACCOUNT_PATH}/ca.crt`
  if (existsSync(caPath)) {
    return readFileSync(caPath, 'utf-8')
  }
  return undefined
}

/**
 * Load deployed apps from ConfigMap
 */
export async function loadAppsFromConfigMap(): Promise<DeployedAppConfig[]> {
  if (!isRunningInKubernetes()) {
    console.log(
      '[ConfigMap] Not running in Kubernetes, skipping ConfigMap load',
    )
    return []
  }

  const url = `${K8S_API_SERVER}/api/v1/namespaces/${CONFIGMAP_NAMESPACE}/configmaps/${CONFIGMAP_NAME}`

  const response = await fetch(url, {
    headers: getK8sHeaders(),
    tls: {
      ca: getK8sCaCert(),
    },
  })

  if (response.status === 404) {
    console.log('[ConfigMap] ConfigMap not found, will create on first save')
    return []
  }

  if (!response.ok) {
    const text = await response.text()
    console.log(
      `[ConfigMap] Failed to load ConfigMap: ${response.status} ${text}`,
    )
    return []
  }

  const configMap = (await response.json()) as {
    data?: Record<string, string>
  }

  if (!configMap.data?.[CONFIGMAP_KEY]) {
    console.log('[ConfigMap] ConfigMap exists but has no app data')
    return []
  }

  const apps = JSON.parse(configMap.data[CONFIGMAP_KEY]) as DeployedAppConfig[]
  console.log(`[ConfigMap] Loaded ${apps.length} apps from ConfigMap`)
  return apps
}

/**
 * Save deployed apps to ConfigMap
 */
export async function saveAppsToConfigMap(
  apps: DeployedAppConfig[],
): Promise<boolean> {
  if (!isRunningInKubernetes()) {
    console.log(
      '[ConfigMap] Not running in Kubernetes, skipping ConfigMap save',
    )
    return false
  }

  const configMapData = {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: {
      name: CONFIGMAP_NAME,
      namespace: CONFIGMAP_NAMESPACE,
      labels: {
        'app.kubernetes.io/name': 'dws',
        'app.kubernetes.io/component': 'deployed-apps',
      },
    },
    data: {
      [CONFIGMAP_KEY]: JSON.stringify(apps, null, 2),
    },
  }

  // Try to update existing ConfigMap first
  const updateUrl = `${K8S_API_SERVER}/api/v1/namespaces/${CONFIGMAP_NAMESPACE}/configmaps/${CONFIGMAP_NAME}`

  let response = await fetch(updateUrl, {
    method: 'PUT',
    headers: getK8sHeaders(),
    body: JSON.stringify(configMapData),
    tls: {
      ca: getK8sCaCert(),
    },
  })

  // If ConfigMap doesn't exist, create it
  if (response.status === 404) {
    const createUrl = `${K8S_API_SERVER}/api/v1/namespaces/${CONFIGMAP_NAMESPACE}/configmaps`
    response = await fetch(createUrl, {
      method: 'POST',
      headers: getK8sHeaders(),
      body: JSON.stringify(configMapData),
      tls: {
        ca: getK8sCaCert(),
      },
    })
  }

  if (!response.ok) {
    const text = await response.text()
    console.log(
      `[ConfigMap] Failed to save ConfigMap: ${response.status} ${text}`,
    )
    return false
  }

  console.log(`[ConfigMap] Saved ${apps.length} apps to ConfigMap`)
  return true
}

/**
 * Check if ConfigMap persistence is available
 */
export function isConfigMapAvailable(): boolean {
  return isRunningInKubernetes()
}
