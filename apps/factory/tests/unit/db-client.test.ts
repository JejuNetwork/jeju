/** Database Client Tests - Async SQLit Version */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { configureFactory } from '../../api/config'
import {
  addPackageMaintainer,
  addRepoCollaborator,
  addRepoWebhook,
  closeDB,
  createAgent,
  createBounty,
  createCIRun,
  createContainer,
  createContainerInstance,
  createDataset,
  createDiscussion,
  createIssue,
  createJob,
  createModel,
  createPackageToken,
  createProject,
  createPullRequest,
  createTask,
  deprecatePackage,
  getAgent,
  getBounty,
  getCIRun,
  getJob,
  getLeaderboard,
  getLeaderboardEntry,
  getModel,
  getPackageMaintainers,
  getPackageSettings,
  getProjectTasks,
  getRepoCollaborators,
  getRepoWebhooks,
  initDB,
  listAgents,
  listBounties,
  listDatasets,
  listDiscussions,
  listIssues,
  listJobs,
  removePackageMaintainer,
  removeRepoCollaborator,
  removeRepoWebhook,
  revokePackageToken,
  undeprecatePackage,
  updateBountyStatus,
  updateContainerInstanceStatus,
  updateLeaderboardScore,
  updateTask,
  upsertPackageSettings,
  upsertRepoSettings,
} from '../../api/db/client'

// Configure for test environment - use SQLit server on default test port
const SQLIT_TEST_ENDPOINT =
  process.env.SQLIT_ENDPOINT || 'http://127.0.0.1:4661'
const SQLIT_TEST_DB = `factory-test-${Date.now()}`

describe('Factory DB Client', () => {
  beforeAll(async () => {
    // Configure Factory to use test SQLit database
    configureFactory({
      sqlitEndpoint: SQLIT_TEST_ENDPOINT,
      sqlitDatabaseId: SQLIT_TEST_DB,
      isDev: true,
    })

    // Initialize database (auto-provisions if needed)
    await initDB()
  })

  afterAll(async () => {
    await closeDB()
  })

  describe('Bounties', () => {
    it('should create and retrieve a bounty', async () => {
      const bounty = await createBounty({
        title: 'Test Bounty',
        description: 'Test description',
        reward: '1000',
        currency: 'USDC',
        skills: ['solidity', 'typescript'],
        deadline: Date.now() + 7 * 24 * 60 * 60 * 1000,
        creator: '0x1234567890123456789012345678901234567890',
      })

      expect(bounty.id).toStartWith('bounty-')
      expect(bounty.title).toBe('Test Bounty')
      expect(bounty.status).toBe('open')

      const retrieved = await getBounty(bounty.id)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.title).toBe('Test Bounty')
    })

    it('should list bounties with filters', async () => {
      const result = await listBounties({ status: 'open' })
      expect(result.bounties.length).toBeGreaterThan(0)
      expect(result.total).toBeGreaterThan(0)
    })

    it('should update bounty status', async () => {
      const bounty = await createBounty({
        title: 'Status Test',
        description: 'Test',
        reward: '500',
        currency: 'ETH',
        skills: ['test'],
        deadline: Date.now() + 1000000,
        creator: '0x1234',
      })

      const updated = await updateBountyStatus(bounty.id, 'in_progress')
      expect(updated).toBe(true)

      const retrieved = await getBounty(bounty.id)
      expect(retrieved?.status).toBe('in_progress')
    })
  })

  describe('Jobs', () => {
    it('should create and retrieve a job', async () => {
      const job = await createJob({
        title: 'Senior Developer',
        company: 'Test Corp',
        type: 'full-time',
        remote: true,
        location: 'Remote',
        salary: { min: 100000, max: 150000, currency: 'USD' },
        skills: ['typescript', 'react'],
        description: 'Great opportunity',
        poster: '0xposter',
      })

      expect(job.id).toStartWith('job-')
      expect(job.title).toBe('Senior Developer')
      expect(job.salary_min).toBe(100000)

      const retrieved = await getJob(job.id)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.company).toBe('Test Corp')
    })

    it('should list jobs with filters', async () => {
      const result = await listJobs({ remote: true })
      expect(result.jobs.length).toBeGreaterThan(0)
    })
  })

  describe('Projects', () => {
    it('should create a project with tasks', async () => {
      const project = await createProject({
        name: 'Test Project',
        description: 'A test project',
        visibility: 'public',
        owner: '0xowner',
      })

      expect(project.id).toStartWith('project-')
      expect(project.name).toBe('Test Project')

      const task = await createTask({
        projectId: project.id,
        title: 'Task 1',
        assignee: '0xdev',
      })

      expect(task.id).toStartWith('task-')
      expect(task.status).toBe('pending')

      const tasks = await getProjectTasks(project.id)
      expect(tasks.length).toBe(1)
    })

    it('should update task status', async () => {
      const project = await createProject({
        name: 'Task Test',
        description: 'Test',
        visibility: 'private',
        owner: '0x',
      })

      const task = await createTask({
        projectId: project.id,
        title: 'Update Test',
      })

      const updated = await updateTask(task.id, { status: 'completed' })
      expect(updated?.status).toBe('completed')
    })
  })

  describe('Issues', () => {
    it('should create issues with sequential numbers per repo', async () => {
      const issue1 = await createIssue({
        repo: 'test/repo1',
        title: 'Issue 1',
        body: 'First issue',
        author: '0xauthor',
      })

      const issue2 = await createIssue({
        repo: 'test/repo1',
        title: 'Issue 2',
        body: 'Second issue',
        author: '0xauthor',
      })

      expect(issue2.number).toBe(issue1.number + 1)
    })

    it('should list issues with filters', async () => {
      const result = await listIssues({ status: 'open' })
      expect(result.issues.length).toBeGreaterThan(0)
    })
  })

  describe('Pull Requests', () => {
    it('should create pull requests with sequential numbers', async () => {
      const pr1 = await createPullRequest({
        repo: 'test/prrepo',
        title: 'PR 1',
        body: 'First PR',
        sourceBranch: 'feature/1',
        targetBranch: 'main',
        author: '0xauthor',
      })

      const pr2 = await createPullRequest({
        repo: 'test/prrepo',
        title: 'PR 2',
        body: 'Second PR',
        sourceBranch: 'feature/2',
        targetBranch: 'main',
        author: '0xauthor',
      })

      expect(pr2.number).toBe(pr1.number + 1)
    })
  })

  describe('Discussions', () => {
    it('should create and list discussions', async () => {
      const discussion = await createDiscussion({
        title: 'Test Discussion',
        content: 'Discussion content',
        category: 'general',
        tags: ['test'],
        author: '0xauthor',
        authorName: 'Author',
        authorAvatar: 'https://example.com/avatar.png',
      })

      expect(discussion.id).toStartWith('discussion-')
      expect(discussion.category).toBe('general')

      const result = await listDiscussions({ category: 'general' })
      expect(result.discussions.length).toBeGreaterThan(0)
    })
  })

  describe('CI Runs', () => {
    it('should create and retrieve CI runs', async () => {
      const run = await createCIRun({
        workflow: 'test-workflow',
        repo: 'test/ci-repo',
        branch: 'main',
        commitSha: 'abc123',
        commitMessage: 'Test commit',
        author: '0xauthor',
      })

      expect(run.id).toStartWith('run-')
      expect(run.status).toBe('queued')

      const retrieved = await getCIRun(run.id)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.workflow).toBe('test-workflow')
    })
  })

  describe('Agents', () => {
    it('should create and list agents', async () => {
      const agentId = `0xagent_${Date.now()}`

      const agent = await createAgent({
        agentId,
        owner: '0xowner',
        name: 'Test Agent',
        botType: 'compute',
        stateCid: 'ipfs://testcid',
        vaultAddress: '0xvault',
        capabilities: ['compute', 'code'],
        specializations: ['solidity'],
      })

      expect(agent.agent_id).toBe(agentId)
      expect(agent.active).toBe(1)

      const agents = await listAgents({ active: true })
      expect(agents.length).toBeGreaterThan(0)

      const retrieved = await getAgent(agentId)
      expect(retrieved?.name).toBe('Test Agent')
    })
  })

  describe('Containers', () => {
    it('should create containers and instances', async () => {
      const container = await createContainer({
        name: 'test-container',
        tag: 'v1.0.0',
        digest: 'sha256:abc123',
        size: 1024000,
        platform: 'linux/amd64',
        owner: '0xowner',
      })

      expect(container.id).toStartWith('container-')
      expect(container.name).toBe('test-container')

      const instance = await createContainerInstance({
        containerId: container.id,
        name: 'test-instance',
        cpu: '2',
        memory: '4Gi',
        owner: '0xowner',
      })

      expect(instance.status).toBe('building')

      const updated = await updateContainerInstanceStatus(
        instance.id,
        'running',
        'https://test.jejunetwork.org',
      )
      expect(updated).toBe(true)
    })
  })

  describe('Datasets', () => {
    it('should create and list datasets', async () => {
      const dataset = await createDataset({
        name: 'test-dataset',
        organization: 'test-org',
        description: 'Test dataset',
        type: 'code',
        license: 'MIT',
        owner: '0xowner',
      })

      expect(dataset.id).toStartWith('dataset-')
      expect(dataset.status).toBe('processing')

      const datasets = await listDatasets({ type: 'code' })
      expect(datasets.length).toBeGreaterThan(0)
    })
  })

  describe('Models', () => {
    it('should create and retrieve models', async () => {
      const modelName = `test-model-${Date.now()}`
      const org = `test-org-${Date.now()}`

      const model = await createModel({
        name: modelName,
        organization: org,
        description: 'Test model',
        type: 'llm',
        fileUri: 'ipfs://modelcid',
        owner: '0xowner',
      })

      expect(model.id).toBe(`${org}/${modelName}`)
      expect(model.status).toBe('processing')

      const retrieved = await getModel(org, modelName)
      expect(retrieved?.description).toBe('Test model')
    })
  })

  describe('Leaderboard', () => {
    it('should update and retrieve leaderboard entries', async () => {
      // Use a unique address for this test
      const address = `0xleader_${Date.now()}`

      const entry = await updateLeaderboardScore(address, {
        name: 'Leader Test',
        scoreIncrement: 500,
        contributionsIncrement: 10,
      })

      expect(entry.score).toBe(500)
      expect(entry.tier).toBe('bronze')

      // Update to gold tier
      await updateLeaderboardScore(address, { scoreIncrement: 5000 })
      const updated = await getLeaderboardEntry(address)
      expect(updated?.tier).toBe('gold')

      const leaderboard = await getLeaderboard(10)
      expect(leaderboard.length).toBeGreaterThan(0)
    })
  })

  describe('Repo Settings', () => {
    it('should manage repo settings and collaborators', async () => {
      const settings = await upsertRepoSettings('owner', 'repo', {
        description: 'Test repo',
        visibility: 'public',
      })

      expect(settings.description).toBe('Test repo')

      const collaborator = await addRepoCollaborator('owner', 'repo', {
        login: 'dev1',
        avatar: 'https://example.com/avatar.png',
        permission: 'write',
      })

      expect(collaborator.login).toBe('dev1')

      const collaborators = await getRepoCollaborators('owner', 'repo')
      expect(collaborators.length).toBe(1)

      const removed = await removeRepoCollaborator('owner', 'repo', 'dev1')
      expect(removed).toBe(true)

      const afterRemove = await getRepoCollaborators('owner', 'repo')
      expect(afterRemove.length).toBe(0)
    })

    it('should manage webhooks', async () => {
      const webhook = await addRepoWebhook('owner', 'repo', {
        url: 'https://example.com/webhook',
        events: ['push', 'pull_request'],
      })

      expect(webhook.url).toBe('https://example.com/webhook')

      const webhooks = await getRepoWebhooks('owner', 'repo')
      expect(webhooks.length).toBe(1)

      const removed = await removeRepoWebhook(webhook.id)
      expect(removed).toBe(true)
    })
  })

  describe('Package Settings', () => {
    it('should manage package settings and maintainers', async () => {
      const settings = await upsertPackageSettings('@test', 'package', {
        description: 'Test package',
        visibility: 'public',
      })

      expect(settings.description).toBe('Test package')

      const maintainer = await addPackageMaintainer('@test', 'package', {
        login: 'maintainer1',
        avatar: 'https://example.com/avatar.png',
        role: 'maintainer',
      })

      expect(maintainer.login).toBe('maintainer1')

      const maintainers = await getPackageMaintainers('@test', 'package')
      expect(maintainers.length).toBe(1)

      const removed = await removePackageMaintainer(
        '@test',
        'package',
        'maintainer1',
      )
      expect(removed).toBe(true)
    })

    it('should deprecate and undeprecate packages', async () => {
      await upsertPackageSettings('@test', 'deprecatable', {})

      await deprecatePackage(
        '@test',
        'deprecatable',
        'This package is deprecated',
      )
      let settings = await getPackageSettings('@test', 'deprecatable')
      expect(settings?.deprecated).toBe(1)
      expect(settings?.deprecation_message).toBe('This package is deprecated')

      await undeprecatePackage('@test', 'deprecatable')
      settings = await getPackageSettings('@test', 'deprecatable')
      expect(settings?.deprecated).toBe(0)
    })

    it('should manage access tokens', async () => {
      await upsertPackageSettings('@test', 'tokentest', {})

      const { row, plainToken } = await createPackageToken(
        '@test',
        'tokentest',
        {
          tokenName: 'CI Token',
          permissions: ['read', 'write'],
          expiresAt: Date.now() + 86400000,
        },
      )

      expect(row.token_name).toBe('CI Token')
      expect(plainToken).toStartWith('pkg_')

      const revoked = await revokePackageToken(row.id)
      expect(revoked).toBe(true)
    })
  })
})
