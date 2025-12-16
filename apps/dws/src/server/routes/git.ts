/**
 * Git HTTP Server - Smart HTTP Protocol for clone/push
 */

import { Hono } from 'hono';
import type { Address, Hex } from 'viem';
import type { BackendManager } from '../../storage/backends';
import { GitRepoManager } from '../../git/repo-manager';
import { GitObjectStore } from '../../git/object-store';
import {
  createPackfile,
  extractPackfile,
  parsePktLines,
  createPktLine,
  createPktLines,
  createFlushPkt,
} from '../../git/pack';
import type { CreateRepoRequest, GitRef } from '../../git/types';
import { trackGitContribution } from '../../git/leaderboard-integration';

const GIT_AGENT = 'jeju-git/1.0.0';

interface GitContext {
  repoManager: GitRepoManager;
  backend: BackendManager;
}

export function createGitRouter(ctx: GitContext): Hono {
  const router = new Hono();
  const { repoManager } = ctx;

  router.get('/health', (c) => c.json({ service: 'dws-git', status: 'healthy' }));

  router.get('/repos', async (c) => {
    const offset = parseInt(c.req.query('offset') || '0');
    const limit = parseInt(c.req.query('limit') || '20');
    const repos = await repoManager.getAllRepositories(offset, limit);
    const total = await repoManager.getRepositoryCount();

    return c.json({
      repositories: repos.map((r) => ({
        repoId: r.repoId,
        owner: r.owner,
        name: r.name,
        description: r.description,
        visibility: r.visibility === 0 ? 'public' : 'private',
        starCount: Number(r.starCount),
        forkCount: Number(r.forkCount),
        createdAt: Number(r.createdAt),
        updatedAt: Number(r.updatedAt),
        archived: r.archived,
        cloneUrl: `${getBaseUrl(c)}/git/${r.owner}/${r.name}`,
      })),
      total,
      offset,
      limit,
    });
  });

  router.post('/repos', async (c) => {
    const body = await c.req.json<CreateRepoRequest>();
    const signer = c.req.header('x-jeju-address') as Address;

    if (!signer) return c.json({ error: 'Missing x-jeju-address header' }, 401);
    if (!body.name) return c.json({ error: 'Repository name is required' }, 400);

    const result = await repoManager.createRepository(body, signer);
    trackGitContribution(signer, result.repoId as Hex, body.name, 'branch', { branch: 'main', message: 'Repository created' });

    return c.json(result, 201);
  });

  router.get('/repos/:owner/:name', async (c) => {
    const owner = c.req.param('owner') as Address;
    const name = c.req.param('name');
    const repo = await repoManager.getRepositoryByName(owner, name);
    if (!repo) return c.json({ error: 'Repository not found' }, 404);

    const branches = await repoManager.getBranches(repo.repoId);

    return c.json({
      repoId: repo.repoId,
      owner: repo.owner,
      name: repo.name,
      description: repo.description,
      visibility: repo.visibility === 0 ? 'public' : 'private',
      starCount: Number(repo.starCount),
      forkCount: Number(repo.forkCount),
      createdAt: Number(repo.createdAt),
      updatedAt: Number(repo.updatedAt),
      archived: repo.archived,
      defaultBranch: 'main',
      branches: branches.map((b) => ({
        name: b.name,
        tipCommit: b.tipCommitCid.slice(2, 42),
        lastPusher: b.lastPusher,
        updatedAt: Number(b.updatedAt),
        protected: b.protected,
      })),
      cloneUrl: `${getBaseUrl(c)}/git/${repo.owner}/${repo.name}`,
    });
  });

  router.get('/users/:address/repos', async (c) => {
    const address = c.req.param('address') as Address;
    const repos = await repoManager.getUserRepositories(address);

    return c.json({
      repositories: repos.map((r) => ({
        repoId: r.repoId,
        owner: r.owner,
        name: r.name,
        description: r.description,
        visibility: r.visibility === 0 ? 'public' : 'private',
        starCount: Number(r.starCount),
        createdAt: Number(r.createdAt),
        cloneUrl: `${getBaseUrl(c)}/git/${r.owner}/${r.name}`,
      })),
    });
  });

  // Git Smart HTTP Protocol - info/refs
  router.get('/:owner/:name/info/refs', async (c) => {
    const owner = c.req.param('owner') as Address;
    const name = c.req.param('name');
    const service = c.req.query('service');

    if (!service || (service !== 'git-upload-pack' && service !== 'git-receive-pack')) {
      return c.text('Service required', 400);
    }

    const repo = await repoManager.getRepositoryByName(owner, name);
    if (!repo) return c.text('Repository not found', 404);

    const user = c.req.header('x-jeju-address') as Address | undefined;

    if (service === 'git-receive-pack') {
      if (!user) return c.text('Authentication required', 401);
      const hasWrite = await repoManager.hasWriteAccess(repo.repoId, user);
      if (!hasWrite) return c.text('Write access denied', 403);
    } else if (repo.visibility === 1) {
      if (!user) return c.text('Authentication required', 401);
      const hasRead = await repoManager.hasReadAccess(repo.repoId, user);
      if (!hasRead) return c.text('Read access denied', 403);
    }

    const refs = await repoManager.getRefs(repo.repoId);
    return new Response(formatInfoRefs(service, refs), {
      headers: { 'Content-Type': `application/x-${service}-advertisement`, 'Cache-Control': 'no-cache' },
    });
  });

  // Git upload-pack (fetch/clone)
  router.post('/:owner/:name/git-upload-pack', async (c) => {
    const owner = c.req.param('owner') as Address;
    const name = c.req.param('name');
    const repo = await repoManager.getRepositoryByName(owner, name);
    if (!repo) return c.text('Repository not found', 404);

    if (repo.visibility === 1) {
      const user = c.req.header('x-jeju-address') as Address | undefined;
      if (!user) return c.text('Authentication required', 401);
      const hasRead = await repoManager.hasReadAccess(repo.repoId, user);
      if (!hasRead) return c.text('Read access denied', 403);
    }

    const body = Buffer.from(await c.req.arrayBuffer());
    const lines = parsePktLines(body);

    const wants: string[] = [];
    const haves: string[] = [];

    for (const line of lines) {
      if (line.startsWith('want ')) wants.push(line.split(' ')[1]);
      else if (line.startsWith('have ')) haves.push(line.split(' ')[1]);
    }

    if (wants.length === 0) {
      return new Response(createPktLine('NAK'), {
        headers: { 'Content-Type': 'application/x-git-upload-pack-result' },
      });
    }

    const objectStore = repoManager.getObjectStore(repo.repoId);
    const neededOids: string[] = [];
    const haveSet = new Set(haves);

    for (const wantOid of wants) {
      const reachable = await objectStore.getReachableObjects(wantOid);
      for (const oid of reachable) {
        if (!haveSet.has(oid)) neededOids.push(oid);
      }
    }

    const packfile = await createPackfile(objectStore, neededOids);
    const response = Buffer.concat([createPktLine('NAK'), packfile]);

    return new Response(response, {
      headers: { 'Content-Type': 'application/x-git-upload-pack-result', 'Cache-Control': 'no-cache' },
    });
  });

  // Git receive-pack (push)
  router.post('/:owner/:name/git-receive-pack', async (c) => {
    const owner = c.req.param('owner') as Address;
    const name = c.req.param('name');
    const user = c.req.header('x-jeju-address') as Address;

    if (!user) return c.text('Authentication required', 401);

    const repo = await repoManager.getRepositoryByName(owner, name);
    if (!repo) return c.text('Repository not found', 404);

    const hasWrite = await repoManager.hasWriteAccess(repo.repoId, user);
    if (!hasWrite) return c.text('Write access denied', 403);

    const body = Buffer.from(await c.req.arrayBuffer());
    const packStart = body.indexOf(Buffer.from('PACK'));
    const commandData = body.subarray(0, packStart);
    const packData = body.subarray(packStart);

    const lines = parsePktLines(commandData);
    const updates: Array<{ oldOid: string; newOid: string; refName: string }> = [];

    for (const line of lines) {
      if (line === '' || line === '0000') continue;
      const match = line.match(/^([0-9a-f]{40}) ([0-9a-f]{40}) (.+)$/);
      if (match) {
        updates.push({ oldOid: match[1], newOid: match[2], refName: match[3].split('\0')[0] });
      }
    }

    const objectStore = repoManager.getObjectStore(repo.repoId);
    await extractPackfile(objectStore, packData);

    const results: Array<{ ref: string; success: boolean; error?: string }> = [];

    for (const update of updates) {
      if (!update.refName.startsWith('refs/heads/')) {
        results.push({ ref: update.refName, success: false, error: 'Only branch updates supported' });
        continue;
      }

      const branchName = update.refName.replace('refs/heads/', '');
      const commits = await objectStore.walkCommits(update.newOid, 100);

      await repoManager.pushBranch(
        repo.repoId,
        branchName,
        update.newOid,
        update.oldOid === '0000000000000000000000000000000000000000' ? null : update.oldOid,
        commits.length,
        user
      );

      trackGitContribution(user, repo.repoId as Hex, name, 'commit', {
        branch: branchName,
        commitCount: commits.length,
        message: commits[0]?.message.split('\n')[0] || 'Push',
      });

      results.push({ ref: update.refName, success: true });
    }

    const responseLines = ['unpack ok', ...results.map((r) => (r.success ? `ok ${r.ref}` : `ng ${r.ref} ${r.error}`))];
    return new Response(createPktLines(responseLines), {
      headers: { 'Content-Type': 'application/x-git-receive-pack-result', 'Cache-Control': 'no-cache' },
    });
  });

  // Object API (debugging/direct access)
  router.get('/:owner/:name/objects/:oid', async (c) => {
    const owner = c.req.param('owner') as Address;
    const name = c.req.param('name');
    const oid = c.req.param('oid');

    const repo = await repoManager.getRepositoryByName(owner, name);
    if (!repo) return c.json({ error: 'Repository not found' }, 404);

    const objectStore = repoManager.getObjectStore(repo.repoId);
    const obj = await objectStore.getObject(oid);
    if (!obj) return c.json({ error: 'Object not found' }, 404);

    if (obj.type === 'commit') {
      return c.json({ oid, type: 'commit', ...objectStore.parseCommit(obj.content) });
    } else if (obj.type === 'tree') {
      return c.json({ oid, type: 'tree', entries: objectStore.parseTree(obj.content) });
    } else {
      return c.json({ oid, type: obj.type, size: obj.size, content: obj.content.toString('base64') });
    }
  });

  router.get('/:owner/:name/contents/*', async (c) => {
    const owner = c.req.param('owner') as Address;
    const name = c.req.param('name');
    const path = c.req.path.split('/contents/')[1] || '';
    const ref = c.req.query('ref') || 'main';

    const repo = await repoManager.getRepositoryByName(owner, name);
    if (!repo) return c.json({ error: 'Repository not found' }, 404);

    const objectStore = repoManager.getObjectStore(repo.repoId);
    const branch = await repoManager.getBranch(repo.repoId, ref);
    if (!branch) return c.json({ error: 'Branch not found' }, 404);

    const commit = await objectStore.getCommit(branch.tipCommitCid.slice(2, 42));
    if (!commit) return c.json({ error: 'Commit not found' }, 404);

    let currentTree = await objectStore.getTree(commit.tree);
    if (!currentTree) return c.json({ error: 'Tree not found' }, 404);

    const pathParts = path.split('/').filter(Boolean);

    for (let i = 0; i < pathParts.length - 1; i++) {
      const entry = currentTree.entries.find((e) => e.name === pathParts[i] && e.type === 'tree');
      if (!entry) return c.json({ error: 'Path not found' }, 404);
      const nextTree = await objectStore.getTree(entry.oid);
      if (!nextTree) return c.json({ error: 'Tree not found' }, 404);
      currentTree = nextTree;
    }

    if (pathParts.length === 0) {
      return c.json({
        type: 'dir',
        path: '',
        entries: currentTree.entries.map((e) => ({
          name: e.name,
          type: e.type === 'tree' ? 'dir' : 'file',
          oid: e.oid,
          mode: e.mode,
        })),
      });
    }

    const targetName = pathParts[pathParts.length - 1];
    const target = currentTree.entries.find((e) => e.name === targetName);
    if (!target) return c.json({ error: 'Path not found' }, 404);

    if (target.type === 'tree') {
      const tree = await objectStore.getTree(target.oid);
      if (!tree) return c.json({ error: 'Tree not found' }, 404);
      return c.json({
        type: 'dir',
        path,
        entries: tree.entries.map((e) => ({ name: e.name, type: e.type === 'tree' ? 'dir' : 'file', oid: e.oid, mode: e.mode })),
      });
    }

    const blob = await objectStore.getBlob(target.oid);
    if (!blob) return c.json({ error: 'Blob not found' }, 404);

    const isText = !blob.content.includes(0);
    return c.json({
      type: 'file',
      path,
      oid: target.oid,
      size: blob.content.length,
      content: isText ? blob.content.toString('utf8') : blob.content.toString('base64'),
      encoding: isText ? 'utf-8' : 'base64',
    });
  });

  router.get('/:owner/:name/commits', async (c) => {
    const owner = c.req.param('owner') as Address;
    const name = c.req.param('name');
    const ref = c.req.query('ref') || 'main';
    const limit = parseInt(c.req.query('limit') || '20');

    const repo = await repoManager.getRepositoryByName(owner, name);
    if (!repo) return c.json({ error: 'Repository not found' }, 404);

    const branch = await repoManager.getBranch(repo.repoId, ref);
    if (!branch) return c.json({ error: 'Branch not found' }, 404);

    const objectStore = repoManager.getObjectStore(repo.repoId);
    const commits = await objectStore.walkCommits(branch.tipCommitCid.slice(2, 42), limit);

    return c.json({
      branch: ref,
      commits: commits.map((commit) => ({
        oid: commit.oid,
        message: commit.message,
        author: commit.author,
        committer: commit.committer,
        parents: commit.parents,
        tree: commit.tree,
      })),
    });
  });

  return router;
}

function formatInfoRefs(service: string, refs: GitRef[]): Buffer {
  const lines: Buffer[] = [];
  lines.push(createPktLine(`# service=${service}`));
  lines.push(createFlushPkt());

  const capabilities = ['report-status', 'delete-refs', 'side-band-64k', 'quiet', 'ofs-delta', `agent=${GIT_AGENT}`].join(' ');

  if (refs.length === 0) {
    lines.push(createPktLine(`${'0'.repeat(40)} capabilities^{}\0${capabilities}`));
  } else {
    for (let i = 0; i < refs.length; i++) {
      const ref = refs[i];
      lines.push(createPktLine(i === 0 ? `${ref.oid} ${ref.name}\0${capabilities}` : `${ref.oid} ${ref.name}`));
    }
  }

  lines.push(createFlushPkt());
  return Buffer.concat(lines);
}

function getBaseUrl(c: { req: { url: string } }): string {
  const url = new URL(c.req.url);
  return process.env.DWS_BASE_URL || `${url.protocol}//${url.host}`;
}
