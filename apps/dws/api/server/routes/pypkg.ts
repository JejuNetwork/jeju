/**
 * Python Package Registry Routes (JejuPyPkg) - pip/twine compatible API
 * Similar to PyPI's Simple API (PEP 503/PEP 691)
 */

import { createHash } from 'node:crypto'
import { Elysia, t } from 'elysia'
import type { Address } from 'viem'
import type { PkgRegistryManager } from '../../pkg/registry-manager'
import type { BackendManager } from '../../storage/backends'

interface PyPkgContext {
  registryManager: PkgRegistryManager
  backend: BackendManager
}

interface PythonPackage {
  name: string
  version: string
  summary: string
  author: string
  authorEmail: string
  license: string
  homepage: string
  requiresPython: string
  keywords: string[]
  classifiers: string[]
  requiresDist: string[]
  projectUrls: Record<string, string>
  wheelData: Buffer
  wheelFilename: string
  publisher: Address
  publishedAt: Date
}

// In-memory store for Python packages (should be backed by EQLite in production)
const pythonPackages = new Map<string, Map<string, PythonPackage>>()

function normalizePackageName(name: string): string {
  // PEP 503: normalize package names
  return name.toLowerCase().replace(/[-_.]+/g, '-')
}

function computeSha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

export function createPyPkgRouter(ctx: PyPkgContext) {
  const { backend } = ctx

  return (
    new Elysia({ name: 'pypkg', prefix: '/pypkg' })

      // Health check
      .get('/health', () => ({ service: 'dws-pypkg', status: 'healthy' }))

      // Simple API root (PEP 503)
      .get('/simple/', () => {
        const packages = Array.from(pythonPackages.keys()).sort()
        const links = packages
          .map((name) => `<a href="/pypkg/simple/${name}/">${name}</a>`)
          .join('\n')

        return new Response(
          `<!DOCTYPE html>
<html>
  <head>
    <meta name="pypi:repository-version" content="1.0">
    <title>JejuPyPkg Simple Index</title>
  </head>
  <body>
    <h1>JejuPyPkg Simple Index</h1>
${links}
  </body>
</html>`,
          {
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
            },
          },
        )
      })

      // Package index (PEP 503)
      .get(
        '/simple/:package/',
        ({ params }) => {
          const normalizedName = normalizePackageName(params.package)
          const packageVersions = pythonPackages.get(normalizedName)

          if (!packageVersions) {
            return new Response('Not found', { status: 404 })
          }

          const links = Array.from(packageVersions.entries())
            .map(([_version, pkg]) => {
              const hash = computeSha256(pkg.wheelData)
              return `<a href="/pypkg/packages/${pkg.wheelFilename}#sha256=${hash}" data-requires-python="${pkg.requiresPython}">${pkg.wheelFilename}</a>`
            })
            .join('\n')

          return new Response(
            `<!DOCTYPE html>
<html>
  <head>
    <meta name="pypi:repository-version" content="1.0">
    <title>Links for ${normalizedName}</title>
  </head>
  <body>
    <h1>Links for ${normalizedName}</h1>
${links}
  </body>
</html>`,
            {
              headers: {
                'Content-Type': 'text/html; charset=utf-8',
              },
            },
          )
        },
        {
          params: t.Object({
            package: t.String(),
          }),
        },
      )

      // JSON API (PEP 691)
      .get(
        '/pypi/:package/json',
        ({ params }) => {
          const normalizedName = normalizePackageName(params.package)
          const packageVersions = pythonPackages.get(normalizedName)

          if (!packageVersions) {
            return new Response('Not found', { status: 404 })
          }

          const versions = Array.from(packageVersions.keys()).sort()
          const latestVersion = versions[versions.length - 1]
          const latest = packageVersions.get(latestVersion)

          if (!latest) {
            return new Response('Not found', { status: 404 })
          }

          const releases: Record<
            string,
            Array<{
              filename: string
              url: string
              digests: { sha256: string }
              requires_python: string
              size: number
            }>
          > = {}

          for (const [version, pkg] of packageVersions) {
            releases[version] = [
              {
                filename: pkg.wheelFilename,
                url: `/pypkg/packages/${pkg.wheelFilename}`,
                digests: { sha256: computeSha256(pkg.wheelData) },
                requires_python: pkg.requiresPython,
                size: pkg.wheelData.length,
              },
            ]
          }

          return {
            info: {
              name: latest.name,
              version: latestVersion,
              summary: latest.summary,
              author: latest.author,
              author_email: latest.authorEmail,
              license: latest.license,
              home_page: latest.homepage,
              requires_python: latest.requiresPython,
              keywords: latest.keywords.join(','),
              classifiers: latest.classifiers,
              requires_dist: latest.requiresDist,
              project_urls: latest.projectUrls,
            },
            releases,
            urls: releases[latestVersion],
          }
        },
        {
          params: t.Object({
            package: t.String(),
          }),
        },
      )

      // Download package wheel
      .get(
        '/packages/:filename',
        ({ params }) => {
          // Find package by filename
          for (const versions of pythonPackages.values()) {
            for (const pkg of versions.values()) {
              if (pkg.wheelFilename === params.filename) {
                return new Response(new Uint8Array(pkg.wheelData), {
                  headers: {
                    'Content-Type': 'application/zip',
                    'Content-Disposition': `attachment; filename="${pkg.wheelFilename}"`,
                  },
                })
              }
            }
          }
          return new Response('Not found', { status: 404 })
        },
        {
          params: t.Object({
            filename: t.String(),
          }),
        },
      )

      // Upload package (twine compatible)
      .post(
        '/upload',
        async ({ request, headers, set }) => {
          const publisher = headers['x-jeju-address']
          if (!publisher) {
            set.status = 401
            return { error: 'Missing x-jeju-address header' }
          }

          const formData = await request.formData()

          // Parse metadata
          const name = formData.get('name') as string
          const version = formData.get('version') as string
          const content = formData.get('content') as File

          if (!name || !version || !content) {
            set.status = 400
            return { error: 'Missing required fields: name, version, content' }
          }

          const normalizedName = normalizePackageName(name)
          const wheelData = Buffer.from(await content.arrayBuffer())

          const pkg: PythonPackage = {
            name: normalizedName,
            version,
            summary: (formData.get('summary') as string) ?? '',
            author: (formData.get('author') as string) ?? '',
            authorEmail: (formData.get('author_email') as string) ?? '',
            license: (formData.get('license') as string) ?? '',
            homepage: (formData.get('home_page') as string) ?? '',
            requiresPython:
              (formData.get('requires_python') as string) ?? '>=3.8',
            keywords: ((formData.get('keywords') as string) ?? '')
              .split(',')
              .filter(Boolean),
            classifiers: formData.getAll('classifiers') as string[],
            requiresDist: formData.getAll('requires_dist') as string[],
            projectUrls: {},
            wheelData,
            wheelFilename:
              content.name || `${normalizedName}-${version}-py3-none-any.whl`,
            publisher: publisher as Address,
            publishedAt: new Date(),
          }

          // Store package
          let versions = pythonPackages.get(normalizedName)
          if (!versions) {
            versions = new Map()
            pythonPackages.set(normalizedName, versions)
          }

          if (versions.has(version)) {
            set.status = 409
            return { error: `Version ${version} already exists` }
          }

          versions.set(version, pkg)

          // Also store in backend if available
          try {
            const result = await backend.upload(wheelData)
            return {
              ok: true,
              package: normalizedName,
              version,
              cid: result.cid,
              size: wheelData.length,
              sha256: computeSha256(wheelData),
            }
          } catch {
            // Backend storage optional
            return {
              ok: true,
              package: normalizedName,
              version,
              size: wheelData.length,
              sha256: computeSha256(wheelData),
            }
          }
        },
        {
          headers: t.Object({
            'x-jeju-address': t.Optional(t.String()),
          }),
        },
      )

      // Search packages
      .get(
        '/search',
        ({ query }) => {
          const term = (query.q ?? '').toLowerCase()
          const results: Array<{
            name: string
            version: string
            summary: string
          }> = []

          for (const [name, versions] of pythonPackages) {
            if (name.includes(term)) {
              const versionList = Array.from(versions.keys()).sort()
              const latest = versions.get(versionList[versionList.length - 1])
              if (latest) {
                results.push({
                  name: latest.name,
                  version: latest.version,
                  summary: latest.summary,
                })
              }
            }
          }

          return { results, total: results.length }
        },
        {
          query: t.Object({
            q: t.Optional(t.String()),
          }),
        },
      )

      // List all packages
      .get('/packages', () => {
        const packages: Array<{
          name: string
          versions: string[]
          latestVersion: string
        }> = []

        for (const [name, versions] of pythonPackages) {
          const versionList = Array.from(versions.keys()).sort()
          packages.push({
            name,
            versions: versionList,
            latestVersion: versionList[versionList.length - 1],
          })
        }

        return { packages, total: packages.length }
      })
  )
}

export type PyPkgRoutes = ReturnType<typeof createPyPkgRouter>
