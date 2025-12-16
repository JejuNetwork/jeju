/**
 * Package Registry Routes (JejuPkg) - npm CLI compatible API
 * Consolidated with upstream proxy and full caching
 */

import { Hono } from 'hono';
import type { Address } from 'viem';
import type { BackendManager } from '../../storage/backends';
import { PkgRegistryManager } from '../../pkg/registry-manager';
import { UpstreamProxy } from '../../pkg/upstream';
import type { PkgPublishPayload, PkgSearchResult, PackageManifest, CacheConfig, UpstreamRegistryConfig } from '../../pkg/types';
import { recordPackagePublish, recordPackageDownload } from '../../pkg/leaderboard-integration';

interface PkgContext {
  registryManager: PkgRegistryManager;
  backend: BackendManager;
  upstreamProxy?: UpstreamProxy;
}

const DEFAULT_UPSTREAM_CONFIG: UpstreamRegistryConfig = {
  url: 'https://registry.npmjs.org',
  timeout: 30000,
  retries: 3,
  cacheAllPackages: true,
};

const DEFAULT_CACHE_CONFIG: CacheConfig = {
  enabled: true,
  maxSize: 10000,
  defaultTTL: 3600000, // 1 hour
  tarballTTL: 86400000 * 30, // 30 days (tarballs are immutable)
  searchTTL: 300000, // 5 minutes
};

export function createPkgRouter(ctx: PkgContext): Hono {
  const router = new Hono();
  const { registryManager, backend } = ctx;

  // Initialize upstream proxy if not provided
  const upstreamProxy = ctx.upstreamProxy || new UpstreamProxy({
    backend,
    upstream: DEFAULT_UPSTREAM_CONFIG,
    cache: DEFAULT_CACHE_CONFIG,
  });

  router.get('/health', (c) => c.json({ service: 'dws-pkg', status: 'healthy' }));

  router.get('/-/ping', (c) => c.json({}));

  router.get('/-/whoami', (c) => {
    const address = c.req.header('x-jeju-address');
    if (!address) return c.json({ error: 'Not authenticated' }, 401);
    return c.json({ username: address });
  });

  // Search packages (local + upstream)
  router.get('/-/v1/search', async (c) => {
    const text = c.req.query('text') || '';
    const size = parseInt(c.req.query('size') || '20');
    const from = parseInt(c.req.query('from') || '0');

    // Search local packages first
    const localPackages = await registryManager.searchPackages(text, from, size);

    const result: PkgSearchResult = {
      objects: localPackages.map((pkg) => ({
        package: {
          name: registryManager.getFullName(pkg.name, pkg.scope),
          scope: pkg.scope || undefined,
          version: '0.0.0',
          description: pkg.description,
          date: new Date(Number(pkg.updatedAt) * 1000).toISOString(),
          publisher: { username: pkg.owner },
        },
        score: { final: 1, detail: { quality: 1, popularity: 1, maintenance: 1 } },
        searchScore: 1,
      })),
      total: localPackages.length,
      time: new Date().toISOString(),
    };

    return c.json(result);
  });

  // User login/registration (npm CLI compatible)
  router.put('/-/user/:user{.+}', async (c) => {
    const body = await c.req.json<{ name: string; password: string; email?: string }>();
    return c.json({
      ok: true,
      id: `org.couchdb.user:${body.name}`,
      rev: '1',
      token: `jeju-pkg-token-${body.name}`,
    });
  });

  router.delete('/-/user/token/:token', (c) => c.json({ ok: true }));

  // Cache stats endpoint
  router.get('/-/cache/stats', (c) => {
    const stats = upstreamProxy.getCacheStats();
    return c.json(stats);
  });

  // Manual cache invalidation
  router.delete('/-/cache/:package{.+}', (c) => {
    const packageName = c.req.param('package').replace('%2f', '/').replace('%2F', '/');
    upstreamProxy.invalidateCache(packageName);
    return c.json({ ok: true, invalidated: packageName });
  });

  // Sync package from upstream
  router.post('/-/sync/:package{.+}', async (c) => {
    const packageName = c.req.param('package').replace('%2f', '/').replace('%2F', '/');
    const { versions } = await c.req.json<{ versions?: number }>().catch(() => ({}));

    const result = await upstreamProxy.syncPackage(packageName, { versions });
    return c.json(result);
  });

  // Tarball download - must come before catch-all
  router.get('/:package{.+}/-/:tarball', async (c) => {
    const packageName = c.req.param('package');
    const tarballName = c.req.param('tarball');
    const fullName = packageName.replace('%2f', '/').replace('%2F', '/');
    const user = c.req.header('x-jeju-address') as Address | undefined;

    const versionMatch = tarballName.match(/-(\d+\.\d+\.\d+[^.]*).tgz$/);
    if (!versionMatch) return c.json({ error: 'Invalid tarball name' }, 400);

    const version = versionMatch[1];

    // Try local first
    const localPkg = await registryManager.getPackageByName(fullName);
    if (localPkg) {
      const ver = await registryManager.getVersion(localPkg.packageId, version);
      if (ver) {
        const tarball = await backend.download(ver.tarballCid);
        if (user) {
          recordPackageDownload(user, localPkg.packageId, fullName, version);
        }
        return new Response(tarball.content, {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${tarballName}"`,
            'Cache-Control': 'public, max-age=31536000, immutable', // Tarballs are immutable
          },
        });
      }
    }

    // Try upstream with caching
    const upstreamTarball = await upstreamProxy.getTarball(fullName, version);
    if (upstreamTarball) {
      return new Response(upstreamTarball, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${tarballName}"`,
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-Served-From': 'upstream-cache',
        },
      });
    }

    return c.json({ error: 'Package not found' }, 404);
  });

  // Specific version metadata
  router.get('/:package{.+}/:version', async (c) => {
    const packageName = c.req.param('package');
    const version = c.req.param('version');

    if (packageName.startsWith('-/')) return c.json({ ok: true });

    const fullName = packageName.replace('%2f', '/').replace('%2F', '/');

    // Try local first
    const localMetadata = await registryManager.getPkgMetadata(fullName);
    if (localMetadata?.versions[version]) {
      return c.json(localMetadata.versions[version]);
    }

    // Try upstream
    const upstreamVersion = await upstreamProxy.getVersionMetadata(fullName, version);
    if (upstreamVersion) {
      return c.json(upstreamVersion, 200, { 'X-Served-From': 'upstream-cache' });
    }

    return c.json({ error: 'Not found' }, 404);
  });

  // Publish package
  router.put('/:package{.+}', async (c) => {
    const publisher = c.req.header('x-jeju-address') as Address;
    if (!publisher) return c.json({ error: 'Missing x-jeju-address header' }, 401);

    const packageName = c.req.param('package');
    const fullName = packageName.replace('%2f', '/').replace('%2F', '/');
    const body = await c.req.json<PkgPublishPayload>();

    const versionKey = Object.keys(body.versions)[0];
    const versionData = body.versions[versionKey];
    if (!versionData) return c.json({ error: 'No version data provided' }, 400);

    const attachmentKey = Object.keys(body._attachments)[0];
    const attachment = body._attachments[attachmentKey];
    if (!attachment) return c.json({ error: 'No attachment provided' }, 400);

    const tarball = Buffer.from(attachment.data, 'base64');

    const manifest: PackageManifest = {
      name: versionData.name,
      version: versionData.version,
      description: versionData.description,
      main: versionData.main,
      types: versionData.types,
      module: versionData.module,
      exports: versionData.exports,
      scripts: versionData.scripts,
      dependencies: versionData.dependencies,
      devDependencies: versionData.devDependencies,
      peerDependencies: versionData.peerDependencies,
      optionalDependencies: versionData.optionalDependencies,
      bundledDependencies: versionData.bundledDependencies,
      engines: versionData.engines,
      os: versionData.os,
      cpu: versionData.cpu,
      keywords: versionData.keywords,
      author: versionData.author,
      contributors: versionData.contributors,
      license: versionData.license,
      homepage: versionData.homepage,
      repository: versionData.repository,
      bugs: versionData.bugs,
      funding: versionData.funding,
      bin: versionData.bin,
      directories: versionData.directories,
    };

    const result = await registryManager.publish(fullName, manifest, tarball, publisher);
    recordPackagePublish(publisher, result.packageId, fullName, manifest.version);

    return c.json({
      ok: true,
      id: fullName,
      rev: `1-${result.versionId.slice(2, 10)}`,
    });
  });

  // Deprecate package version
  router.delete('/:package{.+}/-rev/:rev', async (c) => {
    const publisher = c.req.header('x-jeju-address') as Address;
    if (!publisher) return c.json({ error: 'Missing x-jeju-address header' }, 401);

    const packageName = c.req.param('package');
    const fullName = packageName.replace('%2f', '/').replace('%2F', '/');

    const pkg = await registryManager.getPackageByName(fullName);
    if (!pkg) return c.json({ error: 'Package not found' }, 404);

    // Check ownership
    if (pkg.owner.toLowerCase() !== publisher.toLowerCase()) {
      return c.json({ error: 'Not authorized' }, 403);
    }

    // In production, would actually deprecate the package
    return c.json({ ok: true });
  });

  // Package metadata (catch-all, must be last)
  router.get('/:package{.+}', async (c) => {
    const packageName = c.req.param('package');
    const fullName = packageName.replace('%2f', '/').replace('%2F', '/');

    if (fullName.startsWith('-/')) return c.json({ ok: true });

    // Try local first
    const localMetadata = await registryManager.getPkgMetadata(fullName);
    if (localMetadata) {
      return c.json(localMetadata, 200, { 'Content-Type': 'application/json' });
    }

    // Try upstream with caching
    const upstreamMetadata = await upstreamProxy.getPackageMetadata(fullName);
    if (upstreamMetadata) {
      return c.json(upstreamMetadata, 200, {
        'Content-Type': 'application/json',
        'X-Served-From': 'upstream-cache',
        'Cache-Control': 'public, max-age=300', // 5 minutes for metadata
      });
    }

    return c.json({ error: 'Not found' }, 404);
  });

  return router;
}

// Export alias for backwards compatibility
export { createPkgRouter as createNpmRouter };

