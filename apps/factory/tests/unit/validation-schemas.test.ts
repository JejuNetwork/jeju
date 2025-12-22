/**
 * Unit tests for Zod validation schemas
 * Tests complex validation logic including regex patterns, refinements, and transforms
 */

import { describe, expect, test } from 'bun:test';
import {
  paginationSchema,
  bountyStatusSchema,
  bountyMilestoneSchema,
  createBountySchema,
  salarySchema,
  createJobSchema,
  createProjectSchema,
  createRepositorySchema,
  packageMetadataSchema,
  createModelSchema,
  createContainerSchema,
  createDatasetSchema,
  createAgentSchema,
  createIssueSchema,
  createPullRequestSchema,
  createFeedPostSchema,
  getFeedQuerySchema,
  createCIRunSchema,
} from '../../lib/validation/schemas';

describe('Pagination Schema', () => {
  test('accepts valid pagination params', () => {
    const result = paginationSchema.safeParse({ page: 1, limit: 20 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(20);
    }
  });

  test('uses defaults for missing params', () => {
    const result = paginationSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(20);
    }
  });

  test('coerces string numbers to integers', () => {
    const result = paginationSchema.safeParse({ page: '5', limit: '50' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(5);
      expect(result.data.limit).toBe(50);
    }
  });

  test('rejects page less than 1', () => {
    const result = paginationSchema.safeParse({ page: 0, limit: 20 });
    expect(result.success).toBe(false);
  });

  test('rejects limit greater than 100', () => {
    const result = paginationSchema.safeParse({ page: 1, limit: 101 });
    expect(result.success).toBe(false);
  });

  test('rejects negative limit', () => {
    const result = paginationSchema.safeParse({ page: 1, limit: -1 });
    expect(result.success).toBe(false);
  });
});

describe('Bounty Status Schema', () => {
  test('accepts valid statuses', () => {
    const statuses = ['open', 'in_progress', 'review', 'completed', 'cancelled'];
    statuses.forEach(status => {
      const result = bountyStatusSchema.safeParse(status);
      expect(result.success).toBe(true);
    });
  });

  test('rejects invalid status', () => {
    const result = bountyStatusSchema.safeParse('invalid');
    expect(result.success).toBe(false);
  });
});

describe('Bounty Milestone Schema', () => {
  test('accepts valid milestone', () => {
    const result = bountyMilestoneSchema.safeParse({
      name: 'Phase 1',
      description: 'Complete initial setup',
      reward: '100.50',
      currency: 'ETH',
      deadline: 1700000000,
    });
    expect(result.success).toBe(true);
  });

  test('rejects empty name', () => {
    const result = bountyMilestoneSchema.safeParse({
      name: '',
      description: 'Description',
      reward: '100',
      currency: 'ETH',
      deadline: 1700000000,
    });
    expect(result.success).toBe(false);
  });

  test('rejects invalid reward format', () => {
    const result = bountyMilestoneSchema.safeParse({
      name: 'Phase 1',
      description: 'Description',
      reward: 'not-a-number',
      currency: 'ETH',
      deadline: 1700000000,
    });
    expect(result.success).toBe(false);
  });

  test('accepts decimal reward', () => {
    const result = bountyMilestoneSchema.safeParse({
      name: 'Phase 1',
      description: 'Description',
      reward: '1000.12345',
      currency: 'ETH',
      deadline: 1700000000,
    });
    expect(result.success).toBe(true);
  });

  test('rejects negative deadline', () => {
    const result = bountyMilestoneSchema.safeParse({
      name: 'Phase 1',
      description: 'Description',
      reward: '100',
      currency: 'ETH',
      deadline: -1,
    });
    expect(result.success).toBe(false);
  });
});

describe('Create Bounty Schema', () => {
  const validBounty = {
    title: 'Build Feature X',
    description: 'Detailed description of the bounty',
    reward: '1000',
    currency: 'USDC',
    skills: ['typescript', 'react'],
    deadline: 1700000000,
  };

  test('accepts valid bounty', () => {
    const result = createBountySchema.safeParse(validBounty);
    expect(result.success).toBe(true);
  });

  test('rejects title over 200 characters', () => {
    const result = createBountySchema.safeParse({
      ...validBounty,
      title: 'a'.repeat(201),
    });
    expect(result.success).toBe(false);
  });

  test('rejects description under 10 characters', () => {
    const result = createBountySchema.safeParse({
      ...validBounty,
      description: 'short',
    });
    expect(result.success).toBe(false);
  });

  test('rejects empty skills array', () => {
    const result = createBountySchema.safeParse({
      ...validBounty,
      skills: [],
    });
    expect(result.success).toBe(false);
  });

  test('accepts bounty with milestones', () => {
    const result = createBountySchema.safeParse({
      ...validBounty,
      milestones: [
        {
          name: 'Milestone 1',
          description: 'First milestone',
          reward: '500',
          currency: 'USDC',
          deadline: 1690000000,
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe('Salary Schema', () => {
  test('accepts valid salary range', () => {
    const result = salarySchema.safeParse({
      min: 50000,
      max: 100000,
      currency: 'USD',
    });
    expect(result.success).toBe(true);
  });

  test('rejects max less than min', () => {
    const result = salarySchema.safeParse({
      min: 100000,
      max: 50000,
      currency: 'USD',
    });
    expect(result.success).toBe(false);
  });

  test('accepts equal min and max', () => {
    const result = salarySchema.safeParse({
      min: 75000,
      max: 75000,
      currency: 'USD',
    });
    expect(result.success).toBe(true);
  });

  test('rejects negative salary', () => {
    const result = salarySchema.safeParse({
      min: -1000,
      max: 50000,
      currency: 'USD',
    });
    expect(result.success).toBe(false);
  });

  test('accepts optional period', () => {
    const result = salarySchema.safeParse({
      min: 50000,
      max: 100000,
      currency: 'USD',
      period: 'year',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.period).toBe('year');
    }
  });

  test('rejects invalid period', () => {
    const result = salarySchema.safeParse({
      min: 50000,
      max: 100000,
      currency: 'USD',
      period: 'century',
    });
    expect(result.success).toBe(false);
  });
});

describe('Create Repository Schema', () => {
  test('accepts valid repository name', () => {
    const result = createRepositorySchema.safeParse({
      name: 'my-awesome-repo',
      description: 'A test repository',
    });
    expect(result.success).toBe(true);
  });

  test('accepts repository name with dots and underscores', () => {
    const result = createRepositorySchema.safeParse({
      name: 'my_repo.v2',
    });
    expect(result.success).toBe(true);
  });

  test('rejects repository name with spaces', () => {
    const result = createRepositorySchema.safeParse({
      name: 'my repo',
    });
    expect(result.success).toBe(false);
  });

  test('rejects repository name with special characters', () => {
    const result = createRepositorySchema.safeParse({
      name: 'my@repo#name',
    });
    expect(result.success).toBe(false);
  });

  test('rejects repository name over 100 characters', () => {
    const result = createRepositorySchema.safeParse({
      name: 'a'.repeat(101),
    });
    expect(result.success).toBe(false);
  });

  test('defaults isPrivate to false', () => {
    const result = createRepositorySchema.safeParse({
      name: 'my-repo',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isPrivate).toBe(false);
    }
  });
});

describe('Package Metadata Schema', () => {
  test('accepts valid scoped package name', () => {
    const result = packageMetadataSchema.safeParse({
      name: '@jejunetwork/sdk',
      version: '1.0.0',
      author: 'Jeju Team',
      license: 'MIT',
    });
    expect(result.success).toBe(true);
  });

  test('accepts valid unscoped package name', () => {
    const result = packageMetadataSchema.safeParse({
      name: 'my-package',
      version: '2.1.0',
      author: 'Dev',
      license: 'Apache-2.0',
    });
    expect(result.success).toBe(true);
  });

  test('accepts semver with prerelease tag', () => {
    const result = packageMetadataSchema.safeParse({
      name: 'test-pkg',
      version: '1.0.0-beta.1',
      author: 'Dev',
      license: 'MIT',
    });
    expect(result.success).toBe(true);
  });

  test('rejects invalid version format', () => {
    const result = packageMetadataSchema.safeParse({
      name: 'test-pkg',
      version: 'v1.0.0', // Leading v is invalid
      author: 'Dev',
      license: 'MIT',
    });
    expect(result.success).toBe(false);
  });

  test('rejects package name with uppercase', () => {
    const result = packageMetadataSchema.safeParse({
      name: 'MyPackage',
      version: '1.0.0',
      author: 'Dev',
      license: 'MIT',
    });
    expect(result.success).toBe(false);
  });

  test('rejects package name over 214 characters', () => {
    const result = packageMetadataSchema.safeParse({
      name: 'a'.repeat(215),
      version: '1.0.0',
      author: 'Dev',
      license: 'MIT',
    });
    expect(result.success).toBe(false);
  });

  test('accepts package with dependencies', () => {
    const result = packageMetadataSchema.safeParse({
      name: 'test-pkg',
      version: '1.0.0',
      author: 'Dev',
      license: 'MIT',
      dependencies: {
        'lodash': '^4.17.21',
        'react': '18.2.0',
      },
    });
    expect(result.success).toBe(true);
  });
});

describe('Create Model Schema', () => {
  test('accepts valid model', () => {
    const result = createModelSchema.safeParse({
      name: 'my-model-v1',
      organization: 'jeju-labs',
      description: 'A fine-tuned language model for code generation',
      type: 'llm',
    });
    expect(result.success).toBe(true);
  });

  test('rejects model name with spaces', () => {
    const result = createModelSchema.safeParse({
      name: 'my model',
      organization: 'jeju-labs',
      description: 'Description here',
      type: 'llm',
    });
    expect(result.success).toBe(false);
  });

  test('accepts all valid model types', () => {
    const types = ['llm', 'embedding', 'image', 'audio', 'multimodal', 'code'];
    types.forEach(type => {
      const result = createModelSchema.safeParse({
        name: 'test-model',
        organization: 'org',
        description: 'Description here for the model',
        type,
      });
      expect(result.success).toBe(true);
    });
  });

  test('rejects invalid model type', () => {
    const result = createModelSchema.safeParse({
      name: 'test-model',
      organization: 'org',
      description: 'Description here',
      type: 'invalid-type',
    });
    expect(result.success).toBe(false);
  });
});

describe('Create Container Schema', () => {
  test('accepts valid container', () => {
    const result = createContainerSchema.safeParse({
      name: 'jeju/worker',
      tag: 'v1.0.0',
      digest: 'sha256:' + 'a'.repeat(64),
      size: 1024000,
      platform: 'linux/amd64',
    });
    expect(result.success).toBe(true);
  });

  test('accepts nested container name', () => {
    const result = createContainerSchema.safeParse({
      name: 'registry/org/repo/image',
      tag: 'latest',
      digest: 'sha256:' + 'b'.repeat(64),
      size: 512000,
      platform: 'linux/arm64',
    });
    expect(result.success).toBe(true);
  });

  test('rejects invalid container name with uppercase', () => {
    const result = createContainerSchema.safeParse({
      name: 'Jeju/Worker',
      tag: 'v1.0.0',
      digest: 'sha256:' + 'a'.repeat(64),
      size: 1024000,
      platform: 'linux/amd64',
    });
    expect(result.success).toBe(false);
  });

  test('rejects invalid digest format', () => {
    const result = createContainerSchema.safeParse({
      name: 'jeju/worker',
      tag: 'v1.0.0',
      digest: 'md5:' + 'a'.repeat(32), // Wrong algorithm
      size: 1024000,
      platform: 'linux/amd64',
    });
    expect(result.success).toBe(false);
  });

  test('rejects digest with wrong length', () => {
    const result = createContainerSchema.safeParse({
      name: 'jeju/worker',
      tag: 'v1.0.0',
      digest: 'sha256:' + 'a'.repeat(32), // Too short
      size: 1024000,
      platform: 'linux/amd64',
    });
    expect(result.success).toBe(false);
  });

  test('rejects negative size', () => {
    const result = createContainerSchema.safeParse({
      name: 'jeju/worker',
      tag: 'v1.0.0',
      digest: 'sha256:' + 'a'.repeat(64),
      size: -100,
      platform: 'linux/amd64',
    });
    expect(result.success).toBe(false);
  });

  test('accepts container with labels', () => {
    const result = createContainerSchema.safeParse({
      name: 'jeju/worker',
      tag: 'v1.0.0',
      digest: 'sha256:' + 'a'.repeat(64),
      size: 1024000,
      platform: 'linux/amd64',
      labels: {
        'org.opencontainers.image.version': '1.0.0',
        'maintainer': 'team@jeju.network',
      },
    });
    expect(result.success).toBe(true);
  });
});

describe('Create Dataset Schema', () => {
  test('accepts valid dataset', () => {
    const result = createDatasetSchema.safeParse({
      name: 'code-dataset-v1',
      organization: 'jeju-labs',
      description: 'A dataset for training code models',
      type: 'code',
      license: 'CC-BY-4.0',
    });
    expect(result.success).toBe(true);
  });

  test('accepts all valid dataset types', () => {
    const types = ['text', 'code', 'image', 'audio', 'multimodal', 'tabular'];
    types.forEach(type => {
      const result = createDatasetSchema.safeParse({
        name: 'test-dataset',
        organization: 'org',
        description: 'A test dataset description',
        type,
        license: 'MIT',
      });
      expect(result.success).toBe(true);
    });
  });
});

describe('Create Agent Schema', () => {
  test('accepts valid agent', () => {
    const result = createAgentSchema.safeParse({
      name: 'My AI Agent',
      type: 'ai_agent',
      config: { temperature: 0.7, maxTokens: 1000 },
    });
    expect(result.success).toBe(true);
  });

  test('accepts trading bot type', () => {
    const result = createAgentSchema.safeParse({
      name: 'Trading Bot',
      type: 'trading_bot',
      config: { strategy: 'dca', interval: '1h' },
    });
    expect(result.success).toBe(true);
  });

  test('accepts org tool type', () => {
    const result = createAgentSchema.safeParse({
      name: 'Org Helper',
      type: 'org_tool',
      config: { permissions: ['read', 'write'] },
    });
    expect(result.success).toBe(true);
  });

  test('rejects invalid agent type', () => {
    const result = createAgentSchema.safeParse({
      name: 'Test Agent',
      type: 'invalid_type',
      config: {},
    });
    expect(result.success).toBe(false);
  });
});

describe('Create Issue Schema', () => {
  test('accepts valid issue', () => {
    const result = createIssueSchema.safeParse({
      repo: 'jeju/sdk',
      title: 'Bug in authentication flow',
      body: 'When trying to authenticate, the token expires too quickly.',
    });
    expect(result.success).toBe(true);
  });

  test('rejects body under 10 characters', () => {
    const result = createIssueSchema.safeParse({
      repo: 'jeju/sdk',
      title: 'Short issue',
      body: 'Too short',
    });
    expect(result.success).toBe(false);
  });

  test('accepts issue with labels', () => {
    const result = createIssueSchema.safeParse({
      repo: 'jeju/sdk',
      title: 'Feature request',
      body: 'Please add this new feature to the SDK',
      labels: ['enhancement', 'good first issue'],
    });
    expect(result.success).toBe(true);
  });
});

describe('Create Pull Request Schema', () => {
  test('accepts valid pull request', () => {
    const result = createPullRequestSchema.safeParse({
      repo: 'jeju/sdk',
      title: 'Add new feature',
      body: 'This PR adds a new authentication method',
      sourceBranch: 'feature/auth',
      targetBranch: 'main',
    });
    expect(result.success).toBe(true);
  });

  test('defaults isDraft to false', () => {
    const result = createPullRequestSchema.safeParse({
      repo: 'jeju/sdk',
      title: 'Add feature',
      body: 'Description of the changes made',
      sourceBranch: 'feature',
      targetBranch: 'main',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isDraft).toBe(false);
    }
  });

  test('accepts draft PR', () => {
    const result = createPullRequestSchema.safeParse({
      repo: 'jeju/sdk',
      title: 'WIP: New feature',
      body: 'Work in progress on new feature',
      sourceBranch: 'wip/feature',
      targetBranch: 'develop',
      isDraft: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isDraft).toBe(true);
    }
  });
});

describe('Create Feed Post Schema', () => {
  test('accepts valid post', () => {
    const result = createFeedPostSchema.safeParse({
      text: 'Hello, Factory world!',
    });
    expect(result.success).toBe(true);
  });

  test('rejects empty text', () => {
    const result = createFeedPostSchema.safeParse({
      text: '',
    });
    expect(result.success).toBe(false);
  });

  test('rejects text over 320 characters', () => {
    const result = createFeedPostSchema.safeParse({
      text: 'a'.repeat(321),
    });
    expect(result.success).toBe(false);
  });

  test('accepts post with embeds', () => {
    const result = createFeedPostSchema.safeParse({
      text: 'Check out this link!',
      embeds: [{ url: 'https://factory.jeju.network' }],
    });
    expect(result.success).toBe(true);
  });

  test('rejects invalid embed URL', () => {
    const result = createFeedPostSchema.safeParse({
      text: 'Bad link',
      embeds: [{ url: 'not-a-url' }],
    });
    expect(result.success).toBe(false);
  });

  test('accepts reply post', () => {
    const result = createFeedPostSchema.safeParse({
      text: 'This is a reply',
      parentHash: '0x1234567890abcdef',
    });
    expect(result.success).toBe(true);
  });
});

describe('Get Feed Query Schema', () => {
  test('transforms limit string to number', () => {
    const result = getFeedQuerySchema.safeParse({ limit: '50' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(50);
    }
  });

  test('uses default limit of 20', () => {
    const result = getFeedQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
    }
  });

  test('accepts channel filter', () => {
    const result = getFeedQuerySchema.safeParse({ channel: 'factory' });
    expect(result.success).toBe(true);
  });
});

describe('Create CI Run Schema', () => {
  test('accepts valid CI run', () => {
    const result = createCIRunSchema.safeParse({
      repo: 'jeju/sdk',
      workflow: 'build-and-test',
      branch: 'main',
    });
    expect(result.success).toBe(true);
  });

  test('accepts CI run with inputs', () => {
    const result = createCIRunSchema.safeParse({
      repo: 'jeju/sdk',
      workflow: 'deploy',
      branch: 'release/v1.0',
      inputs: {
        environment: 'production',
        dry_run: 'false',
      },
    });
    expect(result.success).toBe(true);
  });

  test('rejects empty repo', () => {
    const result = createCIRunSchema.safeParse({
      repo: '',
      workflow: 'build',
      branch: 'main',
    });
    expect(result.success).toBe(false);
  });
});
