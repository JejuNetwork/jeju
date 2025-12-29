/** Database Client Tests */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { unlinkSync } from 'node:fs'
import { join } from 'node:path'
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

// Set test data directory
const TEST_DATA_DIR = join(process.cwd(), 'test-data')
process.env.FACTORY_DATA_DIR = TEST_DATA_DIR

describe('Factory DB Client', () => {
  beforeAll(() => {
    // Clean up any existing test database
    try {
      unlinkSync(join(TEST_DATA_DIR, 'factory.sqlite'))
    } catch {
      // File doesn't exist, that's fine
    }
  })

  afterAll(() => {
    closeDB()
    try {
      unlinkSync(join(TEST_DATA_DIR, 'factory.sqlite'))
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('Bounties', () => {
    it('should create and retrieve a bounty', () => {
      const bounty = createBounty({
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

      const retrieved = getBounty(bounty.id)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.title).toBe('Test Bounty')
    })

    it('should list bounties with filters', () => {
      const result = listBounties({ status: 'open' })
      expect(result.bounties.length).toBeGreaterThan(0)
      expect(result.total).toBeGreaterThan(0)
    })

    it('should update bounty status', () => {
      const bounty = createBounty({
        title: 'Status Test',
        description: 'Test',
        reward: '500',
        currency: 'ETH',
        skills: ['test'],
        deadline: Date.now() + 1000000,
        creator: '0x1234',
      })

      const updated = updateBountyStatus(bounty.id, 'in_progress')
      expect(updated).toBe(true)

      const retrieved = getBounty(bounty.id)
      expect(retrieved?.status).toBe('in_progress')
    })
  })

  describe('Jobs', () => {
    it('should create and retrieve a job', () => {
      const job = createJob({
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

      const retrieved = getJob(job.id)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.company).toBe('Test Corp')
    })

    it('should list jobs with filters', () => {
      const result = listJobs({ remote: true })
      expect(result.jobs.length).toBeGreaterThan(0)
    })
  })

  describe('Projects', () => {
    it('should create a project with tasks', () => {
      const project = createProject({
        name: 'Test Project',
        description: 'A test project',
        visibility: 'public',
        owner: '0xowner',
      })

      expect(project.id).toStartWith('project-')
      expect(project.name).toBe('Test Project')

      const task = createTask({
        projectId: project.id,
        title: 'Task 1',
        assignee: '0xdev',
      })

      expect(task.id).toStartWith('task-')
      expect(task.status).toBe('pending')

      const tasks = getProjectTasks(project.id)
      expect(tasks.length).toBe(1)
    })

    it('should update task status', () => {
      const project = createProject({
        name: 'Task Test',
        description: 'Test',
        visibility: 'private',
        owner: '0x',
      })

      const task = createTask({
        projectId: project.id,
        title: 'Update Test',
      })

      const updated = updateTask(task.id, { status: 'completed' })
      expect(updated?.status).toBe('completed')
    })
  })

  describe('Issues', () => {
    it('should create issues with sequential numbers per repo', () => {
      const issue1 = createIssue({
        repo: 'test/repo1',
        title: 'Issue 1',
        body: 'First issue',
        author: '0xauthor',
      })

      const issue2 = createIssue({
        repo: 'test/repo1',
        title: 'Issue 2',
        body: 'Second issue',
        author: '0xauthor',
      })

      expect(issue2.number).toBe(issue1.number + 1)
    })

    it('should list issues with filters', () => {
      const result = listIssues({ status: 'open' })
      expect(result.issues.length).toBeGreaterThan(0)
    })
  })

  describe('Pull Requests', () => {
    it('should create pull requests with sequential numbers', () => {
      const pr1 = createPullRequest({
        repo: 'test/prrepo',
        title: 'PR 1',
        body: 'First PR',
        sourceBranch: 'feature/1',
        targetBranch: 'main',
        author: '0xauthor',
      })

      const pr2 = createPullRequest({
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
    it('should create and list discussions', () => {
      const discussion = createDiscussion({
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

      const result = listDiscussions({ category: 'general' })
      expect(result.discussions.length).toBeGreaterThan(0)
    })
  })

  describe('CI Runs', () => {
    it('should create and retrieve CI runs', () => {
      const run = createCIRun({
        workflow: 'test-workflow',
        repo: 'test/ci-repo',
        branch: 'main',
        commitSha: 'abc123',
        commitMessage: 'Test commit',
        author: '0xauthor',
      })

      expect(run.id).toStartWith('run-')
      expect(run.status).toBe('queued')

      const retrieved = getCIRun(run.id)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.workflow).toBe('test-workflow')
    })
  })

  describe('Agents', () => {
    it('should create and list agents', () => {
      const agentId = `0xagent_${Date.now()}`

      const agent = createAgent({
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

      const agents = listAgents({ active: true })
      expect(agents.length).toBeGreaterThan(0)

      const retrieved = getAgent(agentId)
      expect(retrieved?.name).toBe('Test Agent')
    })
  })

  describe('Containers', () => {
    it('should create containers and instances', () => {
      const container = createContainer({
        name: 'test-container',
        tag: 'v1.0.0',
        digest: 'sha256:abc123',
        size: 1024000,
        platform: 'linux/amd64',
        owner: '0xowner',
      })

      expect(container.id).toStartWith('container-')
      expect(container.name).toBe('test-container')

      const instance = createContainerInstance({
        containerId: container.id,
        name: 'test-instance',
        cpu: '2',
        memory: '4Gi',
        owner: '0xowner',
      })

      expect(instance.status).toBe('building')

      const updated = updateContainerInstanceStatus(
        instance.id,
        'running',
        'https://test.jejunetwork.org',
      )
      expect(updated).toBe(true)
    })
  })

  describe('Datasets', () => {
    it('should create and list datasets', () => {
      const dataset = createDataset({
        name: 'test-dataset',
        organization: 'test-org',
        description: 'Test dataset',
        type: 'code',
        license: 'MIT',
        owner: '0xowner',
      })

      expect(dataset.id).toStartWith('dataset-')
      expect(dataset.status).toBe('processing')

      const datasets = listDatasets({ type: 'code' })
      expect(datasets.length).toBeGreaterThan(0)
    })
  })

  describe('Models', () => {
    it('should create and retrieve models', () => {
      const modelName = `test-model-${Date.now()}`
      const org = `test-org-${Date.now()}`

      const model = createModel({
        name: modelName,
        organization: org,
        description: 'Test model',
        type: 'llm',
        fileUri: 'ipfs://modelcid',
        owner: '0xowner',
      })

      expect(model.id).toBe(`${org}/${modelName}`)
      expect(model.status).toBe('processing')

      const retrieved = getModel(org, modelName)
      expect(retrieved?.description).toBe('Test model')
    })
  })

  describe('Leaderboard', () => {
    it('should update and retrieve leaderboard entries', () => {
      // Use a unique address for this test
      const address = `0xleader_${Date.now()}`

      const entry = updateLeaderboardScore(address, {
        name: 'Leader Test',
        scoreIncrement: 500,
        contributionsIncrement: 10,
      })

      expect(entry.score).toBe(500)
      expect(entry.tier).toBe('bronze')

      // Update to gold tier
      updateLeaderboardScore(address, { scoreIncrement: 5000 })
      const updated = getLeaderboardEntry(address)
      expect(updated?.tier).toBe('gold')

      const leaderboard = getLeaderboard(10)
      expect(leaderboard.length).toBeGreaterThan(0)
    })
  })

  describe('Repo Settings', () => {
    it('should manage repo settings and collaborators', () => {
      const settings = upsertRepoSettings('owner', 'repo', {
        description: 'Test repo',
        visibility: 'public',
      })

      expect(settings.description).toBe('Test repo')

      const collaborator = addRepoCollaborator('owner', 'repo', {
        login: 'dev1',
        avatar: 'https://example.com/avatar.png',
        permission: 'write',
      })

      expect(collaborator.login).toBe('dev1')

      const collaborators = getRepoCollaborators('owner', 'repo')
      expect(collaborators.length).toBe(1)

      const removed = removeRepoCollaborator('owner', 'repo', 'dev1')
      expect(removed).toBe(true)

      const afterRemove = getRepoCollaborators('owner', 'repo')
      expect(afterRemove.length).toBe(0)
    })

    it('should manage webhooks', () => {
      const webhook = addRepoWebhook('owner', 'repo', {
        url: 'https://example.com/webhook',
        events: ['push', 'pull_request'],
      })

      expect(webhook.url).toBe('https://example.com/webhook')

      const webhooks = getRepoWebhooks('owner', 'repo')
      expect(webhooks.length).toBe(1)

      const removed = removeRepoWebhook(webhook.id)
      expect(removed).toBe(true)
    })
  })

  describe('Package Settings', () => {
    it('should manage package settings and maintainers', () => {
      const settings = upsertPackageSettings('@test', 'package', {
        description: 'Test package',
        visibility: 'public',
      })

      expect(settings.description).toBe('Test package')

      const maintainer = addPackageMaintainer('@test', 'package', {
        login: 'maintainer1',
        avatar: 'https://example.com/avatar.png',
        role: 'maintainer',
      })

      expect(maintainer.login).toBe('maintainer1')

      const maintainers = getPackageMaintainers('@test', 'package')
      expect(maintainers.length).toBe(1)

      const removed = removePackageMaintainer('@test', 'package', 'maintainer1')
      expect(removed).toBe(true)
    })

    it('should deprecate and undeprecate packages', () => {
      upsertPackageSettings('@test', 'deprecatable', {})

      deprecatePackage('@test', 'deprecatable', 'This package is deprecated')
      let settings = getPackageSettings('@test', 'deprecatable')
      expect(settings?.deprecated).toBe(1)
      expect(settings?.deprecation_message).toBe('This package is deprecated')

      undeprecatePackage('@test', 'deprecatable')
      settings = getPackageSettings('@test', 'deprecatable')
      expect(settings?.deprecated).toBe(0)
    })

    it('should manage access tokens', () => {
      upsertPackageSettings('@test', 'tokentest', {})

      const { row, plainToken } = createPackageToken('@test', 'tokentest', {
        tokenName: 'CI Token',
        permissions: ['read', 'write'],
        expiresAt: Date.now() + 86400000,
      })

      expect(row.token_name).toBe('CI Token')
      expect(plainToken).toStartWith('pkg_')

      const revoked = revokePackageToken(row.id)
      expect(revoked).toBe(true)
    })
  })
})
