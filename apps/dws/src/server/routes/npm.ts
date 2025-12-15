/**
 * NPM Registry Routes
 * Implements NPM Registry API for npm CLI compatibility
 */

import { Hono } from 'hono';
import type { Address } from 'viem';
import type { BackendManager } from '../../storage/backends';
import { NpmRegistryManager } from '../../npm/registry-manager';
import type { NpmPublishPayload, NpmSearchResult, PackageManifest } from '../../npm/types';
import { recordPackagePublish } from '../../npm/leaderboard-integration';

interface NpmContext {
  registryManager: NpmRegistryManager;
  backend: BackendManager;
}

export function createNpmRouter(ctx: NpmContext): Hono {
  const router = new Hono();
  const { registryManager } = ctx;

  // ============ Health Check ============

  router.get('/health', (c) => {
    return c.json({ service: 'dws-npm', status: 'healthy' });
  });

  // ============ NPM Registry API ============

  /**
   * GET /:package - Get package metadata
   * npm CLI calls this to get package info before install
   */
  router.get('/:package{.+}', async (c) => {
    const packageName = c.req.param('package');

    // Handle scoped packages (@scope/name)
    const fullName = packageName.replace('%2f', '/').replace('%2F', '/');

    // Skip internal npm paths
    if (fullName.startsWith('-/') || fullName === 'ping') {
      return c.json({ ok: true });
    }

    const metadata = await registryManager.getNpmMetadata(fullName);

    if (!metadata) {
      return c.json({ error: 'Not found' }, 404);
    }

    return c.json(metadata, 200, {
      'Content-Type': 'application/json',
    });
  });

  /**
   * GET /:package/:version - Get specific version metadata
   */
  router.get('/:package{.+}/:version', async (c) => {
    const packageName = c.req.param('package');
    const version = c.req.param('version');

    const fullName = packageName.replace('%2f', '/').replace('%2F', '/');
    const metadata = await registryManager.getNpmMetadata(fullName);

    if (!metadata || !metadata.versions[version]) {
      return c.json({ error: 'Not found' }, 404);
    }

    return c.json(metadata.versions[version]);
  });

  /**
   * PUT /:package - Publish a package
   * npm CLI calls this with the package tarball and manifest
   */
  router.put('/:package{.+}', async (c) => {
    const publisher = c.req.header('x-jeju-address') as Address;

    if (!publisher) {
      return c.json({ error: 'Missing x-jeju-address header' }, 401);
    }

    const packageName = c.req.param('package');
    const fullName = packageName.replace('%2f', '/').replace('%2F', '/');

    const body = await c.req.json<NpmPublishPayload>();

    // Extract version being published
    const versionKey = Object.keys(body.versions)[0];
    const versionData = body.versions[versionKey];

    if (!versionData) {
      return c.json({ error: 'No version data provided' }, 400);
    }

    // Extract tarball from attachments
    const attachmentKey = Object.keys(body._attachments)[0];
    const attachment = body._attachments[attachmentKey];

    if (!attachment) {
      return c.json({ error: 'No attachment provided' }, 400);
    }

    const tarball = Buffer.from(attachment.data, 'base64');

    // Build manifest from version data
    const manifest: PackageManifest = {
      name: versionData.name,
      version: versionData.version,
      description: versionData.description,
      main: versionData.main,
      scripts: versionData.scripts,
      dependencies: versionData.dependencies,
      devDependencies: versionData.devDependencies,
      peerDependencies: versionData.peerDependencies,
      engines: versionData.engines,
      keywords: versionData.keywords,
      author: versionData.author,
      license: versionData.license,
      homepage: versionData.homepage,
      repository: versionData.repository,
      bugs: versionData.bugs,
    };

    const result = await registryManager.publish(fullName, manifest, tarball, publisher);

    // Track contribution to leaderboard
    recordPackagePublish(
      publisher,
      result.packageId,
      fullName,
      manifest.version
    ).catch(() => {}); // Fire and forget

    return c.json({
      ok: true,
      id: fullName,
      rev: `1-${result.versionId.slice(2, 10)}`,
    });
  });

  /**
   * GET /-/v1/search - Search packages
   * npm CLI calls this for npm search
   */
  router.get('/-/v1/search', async (c) => {
    const text = c.req.query('text') || '';
    const size = parseInt(c.req.query('size') || '20');
    const from = parseInt(c.req.query('from') || '0');

    const packages = await registryManager.searchPackages(text, from, size);

    const result: NpmSearchResult = {
      objects: packages.map((pkg) => ({
        package: {
          name: registryManager.getFullName(pkg.name, pkg.scope),
          scope: pkg.scope || undefined,
          version: '0.0.0', // Would need to fetch latest version
          description: pkg.description,
          date: new Date(Number(pkg.updatedAt) * 1000).toISOString(),
          publisher: { username: pkg.owner },
        },
        score: {
          final: 1,
          detail: { quality: 1, popularity: 1, maintenance: 1 },
        },
        searchScore: 1,
      })),
      total: packages.length,
      time: new Date().toISOString(),
    };

    return c.json(result);
  });

  /**
   * GET /-/ping - Ping endpoint
   */
  router.get('/-/ping', (c) => {
    return c.json({});
  });

  /**
   * GET /-/whoami - Get current user
   */
  router.get('/-/whoami', (c) => {
    const address = c.req.header('x-jeju-address');

    if (!address) {
      return c.json({ error: 'Not authenticated' }, 401);
    }

    return c.json({ username: address });
  });

  /**
   * PUT /-/user/org.couchdb.user:* - Login/Register
   * npm CLI calls this for npm login
   */
  router.put('/-/user/:user{.+}', async (c) => {
    const body = await c.req.json<{
      name: string;
      password: string;
      email?: string;
    }>();

    // For Jeju, we use wallet addresses as usernames
    // The "password" would be a signed message proving ownership

    return c.json({
      ok: true,
      id: `org.couchdb.user:${body.name}`,
      rev: '1',
      token: `jeju-npm-token-${body.name}`,
    });
  });

  /**
   * DELETE /-/user/token/* - Logout
   */
  router.delete('/-/user/token/:token', (c) => {
    return c.json({ ok: true });
  });

  /**
   * GET /:package/-/:tarball - Download tarball
   * npm CLI calls this to download the actual package
   */
  router.get('/:package{.+}/-/:tarball', async (c) => {
    const packageName = c.req.param('package');
    const tarballName = c.req.param('tarball');

    const fullName = packageName.replace('%2f', '/').replace('%2F', '/');

    // Extract version from tarball name (e.g., package-1.0.0.tgz)
    const versionMatch = tarballName.match(/-(\d+\.\d+\.\d+[^.]*).tgz$/);
    if (!versionMatch) {
      return c.json({ error: 'Invalid tarball name' }, 400);
    }

    const version = versionMatch[1];
    const pkg = await registryManager.getPackageByName(fullName);

    if (!pkg) {
      return c.json({ error: 'Package not found' }, 404);
    }

    const ver = await registryManager.getVersion(pkg.packageId, version);
    if (!ver) {
      return c.json({ error: 'Version not found' }, 404);
    }

    const tarball = await registryManager.downloadTarball(ver.tarballCid);
    if (!tarball) {
      return c.json({ error: 'Tarball not found' }, 404);
    }

    // Record download
    await registryManager.recordDownload(pkg.packageId, ver.versionId).catch(() => {});

    return new Response(tarball, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${tarballName}"`,
        'Content-Length': String(tarball.length),
      },
    });
  });

  // ============ Extended API ============

  /**
   * GET /api/packages - List all packages
   */
  router.get('/api/packages', async (c) => {
    const offset = parseInt(c.req.query('offset') || '0');
    const limit = parseInt(c.req.query('limit') || '20');

    const packages = await registryManager.searchPackages('', offset, limit);
    const total = await registryManager.getPackageCount();

    return c.json({
      packages: packages.map((pkg) => ({
        packageId: pkg.packageId,
        name: registryManager.getFullName(pkg.name, pkg.scope),
        description: pkg.description,
        owner: pkg.owner,
        license: pkg.license,
        deprecated: pkg.deprecated,
        downloadCount: Number(pkg.downloadCount),
        createdAt: Number(pkg.createdAt),
        updatedAt: Number(pkg.updatedAt),
      })),
      total,
      offset,
      limit,
    });
  });

  /**
   * GET /api/packages/:name - Get package info
   */
  router.get('/api/packages/:name{.+}', async (c) => {
    const fullName = c.req.param('name').replace('%2f', '/').replace('%2F', '/');
    const pkg = await registryManager.getPackageByName(fullName);

    if (!pkg) {
      return c.json({ error: 'Package not found' }, 404);
    }

    const versions = await registryManager.getVersions(pkg.packageId);

    return c.json({
      packageId: pkg.packageId,
      name: registryManager.getFullName(pkg.name, pkg.scope),
      description: pkg.description,
      owner: pkg.owner,
      license: pkg.license,
      homepage: pkg.homepage,
      repository: pkg.repository,
      deprecated: pkg.deprecated,
      downloadCount: Number(pkg.downloadCount),
      createdAt: Number(pkg.createdAt),
      updatedAt: Number(pkg.updatedAt),
      versions: versions.map((v) => ({
        version: v.version,
        publisher: v.publisher,
        publishedAt: Number(v.publishedAt),
        deprecated: v.deprecated,
        size: Number(v.size),
      })),
    });
  });

  return router;
}

