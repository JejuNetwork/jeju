/** Factory Database Repositories */

import type { Address } from 'viem'
import {
  AssigneesSchema,
  expectJson,
  LabelsSchema,
  MilestonesSchema,
  ReviewersSchema,
  SkillsSchema,
} from '../schemas'
import {
  type Agent,
  type Bounty,
  getFactoryDB,
  type Issue,
  type Job,
  type Model,
  type Package,
  type Project,
  type Pull,
  type Repository,
} from './client'

export const BountyRepository = {
  async findAll(
    options: {
      status?: Bounty['status']
      creator?: Address
      skill?: string
      limit?: number
      offset?: number
    } = {},
  ): Promise<Bounty[]> {
    const db = getFactoryDB()
    const conditions: string[] = []
    const params: (string | number)[] = []

    if (options.status) {
      conditions.push(`status = $${params.length + 1}`)
      params.push(options.status)
    }
    if (options.creator) {
      conditions.push(`creator = $${params.length + 1}`)
      params.push(options.creator)
    }

    const where = conditions.length > 0 ? conditions.join(' AND ') : '1=1'
    const rows = await db.select<Bounty>('bounties', {
      where,
      whereParams: params,
      orderBy: 'created_at DESC',
      limit: options.limit ?? 20,
      offset: options.offset ?? 0,
    })

    return rows.map((row) => ({
      ...row,
      skills:
        typeof row.skills === 'string'
          ? expectJson(SkillsSchema, row.skills, 'bounty skills')
          : row.skills,
      milestones: row.milestones
        ? typeof row.milestones === 'string'
          ? expectJson(MilestonesSchema, row.milestones, 'bounty milestones')
          : row.milestones
        : undefined,
    }))
  },

  async findById(id: string): Promise<Bounty | null> {
    const db = getFactoryDB()
    const row = await db.selectOne<Bounty>('bounties', 'id = $1', [id])
    if (!row) return null

    return {
      ...row,
      skills:
        typeof row.skills === 'string'
          ? expectJson(SkillsSchema, row.skills, 'bounty skills')
          : row.skills,
      milestones: row.milestones
        ? typeof row.milestones === 'string'
          ? expectJson(MilestonesSchema, row.milestones, 'bounty milestones')
          : row.milestones
        : undefined,
    }
  },

  async create(
    bounty: Omit<
      Bounty,
      'id' | 'submissions_count' | 'created_at' | 'updated_at'
    >,
  ): Promise<Bounty> {
    const db = getFactoryDB()
    const now = Date.now()
    const id = crypto.randomUUID()

    const data = {
      id,
      ...bounty,
      skills: JSON.stringify(bounty.skills),
      milestones: bounty.milestones ? JSON.stringify(bounty.milestones) : null,
      submissions_count: 0,
      created_at: now,
      updated_at: now,
    }

    await db.insert('bounties', data)
    return {
      ...bounty,
      id,
      submissions_count: 0,
      created_at: now,
      updated_at: now,
    }
  },

  async update(id: string, data: Partial<Bounty>): Promise<void> {
    const db = getFactoryDB()
    const updateData: Record<string, string | number | null> = {
      updated_at: Date.now(),
    }

    if (data.title) updateData.title = data.title
    if (data.description) updateData.description = data.description
    if (data.status) updateData.status = data.status
    if (data.skills) updateData.skills = JSON.stringify(data.skills)
    if (data.milestones) updateData.milestones = JSON.stringify(data.milestones)

    await db.update(
      'bounties',
      updateData,
      `id = $${Object.keys(updateData).length + 1}`,
      [id],
    )
  },

  async count(status?: Bounty['status']): Promise<number> {
    const db = getFactoryDB()
    if (status) {
      return db.count('bounties', 'status = $1', [status])
    }
    return db.count('bounties')
  },
}

export const JobRepository = {
  async findAll(
    options: {
      status?: Job['status']
      poster?: Address
      job_type?: Job['job_type']
      remote?: boolean
      limit?: number
      offset?: number
    } = {},
  ): Promise<Job[]> {
    const db = getFactoryDB()
    const conditions: string[] = []
    const params: (string | number | boolean)[] = []

    if (options.status) {
      conditions.push(`status = $${params.length + 1}`)
      params.push(options.status)
    }
    if (options.poster) {
      conditions.push(`poster = $${params.length + 1}`)
      params.push(options.poster)
    }
    if (options.job_type) {
      conditions.push(`job_type = $${params.length + 1}`)
      params.push(options.job_type)
    }
    if (options.remote !== undefined) {
      conditions.push(`remote = $${params.length + 1}`)
      params.push(options.remote)
    }

    const where = conditions.length > 0 ? conditions.join(' AND ') : '1=1'
    const rows = await db.select<Job>('jobs', {
      where,
      whereParams: params,
      orderBy: 'created_at DESC',
      limit: options.limit ?? 20,
      offset: options.offset ?? 0,
    })

    return rows.map((row) => ({
      ...row,
      skills:
        typeof row.skills === 'string'
          ? expectJson(SkillsSchema, row.skills, 'job skills')
          : row.skills,
    }))
  },

  async findById(id: string): Promise<Job | null> {
    const db = getFactoryDB()
    const row = await db.selectOne<Job>('jobs', 'id = $1', [id])
    if (!row) return null

    return {
      ...row,
      skills:
        typeof row.skills === 'string'
          ? expectJson(SkillsSchema, row.skills, 'job skills')
          : row.skills,
    }
  },

  async create(
    job: Omit<Job, 'id' | 'created_at' | 'updated_at'>,
  ): Promise<Job> {
    const db = getFactoryDB()
    const now = Date.now()
    const id = crypto.randomUUID()

    const data = {
      id,
      ...job,
      skills: JSON.stringify(job.skills),
      created_at: now,
      updated_at: now,
    }

    await db.insert('jobs', data)
    return { ...job, id, created_at: now, updated_at: now }
  },

  async update(id: string, data: Partial<Job>): Promise<void> {
    const db = getFactoryDB()
    const updateData: Record<string, string | number | boolean | null> = {
      updated_at: Date.now(),
    }

    if (data.title) updateData.title = data.title
    if (data.description) updateData.description = data.description
    if (data.status) updateData.status = data.status
    if (data.skills) updateData.skills = JSON.stringify(data.skills)

    await db.update(
      'jobs',
      updateData,
      `id = $${Object.keys(updateData).length + 1}`,
      [id],
    )
  },
}

export const ProjectRepository = {
  async findAll(
    options: {
      owner?: Address
      status?: Project['status']
      visibility?: Project['visibility']
      limit?: number
      offset?: number
    } = {},
  ): Promise<Project[]> {
    const db = getFactoryDB()
    const conditions: string[] = []
    const params: string[] = []

    if (options.owner) {
      conditions.push(`owner = $${params.length + 1}`)
      params.push(options.owner)
    }
    if (options.status) {
      conditions.push(`status = $${params.length + 1}`)
      params.push(options.status)
    }
    if (options.visibility) {
      conditions.push(`visibility = $${params.length + 1}`)
      params.push(options.visibility)
    }

    const where = conditions.length > 0 ? conditions.join(' AND ') : '1=1'
    return db.select<Project>('projects', {
      where,
      whereParams: params,
      orderBy: 'created_at DESC',
      limit: options.limit ?? 20,
      offset: options.offset ?? 0,
    })
  },

  async findById(id: string): Promise<Project | null> {
    const db = getFactoryDB()
    return db.selectOne<Project>('projects', 'id = $1', [id])
  },

  async create(
    project: Omit<Project, 'id' | 'created_at' | 'updated_at'>,
  ): Promise<Project> {
    const db = getFactoryDB()
    const now = Date.now()
    const id = crypto.randomUUID()

    await db.insert('projects', {
      id,
      ...project,
      created_at: now,
      updated_at: now,
    })
    return { ...project, id, created_at: now, updated_at: now }
  },

  async update(id: string, data: Partial<Project>): Promise<void> {
    const db = getFactoryDB()
    const updateData: Record<string, string | null> = {
      updated_at: Date.now().toString(),
    }

    if (data.name) updateData.name = data.name
    if (data.description !== undefined)
      updateData.description = data.description
    if (data.status) updateData.status = data.status
    if (data.visibility) updateData.visibility = data.visibility

    await db.update(
      'projects',
      updateData,
      `id = $${Object.keys(updateData).length + 1}`,
      [id],
    )
  },
}

export const RepositoryRepo = {
  async findAll(
    options: { owner?: Address; limit?: number; offset?: number } = {},
  ): Promise<Repository[]> {
    const db = getFactoryDB()
    const conditions: string[] = []
    const params: string[] = []

    if (options.owner) {
      conditions.push(`owner = $${params.length + 1}`)
      params.push(options.owner)
    }

    const where = conditions.length > 0 ? conditions.join(' AND ') : '1=1'
    return db.select<Repository>('repositories', {
      where,
      whereParams: params,
      orderBy: 'created_at DESC',
      limit: options.limit ?? 20,
      offset: options.offset ?? 0,
    })
  },

  async findByOwnerAndName(
    owner: Address,
    name: string,
  ): Promise<Repository | null> {
    const db = getFactoryDB()
    return db.selectOne<Repository>(
      'repositories',
      'owner = $1 AND name = $2',
      [owner, name],
    )
  },

  async findById(id: string): Promise<Repository | null> {
    const db = getFactoryDB()
    return db.selectOne<Repository>('repositories', 'id = $1', [id])
  },

  async create(
    repo: Omit<
      Repository,
      'id' | 'stars' | 'forks' | 'created_at' | 'updated_at'
    >,
  ): Promise<Repository> {
    const db = getFactoryDB()
    const now = Date.now()
    const id = crypto.randomUUID()

    await db.insert('repositories', {
      id,
      ...repo,
      stars: 0,
      forks: 0,
      created_at: now,
      updated_at: now,
    })
    return { ...repo, id, stars: 0, forks: 0, created_at: now, updated_at: now }
  },

  async incrementStars(id: string): Promise<void> {
    const db = getFactoryDB()
    await db.query(
      'UPDATE repositories SET stars = stars + 1, updated_at = $1 WHERE id = $2',
      [Date.now(), id],
    )
  },
}

export const PackageRepository = {
  async findAll(
    options: {
      owner?: Address
      search?: string
      limit?: number
      offset?: number
    } = {},
  ): Promise<Package[]> {
    const db = getFactoryDB()
    const conditions: string[] = []
    const params: string[] = []

    if (options.owner) {
      conditions.push(`owner = $${params.length + 1}`)
      params.push(options.owner)
    }
    if (options.search) {
      conditions.push(`name LIKE $${params.length + 1}`)
      params.push(`%${options.search}%`)
    }

    const where = conditions.length > 0 ? conditions.join(' AND ') : '1=1'
    return db.select<Package>('packages', {
      where,
      whereParams: params,
      orderBy: 'downloads DESC',
      limit: options.limit ?? 20,
      offset: options.offset ?? 0,
    })
  },

  async findByName(name: string): Promise<Package | null> {
    const db = getFactoryDB()
    return db.selectOne<Package>('packages', 'name = $1', [name])
  },

  async create(
    pkg: Omit<Package, 'id' | 'downloads' | 'created_at' | 'updated_at'>,
  ): Promise<Package> {
    const db = getFactoryDB()
    const now = Date.now()
    const id = crypto.randomUUID()

    await db.insert('packages', {
      id,
      ...pkg,
      downloads: 0,
      created_at: now,
      updated_at: now,
    })
    return { ...pkg, id, downloads: 0, created_at: now, updated_at: now }
  },

  async incrementDownloads(name: string): Promise<void> {
    const db = getFactoryDB()
    await db.query(
      'UPDATE packages SET downloads = downloads + 1, updated_at = $1 WHERE name = $2',
      [Date.now(), name],
    )
  },
}

export const ModelRepository = {
  async findAll(
    options: {
      owner?: Address
      model_type?: string
      search?: string
      limit?: number
      offset?: number
    } = {},
  ): Promise<Model[]> {
    const db = getFactoryDB()
    const conditions: string[] = []
    const params: string[] = []

    if (options.owner) {
      conditions.push(`owner = $${params.length + 1}`)
      params.push(options.owner)
    }
    if (options.model_type) {
      conditions.push(`model_type = $${params.length + 1}`)
      params.push(options.model_type)
    }
    if (options.search) {
      conditions.push(`name LIKE $${params.length + 1}`)
      params.push(`%${options.search}%`)
    }

    const where = conditions.length > 0 ? conditions.join(' AND ') : '1=1'
    return db.select<Model>('models', {
      where,
      whereParams: params,
      orderBy: 'downloads DESC',
      limit: options.limit ?? 20,
      offset: options.offset ?? 0,
    })
  },

  async findById(id: string): Promise<Model | null> {
    const db = getFactoryDB()
    return db.selectOne<Model>('models', 'id = $1', [id])
  },

  async create(
    model: Omit<Model, 'id' | 'downloads' | 'created_at' | 'updated_at'>,
  ): Promise<Model> {
    const db = getFactoryDB()
    const now = Date.now()
    const id = crypto.randomUUID()

    await db.insert('models', {
      id,
      ...model,
      downloads: 0,
      created_at: now,
      updated_at: now,
    })
    return { ...model, id, downloads: 0, created_at: now, updated_at: now }
  },
}

export const AgentRepository = {
  async findAll(
    options: {
      owner?: Address
      agent_type?: Agent['agent_type']
      active?: boolean
      limit?: number
      offset?: number
    } = {},
  ): Promise<Agent[]> {
    const db = getFactoryDB()
    const conditions: string[] = []
    const params: (string | boolean)[] = []

    if (options.owner) {
      conditions.push(`owner = $${params.length + 1}`)
      params.push(options.owner)
    }
    if (options.agent_type) {
      conditions.push(`agent_type = $${params.length + 1}`)
      params.push(options.agent_type)
    }
    if (options.active !== undefined) {
      conditions.push(`active = $${params.length + 1}`)
      params.push(options.active)
    }

    const where = conditions.length > 0 ? conditions.join(' AND ') : '1=1'
    return db.select<Agent>('agents', {
      where,
      whereParams: params,
      orderBy: 'execution_count DESC',
      limit: options.limit ?? 20,
      offset: options.offset ?? 0,
    })
  },

  async findById(id: string): Promise<Agent | null> {
    const db = getFactoryDB()
    return db.selectOne<Agent>('agents', 'id = $1', [id])
  },

  async create(
    agent: Omit<Agent, 'id' | 'execution_count' | 'created_at' | 'updated_at'>,
  ): Promise<Agent> {
    const db = getFactoryDB()
    const now = Date.now()
    const id = crypto.randomUUID()

    await db.insert('agents', {
      id,
      ...agent,
      execution_count: 0,
      created_at: now,
      updated_at: now,
    })
    return {
      ...agent,
      id,
      execution_count: 0,
      created_at: now,
      updated_at: now,
    }
  },

  async incrementExecutions(id: string): Promise<void> {
    const db = getFactoryDB()
    await db.query(
      'UPDATE agents SET execution_count = execution_count + 1, updated_at = $1 WHERE id = $2',
      [Date.now(), id],
    )
  },
}

export const IssueRepository = {
  async findAll(
    options: {
      repo_id?: string
      author?: Address
      status?: Issue['status']
      limit?: number
      offset?: number
    } = {},
  ): Promise<Issue[]> {
    const db = getFactoryDB()
    const conditions: string[] = []
    const params: string[] = []

    if (options.repo_id) {
      conditions.push(`repo_id = $${params.length + 1}`)
      params.push(options.repo_id)
    }
    if (options.author) {
      conditions.push(`author = $${params.length + 1}`)
      params.push(options.author)
    }
    if (options.status) {
      conditions.push(`status = $${params.length + 1}`)
      params.push(options.status)
    }

    const where = conditions.length > 0 ? conditions.join(' AND ') : '1=1'
    const rows = await db.select<Issue>('issues', {
      where,
      whereParams: params,
      orderBy: 'created_at DESC',
      limit: options.limit ?? 20,
      offset: options.offset ?? 0,
    })

    return rows.map((row) => ({
      ...row,
      labels: row.labels
        ? typeof row.labels === 'string'
          ? expectJson(LabelsSchema, row.labels, 'issue labels')
          : row.labels
        : null,
      assignees: row.assignees
        ? typeof row.assignees === 'string'
          ? expectJson(AssigneesSchema, row.assignees, 'issue assignees')
          : row.assignees
        : null,
    }))
  },

  async findByRepoAndNumber(
    repo_id: string,
    number: number,
  ): Promise<Issue | null> {
    const db = getFactoryDB()
    const row = await db.selectOne<Issue>(
      'issues',
      'repo_id = $1 AND number = $2',
      [repo_id, number],
    )
    if (!row) return null

    return {
      ...row,
      labels: row.labels
        ? typeof row.labels === 'string'
          ? expectJson(LabelsSchema, row.labels, 'issue labels')
          : row.labels
        : null,
      assignees: row.assignees
        ? typeof row.assignees === 'string'
          ? expectJson(AssigneesSchema, row.assignees, 'issue assignees')
          : row.assignees
        : null,
    }
  },

  async create(
    issue: Omit<Issue, 'id' | 'created_at' | 'updated_at' | 'closed_at'>,
  ): Promise<Issue> {
    const db = getFactoryDB()
    const now = Date.now()
    const id = crypto.randomUUID()

    await db.insert('issues', {
      id,
      ...issue,
      labels: issue.labels ? JSON.stringify(issue.labels) : null,
      assignees: issue.assignees ? JSON.stringify(issue.assignees) : null,
      created_at: now,
      updated_at: now,
      closed_at: null,
    })
    return { ...issue, id, created_at: now, updated_at: now, closed_at: null }
  },

  async getNextNumber(repo_id: string): Promise<number> {
    const db = getFactoryDB()
    const result = await db.query<{ max_number: number | null }>(
      'SELECT MAX(number) as max_number FROM issues WHERE repo_id = $1',
      [repo_id],
    )
    return (result[0]?.max_number ?? 0) + 1
  },
}

export const PullRepository = {
  async findAll(
    options: {
      repo_id?: string
      author?: Address
      status?: Pull['status']
      limit?: number
      offset?: number
    } = {},
  ): Promise<Pull[]> {
    const db = getFactoryDB()
    const conditions: string[] = []
    const params: string[] = []

    if (options.repo_id) {
      conditions.push(`repo_id = $${params.length + 1}`)
      params.push(options.repo_id)
    }
    if (options.author) {
      conditions.push(`author = $${params.length + 1}`)
      params.push(options.author)
    }
    if (options.status) {
      conditions.push(`status = $${params.length + 1}`)
      params.push(options.status)
    }

    const where = conditions.length > 0 ? conditions.join(' AND ') : '1=1'
    const rows = await db.select<Pull>('pulls', {
      where,
      whereParams: params,
      orderBy: 'created_at DESC',
      limit: options.limit ?? 20,
      offset: options.offset ?? 0,
    })

    return rows.map((row) => ({
      ...row,
      labels: row.labels
        ? typeof row.labels === 'string'
          ? expectJson(LabelsSchema, row.labels, 'pull labels')
          : row.labels
        : null,
      reviewers: row.reviewers
        ? typeof row.reviewers === 'string'
          ? expectJson(ReviewersSchema, row.reviewers, 'pull reviewers')
          : row.reviewers
        : null,
    }))
  },

  async create(
    pull: Omit<
      Pull,
      'id' | 'created_at' | 'updated_at' | 'merged_at' | 'closed_at'
    >,
  ): Promise<Pull> {
    const db = getFactoryDB()
    const now = Date.now()
    const id = crypto.randomUUID()

    await db.insert('pulls', {
      id,
      ...pull,
      labels: pull.labels ? JSON.stringify(pull.labels) : null,
      reviewers: pull.reviewers ? JSON.stringify(pull.reviewers) : null,
      created_at: now,
      updated_at: now,
      merged_at: null,
      closed_at: null,
    })
    return {
      ...pull,
      id,
      created_at: now,
      updated_at: now,
      merged_at: null,
      closed_at: null,
    }
  },

  async getNextNumber(repo_id: string): Promise<number> {
    const db = getFactoryDB()
    const result = await db.query<{ max_number: number | null }>(
      'SELECT MAX(number) as max_number FROM pulls WHERE repo_id = $1',
      [repo_id],
    )
    return (result[0]?.max_number ?? 0) + 1
  },
}
