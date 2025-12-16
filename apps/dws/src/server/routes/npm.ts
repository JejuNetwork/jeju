/**
 * NPM Registry Routes - npm CLI compatible API
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

  router.get('/health', (c) => c.json({ service: 'dws-npm', status: 'healthy' }));

  router.get('/-/ping', (c) => c.json({}));

  router.get('/-/whoami', (c) => {
    const address = c.req.header('x-jeju-address');
    if (!address) return c.json({ error: 'Not authenticated' }, 401);
    return c.json({ username: address });
  });

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
          version: '0.0.0',
          description: pkg.description,
          date: new Date(Number(pkg.updatedAt) * 1000).toISOString(),
          publisher: { username: pkg.owner },
        },
        score: { final: 1, detail: { quality: 1, popularity: 1, maintenance: 1 } },
        searchScore: 1,
      })),
      total: packages.length,
      time: new Date().toISOString(),
    };

    return c.json(result);
  });

  router.put('/-/user/:user{.+}', async (c) => {
    const body = await c.req.json<{ name: string; password: string; email?: string }>();
    return c.json({
      ok: true,
      id: `org.couchdb.user:${body.name}`,
      rev: '1',
      token: `jeju-npm-token-${body.name}`,
    });
  });

  router.delete('/-/user/token/:token', (c) => c.json({ ok: true }));

  // Tarball download - must come before catch-all
  router.get('/:package{.+}/-/:tarball', async (c) => {
    const packageName = c.req.param('package');
    const tarballName = c.req.param('tarball');
    const fullName = packageName.replace('%2f', '/').replace('%2F', '/');

    const versionMatch = tarballName.match(/-(\d+\.\d+\.\d+[^.]*).tgz$/);
    if (!versionMatch) return c.json({ error: 'Invalid tarball name' }, 400);

    const pkg = await registryManager.getPackageByName(fullName);
    if (!pkg) return c.json({ error: 'Package not found' }, 404);

    const ver = await registryManager.getVersion(pkg.packageId, versionMatch[1]);
    if (!ver) return c.json({ error: 'Version not found' }, 404);

    const tarball = await ctx.backend.download(ver.tarballCid);
    return new Response(tarball.content, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${tarballName}"`,
      },
    });
  });

  // Specific version metadata
  router.get('/:package{.+}/:version', async (c) => {
    const packageName = c.req.param('package');
    const version = c.req.param('version');

    if (packageName.startsWith('-/')) return c.json({ ok: true });

    const fullName = packageName.replace('%2f', '/').replace('%2F', '/');
    const metadata = await registryManager.getNpmMetadata(fullName);

    if (!metadata || !metadata.versions[version]) {
      return c.json({ error: 'Not found' }, 404);
    }

    return c.json(metadata.versions[version]);
  });

  // Publish package
  router.put('/:package{.+}', async (c) => {
    const publisher = c.req.header('x-jeju-address') as Address;
    if (!publisher) return c.json({ error: 'Missing x-jeju-address header' }, 401);

    const packageName = c.req.param('package');
    const fullName = packageName.replace('%2f', '/').replace('%2F', '/');
    const body = await c.req.json<NpmPublishPayload>();

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
    recordPackagePublish(publisher, result.packageId, fullName, manifest.version);

    return c.json({
      ok: true,
      id: fullName,
      rev: `1-${result.versionId.slice(2, 10)}`,
    });
  });

  // Package metadata (catch-all, must be last)
  router.get('/:package{.+}', async (c) => {
    const packageName = c.req.param('package');
    const fullName = packageName.replace('%2f', '/').replace('%2F', '/');

    if (fullName.startsWith('-/')) return c.json({ ok: true });

    const metadata = await registryManager.getNpmMetadata(fullName);
    if (!metadata) return c.json({ error: 'Not found' }, 404);

    return c.json(metadata, 200, { 'Content-Type': 'application/json' });
  });

  return router;
}
