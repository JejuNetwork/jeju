/**
 * Git HTTP Server - Smart HTTP Protocol and Extended APIs (JejuGit)
 */

import { Hono } from 'hono';
import type { Address, Hex } from 'viem';
import type { BackendManager } from '../../storage/backends';
import { GitRepoManager } from '../../git/repo-manager';
import { IssuesManager } from '../../git/issues';
import { PullRequestsManager } from '../../git/pull-requests';
import { SocialManager } from '../../git/social';
import { SearchManager } from '../../git/search';
import { FederationManager } from '../../git/federation';
import { decodeBytes32ToOid } from '../../git/oid-utils';
import {
  createPackfile,
  extractPackfile,
  parsePktLines,
  createPktLine,
  createPktLines,
  createFlushPkt,
} from '../../git/pack';
import type { CreateRepoRequest, GitRef, CreateIssueRequest, UpdateIssueRequest, CreatePRRequest, UpdatePRRequest as _UpdatePRRequest } from '../../git/types';
import { trackGitContribution } from '../../git/leaderboard-integration';

const GIT_AGENT = 'jeju-git/1.0.0';

interface GitContext {
  repoManager: GitRepoManager;
  backend: BackendManager;
  issuesManager?: IssuesManager;
  pullRequestsManager?: PullRequestsManager;
  socialManager?: SocialManager;
  searchManager?: SearchManager;
  federationManager?: FederationManager;
}

export function createGitRouter(ctx: GitContext): Hono {
  const router = new Hono();
  const { repoManager, backend } = ctx;

  // Initialize managers if not provided
  const issuesManager = ctx.issuesManager || new IssuesManager({ backend });
  const socialManager = ctx.socialManager || new SocialManager({ backend, repoManager });
  const pullRequestsManager = ctx.pullRequestsManager || new PullRequestsManager({ backend, repoManager });
  const searchManager = ctx.searchManager || new SearchManager({ repoManager, issuesManager, socialManager, backend });

  router.get('/health', (c) => c.json({ service: 'dws-git', status: 'healthy' }));

  // ============ Repository CRUD ============

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
    const starCount = socialManager.getStarCount(repo.repoId);
    const forkCount = socialManager.getForkCount(repo.repoId);

    return c.json({
      repoId: repo.repoId,
      owner: repo.owner,
      name: repo.name,
      description: repo.description,
      visibility: repo.visibility === 0 ? 'public' : 'private',
      starCount,
      forkCount,
      createdAt: Number(repo.createdAt),
      updatedAt: Number(repo.updatedAt),
      archived: repo.archived,
      defaultBranch: 'main',
      branches: branches.map((b) => ({
        name: b.name,
        tipCommit: decodeBytes32ToOid(b.tipCommitCid),
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

  // ============ Issues API ============

  router.get('/:owner/:name/issues', async (c) => {
    const owner = c.req.param('owner') as Address;
    const name = c.req.param('name');
    const repo = await repoManager.getRepositoryByName(owner, name);
    if (!repo) return c.json({ error: 'Repository not found' }, 404);

    const state = c.req.query('state') as 'open' | 'closed' | 'all' | undefined;
    const page = parseInt(c.req.query('page') || '1');
    const perPage = parseInt(c.req.query('per_page') || '30');

    await issuesManager.getIssueIndex(repo.repoId, repo.metadataCid.slice(2));
    const result = await issuesManager.listIssues(repo.repoId, { state, page, perPage });

    return c.json(result);
  });

  router.post('/:owner/:name/issues', async (c) => {
    const owner = c.req.param('owner') as Address;
    const name = c.req.param('name');
    const user = c.req.header('x-jeju-address') as Address;
    if (!user) return c.json({ error: 'Authentication required' }, 401);

    const repo = await repoManager.getRepositoryByName(owner, name);
    if (!repo) return c.json({ error: 'Repository not found' }, 404);

    const body = await c.req.json<CreateIssueRequest>();
    await issuesManager.getIssueIndex(repo.repoId, repo.metadataCid.slice(2));
    const result = await issuesManager.createIssue(repo.repoId, user, body);

    trackGitContribution(user, repo.repoId, name, 'issue_open', { issueNumber: result.issue.number });

    return c.json(result.issue, 201);
  });

  router.get('/:owner/:name/issues/:number', async (c) => {
    const owner = c.req.param('owner') as Address;
    const name = c.req.param('name');
    const issueNumber = parseInt(c.req.param('number'));

    const repo = await repoManager.getRepositoryByName(owner, name);
    if (!repo) return c.json({ error: 'Repository not found' }, 404);

    await issuesManager.getIssueIndex(repo.repoId, repo.metadataCid.slice(2));
    const issue = await issuesManager.getIssue(repo.repoId, issueNumber);
    if (!issue) return c.json({ error: 'Issue not found' }, 404);

    return c.json(issue);
  });

  router.patch('/:owner/:name/issues/:number', async (c) => {
    const owner = c.req.param('owner') as Address;
    const name = c.req.param('name');
    const issueNumber = parseInt(c.req.param('number'));
    const user = c.req.header('x-jeju-address') as Address;
    if (!user) return c.json({ error: 'Authentication required' }, 401);

    const repo = await repoManager.getRepositoryByName(owner, name);
    if (!repo) return c.json({ error: 'Repository not found' }, 404);

    const body = await c.req.json<UpdateIssueRequest>();
    await issuesManager.getIssueIndex(repo.repoId, repo.metadataCid.slice(2));
    const result = await issuesManager.updateIssue(repo.repoId, issueNumber, user, body);

    if (result.contributionEvent) {
      trackGitContribution(user, repo.repoId, name, 'issue_close', { issueNumber });
    }

    return c.json(result.issue);
  });

  router.post('/:owner/:name/issues/:number/comments', async (c) => {
    const owner = c.req.param('owner') as Address;
    const name = c.req.param('name');
    const issueNumber = parseInt(c.req.param('number'));
    const user = c.req.header('x-jeju-address') as Address;
    if (!user) return c.json({ error: 'Authentication required' }, 401);

    const repo = await repoManager.getRepositoryByName(owner, name);
    if (!repo) return c.json({ error: 'Repository not found' }, 404);

    const { body: commentBody } = await c.req.json<{ body: string }>();
    await issuesManager.getIssueIndex(repo.repoId, repo.metadataCid.slice(2));
    const result = await issuesManager.addComment(repo.repoId, issueNumber, user, commentBody);

    return c.json(result.comment, 201);
  });

  // ============ Pull Requests API ============

  router.get('/:owner/:name/pulls', async (c) => {
    const owner = c.req.param('owner') as Address;
    const name = c.req.param('name');
    const repo = await repoManager.getRepositoryByName(owner, name);
    if (!repo) return c.json({ error: 'Repository not found' }, 404);

    const state = c.req.query('state') as 'open' | 'closed' | 'merged' | 'all' | undefined;
    const page = parseInt(c.req.query('page') || '1');
    const perPage = parseInt(c.req.query('per_page') || '30');

    await pullRequestsManager.getPRIndex(repo.repoId, repo.metadataCid.slice(2));
    const result = await pullRequestsManager.listPRs(repo.repoId, { state, page, perPage });

    return c.json(result);
  });

  router.post('/:owner/:name/pulls', async (c) => {
    const owner = c.req.param('owner') as Address;
    const name = c.req.param('name');
    const user = c.req.header('x-jeju-address') as Address;
    if (!user) return c.json({ error: 'Authentication required' }, 401);

    const repo = await repoManager.getRepositoryByName(owner, name);
    if (!repo) return c.json({ error: 'Repository not found' }, 404);

    const body = await c.req.json<CreatePRRequest>();
    await pullRequestsManager.getPRIndex(repo.repoId, repo.metadataCid.slice(2));
    const result = await pullRequestsManager.createPR(repo.repoId, user, body);

    trackGitContribution(user, repo.repoId, name, 'pr_open', { prNumber: result.pr.number });

    return c.json(result.pr, 201);
  });

  router.get('/:owner/:name/pulls/:number', async (c) => {
    const owner = c.req.param('owner') as Address;
    const name = c.req.param('name');
    const prNumber = parseInt(c.req.param('number'));

    const repo = await repoManager.getRepositoryByName(owner, name);
    if (!repo) return c.json({ error: 'Repository not found' }, 404);

    await pullRequestsManager.getPRIndex(repo.repoId, repo.metadataCid.slice(2));
    const pr = await pullRequestsManager.getPR(repo.repoId, prNumber);
    if (!pr) return c.json({ error: 'Pull request not found' }, 404);

    return c.json(pr);
  });

  router.post('/:owner/:name/pulls/:number/merge', async (c) => {
    const owner = c.req.param('owner') as Address;
    const name = c.req.param('name');
    const prNumber = parseInt(c.req.param('number'));
    const user = c.req.header('x-jeju-address') as Address;
    if (!user) return c.json({ error: 'Authentication required' }, 401);

    const repo = await repoManager.getRepositoryByName(owner, name);
    if (!repo) return c.json({ error: 'Repository not found' }, 404);

    const hasWrite = await repoManager.hasWriteAccess(repo.repoId, user);
    if (!hasWrite) return c.json({ error: 'Write access denied' }, 403);

    await pullRequestsManager.getPRIndex(repo.repoId, repo.metadataCid.slice(2));
    const result = await pullRequestsManager.mergePR(repo.repoId, prNumber, user);

    trackGitContribution(user, repo.repoId, name, 'pr_merge', { prNumber });

    return c.json({ merged: true, sha: result.pr.headCommit });
  });

  // ============ Stars API ============

  router.get('/:owner/:name/stargazers', async (c) => {
    const owner = c.req.param('owner') as Address;
    const name = c.req.param('name');
    const repo = await repoManager.getRepositoryByName(owner, name);
    if (!repo) return c.json({ error: 'Repository not found' }, 404);

    const page = parseInt(c.req.query('page') || '1');
    const perPage = parseInt(c.req.query('per_page') || '30');

    const result = await socialManager.getStargazers(repo.repoId, { page, perPage });
    return c.json(result);
  });

  router.put('/:owner/:name/star', async (c) => {
    const owner = c.req.param('owner') as Address;
    const name = c.req.param('name');
    const user = c.req.header('x-jeju-address') as Address;
    if (!user) return c.json({ error: 'Authentication required' }, 401);

    const repo = await repoManager.getRepositoryByName(owner, name);
    if (!repo) return c.json({ error: 'Repository not found' }, 404);

    const result = await socialManager.starRepo(repo.repoId, user);
    return c.json(result, 200);
  });

  router.delete('/:owner/:name/star', async (c) => {
    const owner = c.req.param('owner') as Address;
    const name = c.req.param('name');
    const user = c.req.header('x-jeju-address') as Address;
    if (!user) return c.json({ error: 'Authentication required' }, 401);

    const repo = await repoManager.getRepositoryByName(owner, name);
    if (!repo) return c.json({ error: 'Repository not found' }, 404);

    const result = await socialManager.unstarRepo(repo.repoId, user);
    return c.json(result, 200);
  });

  // ============ Forks API ============

  router.get('/:owner/:name/forks', async (c) => {
    const owner = c.req.param('owner') as Address;
    const name = c.req.param('name');
    const repo = await repoManager.getRepositoryByName(owner, name);
    if (!repo) return c.json({ error: 'Repository not found' }, 404);

    const page = parseInt(c.req.query('page') || '1');
    const perPage = parseInt(c.req.query('per_page') || '30');

    const result = await socialManager.getForks(repo.repoId, { page, perPage });
    return c.json(result);
  });

  router.post('/:owner/:name/forks', async (c) => {
    const owner = c.req.param('owner') as Address;
    const name = c.req.param('name');
    const user = c.req.header('x-jeju-address') as Address;
    if (!user) return c.json({ error: 'Authentication required' }, 401);

    const repo = await repoManager.getRepositoryByName(owner, name);
    if (!repo) return c.json({ error: 'Repository not found' }, 404);

    const { name: forkName } = await c.req.json<{ name?: string }>();
    const result = await socialManager.forkRepo(repo.repoId, user, { name: forkName });

    return c.json({ repoId: result.repo.repoId, cloneUrl: `${getBaseUrl(c)}/git/${user}/${result.repo.name}` }, 201);
  });

  // ============ Search API ============

  router.get('/search/repositories', async (c) => {
    const q = c.req.query('q') || '';
    const page = parseInt(c.req.query('page') || '1');
    const perPage = parseInt(c.req.query('per_page') || '30');
    const sort = c.req.query('sort') as 'stars' | 'forks' | 'updated' | undefined;

    const result = await searchManager.searchRepositories(q, { page, perPage, sort });
    return c.json(result);
  });

  router.get('/search/code', async (c) => {
    const q = c.req.query('q') || '';
    const page = parseInt(c.req.query('page') || '1');
    const perPage = parseInt(c.req.query('per_page') || '30');

    const result = await searchManager.searchCode(q, { page, perPage });
    return c.json(result);
  });

  router.get('/search/issues', async (c) => {
    const q = c.req.query('q') || '';
    const page = parseInt(c.req.query('page') || '1');
    const perPage = parseInt(c.req.query('per_page') || '30');

    const result = await searchManager.searchIssues(q, { page, perPage });
    return c.json(result);
  });

  // ============ Federation API (ActivityPub) ============

  if (ctx.federationManager) {
    const federation = ctx.federationManager;

    router.get('/.well-known/webfinger', (c) => {
      const resource = c.req.query('resource');
      if (!resource) return c.json({ error: 'resource parameter required' }, 400);

      const result = federation.getWebFinger(resource);
      if (!result) return c.json({ error: 'Resource not found' }, 404);

      return c.json(result, 200, { 'Content-Type': 'application/jrd+json' });
    });

    router.get('/.well-known/nodeinfo', (c) => {
      return c.json(federation.getNodeInfoLinks());
    });

    router.get('/.well-known/nodeinfo/2.1', (c) => {
      return c.json(federation.getNodeInfo());
    });

    router.get('/users/:username', async (c) => {
      const username = c.req.param('username');
      const accept = c.req.header('Accept') || '';

      if (!accept.includes('application/activity+json') && !accept.includes('application/ld+json')) {
        return c.redirect(`${getBaseUrl(c)}/${username}`);
      }

      const user = await socialManager.getUserByName(username);
      if (!user) return c.json({ error: 'User not found' }, 404);

      const actor = federation.getUserActor(user);
      return c.json(actor, 200, { 'Content-Type': 'application/activity+json' });
    });

    router.post('/users/:username/inbox', async (c) => {
      const username = c.req.param('username');
      const user = await socialManager.getUserByName(username);
      if (!user) return c.json({ error: 'User not found' }, 404);

      const activity = await c.req.json();
      const actorUrl = `${getBaseUrl(c)}/users/${username}`;
      const result = await federation.handleInboxActivity(actorUrl, activity);

      if (result.response) {
        await federation.deliverActivity(result.response);
      }

      return c.json({ accepted: result.accepted }, result.accepted ? 202 : 400);
    });

    router.get('/users/:username/outbox', async (c) => {
      const username = c.req.param('username');
      const user = await socialManager.getUserByName(username);
      if (!user) return c.json({ error: 'User not found' }, 404);

      const actorUrl = `${getBaseUrl(c)}/users/${username}`;
      const page = parseInt(c.req.query('page') || '1');
      const outbox = federation.getOutboxActivities(actorUrl, { page });

      return c.json(outbox, 200, { 'Content-Type': 'application/activity+json' });
    });
  }

  // ============ Git Smart HTTP Protocol ============

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
    const body = formatInfoRefs(service, refs);
    return new Response(typeof body === 'string' ? body : new Uint8Array(body), {
      headers: { 'Content-Type': `application/x-${service}-advertisement`, 'Cache-Control': 'no-cache' },
    });
  });

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
      const nakLine = createPktLine('NAK');
      return new Response(typeof nakLine === 'string' ? nakLine : new Uint8Array(nakLine), {
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
    const pktLines = createPktLines(responseLines);
    return new Response(typeof pktLines === 'string' ? pktLines : new Uint8Array(pktLines), {
      headers: { 'Content-Type': 'application/x-git-receive-pack-result', 'Cache-Control': 'no-cache' },
    });
  });

  // ============ Object & Contents API ============

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

    const commit = await objectStore.getCommit(decodeBytes32ToOid(branch.tipCommitCid));
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
    const commits = await objectStore.walkCommits(decodeBytes32ToOid(branch.tipCommitCid), limit);

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
