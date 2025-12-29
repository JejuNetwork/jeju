/**
 * Monitoring stack integration tests for Prometheus and Grafana.
 *
 * These tests REQUIRE the monitoring stack to be running.
 * They will FAIL (not skip) if services are unavailable.
 *
 * Run with: jeju test --mode integration --app monitoring
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { $ } from 'bun'
import { z } from 'zod'
import {
  GrafanaDataSourceSchema,
  GrafanaHealthSchema,
  PrometheusTargetsResponseSchema,
} from '../../lib/types'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const GRAFANA_PORT = parseInt(process.env.GRAFANA_PORT || '4010', 10)
const PROMETHEUS_PORT = parseInt(process.env.PROMETHEUS_PORT || '9090', 10)

let monitoringStarted = false

async function checkService(url: string, timeout = 2000): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)
    const response = await fetch(url, { signal: controller.signal })
    clearTimeout(timeoutId)
    return response.ok
  } catch {
    return false
  }
}

async function requireMonitoringStack(): Promise<void> {
  const monitoringDir = path.resolve(__dirname, '../..')
  const dockerComposePath = path.join(monitoringDir, 'docker-compose.yml')

  if (!fs.existsSync(dockerComposePath)) {
    throw new Error(
      `FATAL: docker-compose.yml not found at ${dockerComposePath}. ` +
        `Cannot run monitoring integration tests without docker-compose configuration.`,
    )
  }

  const grafanaRunning = await checkService(
    `http://localhost:${GRAFANA_PORT}/api/health`,
  )
  const prometheusRunning = await checkService(
    `http://localhost:${PROMETHEUS_PORT}/api/v1/targets`,
  )

  if (grafanaRunning && prometheusRunning) {
    console.log('Monitoring stack already running')
    return
  }

  console.log('Starting monitoring stack (Prometheus & Grafana)...')

  try {
    await $`cd ${monitoringDir} && docker compose up -d`.quiet()
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes('command not found') || msg.includes('not found')) {
      throw new Error(
        `FATAL: docker-compose not found. Install docker-compose or run tests in a Docker environment.`,
      )
    }
    throw new Error(`FATAL: Failed to start monitoring stack: ${msg}`)
  }
  console.log('Waiting for services to start...')

  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000))

    const grafanaReady = await checkService(
      `http://localhost:${GRAFANA_PORT}/api/health`,
    )
    const prometheusReady = await checkService(
      `http://localhost:${PROMETHEUS_PORT}/api/v1/targets`,
    )

    if (grafanaReady && prometheusReady) {
      console.log('Monitoring stack started successfully')
      monitoringStarted = true
      return
    }
  }

  throw new Error(
    `FATAL: Monitoring stack did not start within 30 seconds. ` +
      `Grafana: http://localhost:${GRAFANA_PORT}, ` +
      `Prometheus: http://localhost:${PROMETHEUS_PORT}. ` +
      `Check docker logs for errors.`,
  )
}

beforeAll(async () => {
  await requireMonitoringStack()
}, 60000)

afterAll(async () => {
  if (monitoringStarted && process.env.CI !== 'true') {
    console.log('Stopping monitoring stack...')
    const monitoringDir = path.join(__dirname, '../..')
    await $`cd ${monitoringDir} && docker compose down`.quiet()
  }
})

describe('Monitoring Stack', () => {
  test('should access Grafana login page', async () => {
    const response = await fetch(`http://localhost:${GRAFANA_PORT}/login`)
    expect(response.ok).toBe(true)

    const html = await response.text()
    expect(html.length).toBeGreaterThan(0)
    expect(html).toContain('Grafana')
  })

  test('should access Prometheus targets page', async () => {
    const response = await fetch(
      `http://localhost:${PROMETHEUS_PORT}/api/v1/targets`,
    )
    expect(response.ok).toBe(true)

    const text = await response.text()
    expect(text.length).toBeGreaterThan(0)

    const data = PrometheusTargetsResponseSchema.parse(JSON.parse(text))
    expect(data.status).toBe('success')
    expect(data.data).toBeDefined()
  })

  test('should verify Prometheus is scraping some targets', async () => {
    const response = await fetch(
      `http://localhost:${PROMETHEUS_PORT}/api/v1/targets`,
    )
    expect(response.ok).toBe(true)

    const text = await response.text()
    const data = PrometheusTargetsResponseSchema.parse(JSON.parse(text))

    console.log(`Found ${data.data.activeTargets.length} active targets`)
    expect(Array.isArray(data.data.activeTargets)).toBe(true)
  })

  test('should access Grafana API health', async () => {
    const response = await fetch(`http://localhost:${GRAFANA_PORT}/api/health`)
    expect(response.ok).toBe(true)

    const text = await response.text()
    const health = GrafanaHealthSchema.parse(JSON.parse(text))
    expect(health.database).toBe('ok')
  })

  test('should list Grafana datasources', async () => {
    const auth = Buffer.from('admin:admin').toString('base64')
    const response = await fetch(
      `http://localhost:${GRAFANA_PORT}/api/datasources`,
      {
        headers: { Authorization: `Basic ${auth}` },
      },
    )
    expect(response.ok).toBe(true)

    const text = await response.text()
    const datasources = z.array(GrafanaDataSourceSchema).parse(JSON.parse(text))
    expect(Array.isArray(datasources)).toBe(true)
    console.log(`Found ${datasources.length} datasources`)
  })

  test('should verify dashboard files exist', () => {
    const monitoringDir = path.join(__dirname, '../..')
    const dashboardDir = path.join(monitoringDir, 'config/grafana/dashboards')

    expect(fs.existsSync(dashboardDir)).toBe(true)

    const dashboards = fs
      .readdirSync(dashboardDir)
      .filter((f: string) => f.endsWith('.json'))
    console.log(`Found ${dashboards.length} dashboard files`)
    expect(dashboards.length).toBeGreaterThan(0)

    for (const dashboard of dashboards) {
      const content = fs.readFileSync(
        path.join(dashboardDir, dashboard),
        'utf-8',
      )
      expect(() => JSON.parse(content)).not.toThrow()
    }
    console.log('All dashboards have valid JSON')
  })
})
