/**
 * App Orchestrator
 *
 * Manages app lifecycle for E2E tests:
 * - Start/stop apps
 * - App warmup (pre-compile pages)
 * - Health checks
 * - Environment variable injection
 */

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

    logger.success(`Started ${appsToStart.length} app(s)`)
  }

  private async startApp(app: AppManifest): Promise<void> {
    const appDir = join(this.rootDir, 'apps', app.name)
    if (!existsSync(appDir)) {
      logger.warn(`App directory not found: ${app.name}`)
      return
    }

    const devCommand = app.commands?.dev
    if (!devCommand) {
      logger.debug(`No dev command for ${app.name}`)
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
      CHAIN_ID: '1337',
    }

    if (mainPort) {
      appEnv.PORT = String(mainPort)
      appEnv.VITE_PORT = String(mainPort)
    }

    const [cmd, ...args] = devCommand.split(' ')
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

  async warmup(options: AppOrchestratorOptions = {}): Promise<void> {
    if (options.skipWarmup) {
      logger.debug('Skipping app warmup')
      return
    }

    logger.step('Warming up apps...')

    // Optional dependency - warmup is non-critical, skip if unavailable
    // Dynamic import: optional dependency that may not be available
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
