/** App lifecycle orchestrator for E2E tests */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { type Subprocess, spawn } from 'bun'
import { logger } from '../lib/logger'
import { discoverApps } from '../lib/testing'
import type { AppManifest } from '../types'

export interface AppStatus {
  name: string
  running: boolean
  port?: number
  url?: string
  healthy: boolean
}

export interface AppOrchestratorOptions {
  apps?: string[]
  skipWarmup?: boolean
  timeout?: number
}

export class AppOrchestrator {
  private rootDir: string
  private runningApps: Map<string, Subprocess> = new Map()
  private appManifests: Map<string, AppManifest> = new Map()
  private serviceEnv: Record<string, string>

  constructor(rootDir: string, serviceEnv: Record<string, string> = {}) {
    this.rootDir = rootDir
    this.serviceEnv = serviceEnv
  }

  async start(options: AppOrchestratorOptions = {}): Promise<void> {
    const apps = discoverApps(this.rootDir)
    const selectedApps = options.apps
    const appsToStart = selectedApps
      ? apps.filter((app) => selectedApps.includes(app.name))
      : apps.filter((app) => app.enabled !== false && app.autoStart !== false)

    if (appsToStart.length === 0) {
      logger.info('No apps to start')
      return
    }

    logger.step(`Starting ${appsToStart.length} app(s)...`)

    for (const app of appsToStart) {
      await this.startApp(app)
    }

    // Wait for all apps to be ready
    const timeout = options.timeout ?? 60000
    await this.waitForAppsReady(timeout)

    logger.success(`Started ${appsToStart.length} app(s)`)
  }

  private async startApp(app: AppManifest): Promise<void> {
    const appDir = join(this.rootDir, 'apps', app.name)
    if (!existsSync(appDir)) {
      logger.warn(`App directory not found: ${app.name}`)
      return
    }

    // For tests, prefer 'start' command which assumes infrastructure is already running
    // Fall back to 'dev' which manages its own infrastructure
    const command = app.commands?.start ?? app.commands?.dev
    if (!command) {
      logger.debug(`No start/dev command for ${app.name}`)
      return
    }

    const mainPort = app.ports?.main
    const rpcUrl = this.serviceEnv.L2_RPC_URL ?? this.serviceEnv.JEJU_RPC_URL
    if (!rpcUrl) {
      throw new Error(
        `No RPC URL configured for app ${app.name}. Set L2_RPC_URL or JEJU_RPC_URL in service environment.`,
      )
    }
    const appEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...this.serviceEnv,
      JEJU_RPC_URL: rpcUrl,
      RPC_URL: rpcUrl,
      CHAIN_ID: '31337',
    }

    if (mainPort) {
      appEnv.PORT = String(mainPort)
      appEnv.PUBLIC_PORT = String(mainPort)
    }

    const [cmd, ...args] = command.split(' ')
    const proc = spawn({
      cmd: [cmd, ...args],
      cwd: appDir,
      stdout: 'pipe',
      stderr: 'pipe',
      env: appEnv,
    })

    this.runningApps.set(app.name, proc)
    this.appManifests.set(app.name, app)

    logger.debug(`Started ${app.name} (PID: ${proc.pid})`)

    proc.exited.then((code) => {
      if (code !== 0) {
        logger.warn(`${app.name} exited with code ${code}`)
      }
      this.runningApps.delete(app.name)
    })
  }

  private async waitForAppsReady(timeout: number): Promise<void> {
    const startTime = Date.now()

    for (const [name, app] of this.appManifests) {
      const port = app.ports?.main ?? app.ports?.frontend
      if (!port) {
        logger.debug(`No port configured for ${name}, skipping wait`)
        continue
      }

      const url = `http://127.0.0.1:${port}`
      logger.debug(`Waiting for ${name} at ${url}...`)

      let ready = false
      while (Date.now() - startTime < timeout) {
        try {
          const response = await fetch(url, {
            signal: AbortSignal.timeout(3000),
          })
          // Accept any response - app is serving
          if (response.status < 500) {
            ready = true
            break
          }
        } catch {
          // App not ready yet
        }
        await new Promise((r) => setTimeout(r, 1000))
      }

      if (!ready) {
        throw new Error(
          `FATAL: App ${name} not ready at ${url} after ${timeout / 1000}s. ` +
            'The app failed to start or is not serving on the expected port.',
        )
      }

      logger.debug(`${name} is ready at ${url}`)
    }
  }

  async warmup(options: AppOrchestratorOptions = {}): Promise<void> {
    if (options.skipWarmup) {
      logger.debug('Skipping app warmup')
      return
    }

    logger.step('Warming up apps...')

    type WarmupModule = { quickWarmup: (apps: string[]) => Promise<void> }
    const warmupModule = (await import('@jejunetwork/tests/warmup').catch(
      () => null,
    )) as WarmupModule | null

    if (warmupModule) {
      await warmupModule.quickWarmup(options.apps ?? [])
      logger.success('Apps warmed up')
    } else {
      logger.debug('Warmup module not available, skipping')
    }
  }

  async stop(): Promise<void> {
    if (this.runningApps.size === 0) {
      return
    }

    logger.step(`Stopping ${this.runningApps.size} app(s)...`)

    for (const [name, proc] of this.runningApps) {
      proc.kill()
      logger.debug(`Stopped ${name}`)
    }

    this.runningApps.clear()
    logger.success('Apps stopped')
  }

  getEnvVars(): Record<string, string> {
    const env: Record<string, string> = { ...this.serviceEnv }

    for (const [name, app] of this.appManifests) {
      const port = app.ports?.main
      if (port) {
        env[`${name.toUpperCase()}_PORT`] = String(port)
        env[`${name.toUpperCase()}_URL`] = `http://127.0.0.1:${port}`
      }
    }

    return env
  }

  getStatus(): AppStatus[] {
    const statuses: AppStatus[] = []

    for (const [name, app] of this.appManifests) {
      const proc = this.runningApps.get(name)
      const port = app.ports?.main

      statuses.push({
        name,
        running: proc !== undefined && proc.exitCode === null,
        port,
        url: port ? `http://127.0.0.1:${port}` : undefined,
        healthy: proc !== undefined && proc.exitCode === null,
      })
    }

    return statuses
  }

  setServiceEnv(env: Record<string, string>): void {
    this.serviceEnv = { ...this.serviceEnv, ...env }
  }
}

export function createAppOrchestrator(
  rootDir: string,
  serviceEnv?: Record<string, string>,
): AppOrchestrator {
  return new AppOrchestrator(rootDir, serviceEnv)
}
