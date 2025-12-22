/**
 * Model Registry Routes - HuggingFace-compatible API
 * 
 * Compatible with:
 * - huggingface_hub Python library
 * - transformers.from_pretrained()
 * - Custom jeju-hub CLI
 */

import { Hono } from 'hono';
import { createHash } from 'crypto';
import type { Address, Hex } from 'viem';
import { keccak256, encodePacked } from 'viem';
import type { BackendManager } from '../../storage/backends';
import { validateBody, validateParams, validateQuery, validateHeaders, jejuAddressHeaderSchema, modelParamsSchema, modelCreateRequestSchema, modelVersionRequestSchema, lfsBatchRequestSchema, modelInferenceRequestSchema, z } from '../../shared';

// Query schemas for HuggingFace-compatible API
const hfModelsQuerySchema = z.object({
  search: z.string().optional(),
  author: z.string().optional(),
  filter: z.string().optional(),
  sort: z.enum(['downloads', 'likes', 'modified', 'created']).default('downloads'),
  direction: z.enum(['-1', '1']).default('-1'),
  limit: z.coerce.number().int().positive().max(100).default(30),
  offset: z.coerce.number().int().nonnegative().default(0),
});

const nativeModelsQuerySchema = z.object({
  type: z.string().optional(),
  org: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

// ============================================================================
// Types
// ============================================================================

export enum ModelType {
  LLM = 0,
  VISION = 1,
  AUDIO = 2,
  MULTIMODAL = 3,
  EMBEDDING = 4,
  CLASSIFIER = 5,
  REGRESSION = 6,
  RL = 7,
  OTHER = 8,
}

export enum LicenseType {
  MIT = 0,
  APACHE_2 = 1,
  GPL_3 = 2,
  CC_BY_4 = 3,
  CC_BY_NC_4 = 4,
  LLAMA_2 = 5,
  CUSTOM = 6,
  PROPRIETARY = 7,
}

export enum AccessLevel {
  PUBLIC = 0,
  GATED = 1,
  ENCRYPTED = 2,
}

export interface Model {
  modelId: string;
  name: string;
  organization: string;
  owner: string;
  modelType: ModelType;
  license: LicenseType;
  licenseUri: string;
  accessLevel: AccessLevel;
  description: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  isPublic: boolean;
  isVerified: boolean;
}

export interface ModelVersion {
  versionId: string;
  modelId: string;
  version: string;
  weightsUri: string;
  weightsHash: string;
  weightsSize: number;
  configUri: string;
  tokenizerUri: string;
  parameterCount: number;
  precision: string;
  publishedAt: number;
  isLatest: boolean;
}

export interface ModelFile {
  filename: string;
  cid: string;
  size: number;
  sha256: string;
  type: 'weights' | 'config' | 'tokenizer' | 'other';
}

interface ModelsContext {
  backend: BackendManager;
  rpcUrl: string;
  modelRegistryAddress: Address;
  privateKey?: Hex;
}

// In-memory store for development (production would use on-chain + indexer)
const modelsStore = new Map<string, Model>();
const versionsStore = new Map<string, ModelVersion[]>();
const filesStore = new Map<string, ModelFile[]>();
const metricsStore = new Map<string, { downloads: number; stars: number; inferences: number }>();
const starredStore = new Map<string, Set<string>>();

// ============================================================================
// Router
// ============================================================================

export function createModelsRouter(ctx: ModelsContext): Hono {
  const router = new Hono();
  const { backend } = ctx;

  // Health check
  router.get('/health', (c) => c.json({ service: 'dws-models', status: 'healthy' }));

  // ============================================================================
  // HuggingFace Hub API Compatibility
  // ============================================================================

  // List models (HF Hub compatible)
  router.get('/api/models', async (c) => {
    const { search, author, filter, sort, direction, limit, offset } = validateQuery(hfModelsQuerySchema, c);

    let models = Array.from(modelsStore.values());

    // Filter by author/organization
    if (author) {
      models = models.filter(m => m.organization.toLowerCase() === author.toLowerCase());
    }

    // Filter by search term
    if (search) {
      const searchLower = search.toLowerCase();
      models = models.filter(m => 
        m.name.toLowerCase().includes(searchLower) ||
        m.description.toLowerCase().includes(searchLower) ||
        m.tags.some(t => t.toLowerCase().includes(searchLower))
      );
    }

    // Filter by type/tags
    if (filter) {
      const filters = filter.split(',');
      models = models.filter(m => 
        filters.some(f => m.tags.includes(f) || ModelType[m.modelType].toLowerCase() === f.toLowerCase())
      );
    }

    // Sort
    models.sort((a, b) => {
      const metricsA = metricsStore.get(a.modelId) || { downloads: 0, stars: 0, inferences: 0 };
      const metricsB = metricsStore.get(b.modelId) || { downloads: 0, stars: 0, inferences: 0 };
      
      let diff = 0;
      if (sort === 'downloads') diff = metricsB.downloads - metricsA.downloads;
      else if (sort === 'likes') diff = metricsB.stars - metricsA.stars;
      else if (sort === 'modified') diff = b.updatedAt - a.updatedAt;
      else if (sort === 'created') diff = b.createdAt - a.createdAt;
      
      return direction === '-1' ? diff : -diff;
    });

    // Paginate
    const total = models.length;
    models = models.slice(offset, offset + limit);

    // Convert to HF format
    const result = models.map(m => {
      const metrics = metricsStore.get(m.modelId) || { downloads: 0, stars: 0, inferences: 0 };
      return {
        _id: m.modelId,
        id: `${m.organization}/${m.name}`,
        modelId: `${m.organization}/${m.name}`,
        author: m.organization,
        sha: m.modelId.slice(0, 40),
        lastModified: new Date(m.updatedAt).toISOString(),
        private: m.accessLevel !== AccessLevel.PUBLIC,
        gated: m.accessLevel === AccessLevel.GATED,
        disabled: false,
        tags: m.tags,
        pipeline_tag: getPipelineTag(m.modelType),
        downloads: metrics.downloads,
        likes: metrics.stars,
        library_name: 'transformers',
        createdAt: new Date(m.createdAt).toISOString(),
      };
    });

    return c.json(result, 200, {
      'X-Total-Count': total.toString(),
    });
  });

  // Get single model (HF Hub compatible)
  router.get('/api/models/:org/:name', async (c) => {
    const { organization: org, model: name } = validateParams(modelParamsSchema.extend({
      org: z.string().min(1),
      name: z.string().min(1),
    }), c);
    const modelKey = `${org}/${name}`;

    const model = findModelByKey(modelKey);
    if (!model) {
      throw new Error('Model not found');
    }

    const versions = versionsStore.get(model.modelId) || [];
    const files = filesStore.get(model.modelId) || [];
    const metrics = metricsStore.get(model.modelId) || { downloads: 0, stars: 0, inferences: 0 };
    const latestVersion = versions.find(v => v.isLatest);

    return c.json({
      _id: model.modelId,
      id: modelKey,
      modelId: modelKey,
      author: model.organization,
      sha: latestVersion?.weightsHash || model.modelId.slice(0, 40),
      lastModified: new Date(model.updatedAt).toISOString(),
      private: model.accessLevel !== AccessLevel.PUBLIC,
      gated: model.accessLevel === AccessLevel.GATED,
      disabled: false,
      tags: model.tags,
      pipeline_tag: getPipelineTag(model.modelType),
      downloads: metrics.downloads,
      likes: metrics.stars,
      library_name: 'transformers',
      createdAt: new Date(model.createdAt).toISOString(),
      config: latestVersion?.configUri ? { model_type: getPipelineTag(model.modelType) } : undefined,
      cardData: {
        language: ['en'],
        license: LicenseType[model.license].toLowerCase().replace('_', '-'),
        tags: model.tags,
        pipeline_tag: getPipelineTag(model.modelType),
      },
      siblings: files.map(f => ({
        rfilename: f.filename,
        size: f.size,
        blobId: f.cid,
      })),
    });
  });

  // Get model files/tree (HF Hub compatible)
  router.get('/api/models/:org/:name/tree/:revision', async (c) => {
    const org = c.req.param('org');
    const name = c.req.param('name');
    // revision param available for future version support
    const path = c.req.query('path') || '';

    const model = findModelByKey(`${org}/${name}`);
    if (!model) {
      throw new Error('Model not found');
    }

    const files = filesStore.get(model.modelId) || [];
    
    // Filter by path prefix if provided
    const filteredFiles = path 
      ? files.filter(f => f.filename.startsWith(path))
      : files;

    return c.json(filteredFiles.map(f => ({
      type: 'file',
      oid: f.cid,
      size: f.size,
      path: f.filename,
      lfs: f.size > 10_000_000 ? { // LFS for files > 10MB
        oid: f.sha256,
        size: f.size,
        pointerSize: 134,
      } : undefined,
    })));
  });

  // Download file (HF Hub compatible - resolve endpoint)
  router.get('/api/models/:org/:name/resolve/:revision/*', async (c) => {
    const org = c.req.param('org');
    const name = c.req.param('name');
    const filename = c.req.url.split('/resolve/')[1]?.split('/').slice(1).join('/');

    const model = findModelByKey(`${org}/${name}`);
    if (!model) {
      throw new Error('Model not found');
    }

    const files = filesStore.get(model.modelId) || [];
    const file = files.find(f => f.filename === filename);
    
    if (!file) {
      return c.json({ error: 'File not found' }, 404);
    }

    // Track download
    const metrics = metricsStore.get(model.modelId) || { downloads: 0, stars: 0, inferences: 0 };
    metrics.downloads++;
    metricsStore.set(model.modelId, metrics);

    // Redirect to storage backend
    const result = await backend.download(file.cid).catch(() => null);
    if (!result) {
      throw new Error('File not available');
    }

    const content = Buffer.isBuffer(result.content) ? new Uint8Array(result.content) : result.content;
    return new Response(content, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Sha256': file.sha256,
        'ETag': `"${file.sha256}"`,
      },
    });
  });

  // LFS batch download (HF Hub compatible)
  router.post('/api/models/:org/:name/info/refs/lfs', async (c) => {
    const org = c.req.param('org');
    const name = c.req.param('name');
    const body = await validateBody(lfsBatchRequestSchema, c);

    const model = findModelByKey(`${org}/${name}`);
    if (!model) {
      throw new Error('Model not found');
    }

    const files = filesStore.get(model.modelId) || [];
    const baseUrl = c.req.header('host');
    if (!baseUrl) {
      throw new Error('Missing host header');
    }
    const protocol = c.req.header('x-forwarded-proto') || 'http';

    return c.json({
      transfer: 'basic',
      objects: body.objects.map(obj => {
        const file = files.find(f => f.sha256 === obj.oid);
        if (!file) {
          return {
            oid: obj.oid,
            size: obj.size,
            error: { code: 404, message: 'Object not found' },
          };
        }
        return {
          oid: obj.oid,
          size: obj.size,
          authenticated: true,
          actions: {
            download: {
              href: `${protocol}://${baseUrl}/storage/download/${file.cid}`,
              expires_in: 3600,
            },
          },
        };
      }),
    });
  });

  // ============================================================================
  // Jeju Native API
  // ============================================================================

  // List all models
  router.get('/', async (c) => {
    const { type, org, q: search, limit, offset } = validateQuery(nativeModelsQuerySchema, c);

    let models = Array.from(modelsStore.values());

    if (type) {
      const typeNum = ModelType[type.toUpperCase() as keyof typeof ModelType];
      if (typeNum !== undefined) {
        models = models.filter(m => m.modelType === typeNum);
      }
    }

    if (org) {
      models = models.filter(m => m.organization.toLowerCase() === org.toLowerCase());
    }

    if (search) {
      const searchLower = search.toLowerCase();
      models = models.filter(m => 
        m.name.toLowerCase().includes(searchLower) ||
        m.description.toLowerCase().includes(searchLower)
      );
    }

    const total = models.length;
    models = models.slice(offset, offset + limit);

    return c.json({
      models: models.map(m => ({
        ...m,
        metrics: metricsStore.get(m.modelId) || { downloads: 0, stars: 0, inferences: 0 },
      })),
      total,
      limit,
      offset,
    });
  });

  // Get model details
  router.get('/:org/:name', async (c) => {
    const org = c.req.param('org');
    const name = c.req.param('name');

    const model = findModelByKey(`${org}/${name}`);
    if (!model) {
      throw new Error('Model not found');
    }

    const versions = versionsStore.get(model.modelId) || [];
    const files = filesStore.get(model.modelId) || [];
    const metrics = metricsStore.get(model.modelId) || { downloads: 0, stars: 0, inferences: 0 };

    return c.json({
      ...model,
      versions,
      files,
      metrics,
    });
  });

  // Create model
  router.post('/', async (c) => {
    const { 'x-jeju-address': owner } = validateHeaders(jejuAddressHeaderSchema, c);
    const body = await validateBody(modelCreateRequestSchema, c);

    // Parse enums if strings
    const modelType = typeof body.modelType === 'string' 
      ? ModelType[body.modelType.toUpperCase() as keyof typeof ModelType] 
      : body.modelType;
    const license = typeof body.license === 'string'
      ? LicenseType[body.license.toUpperCase().replace('-', '_') as keyof typeof LicenseType]
      : (body.license ?? LicenseType.MIT);
    const accessLevel = typeof body.accessLevel === 'string'
      ? AccessLevel[body.accessLevel.toUpperCase() as keyof typeof AccessLevel]
      : (body.accessLevel ?? AccessLevel.PUBLIC);

    const modelId = keccak256(
      encodePacked(['string', 'string', 'address', 'uint256'], 
        [body.organization, body.name, owner, BigInt(Date.now())])
    );

    const model: Model = {
      modelId,
      name: body.name,
      organization: body.organization,
      owner,
      modelType,
      license,
      licenseUri: '',
      accessLevel,
      description: body.description,
      tags: body.tags || [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isPublic: accessLevel === AccessLevel.PUBLIC,
      isVerified: false,
    };

    modelsStore.set(modelId, model);
    metricsStore.set(modelId, { downloads: 0, stars: 0, inferences: 0 });

    return c.json(model, 201);
  });

  // Upload model files
  router.post('/:org/:name/upload', async (c) => {
    const { 'x-jeju-address': owner } = validateHeaders(jejuAddressHeaderSchema, c);
    const org = c.req.param('org');
    const name = c.req.param('name');

    const model = findModelByKey(`${org}/${name}`);
    if (!model) {
      throw new Error('Model not found');
    }

    if (model.owner.toLowerCase() !== owner.toLowerCase()) {
      throw new Error('Not authorized');
    }

    const formData = await c.req.formData();
    const uploadedFiles: ModelFile[] = [];

    for (const [, value] of formData.entries()) {
      if (typeof value !== 'string') {
        const file = value as File;
        const content = Buffer.from(await file.arrayBuffer());
        const sha256 = createHash('sha256').update(content).digest('hex');
        
        const result = await backend.upload(content, { filename: file.name });
        
        const fileType: ModelFile['type'] = 
          file.name.includes('weight') || file.name.endsWith('.safetensors') || file.name.endsWith('.bin') ? 'weights' :
          file.name.includes('config') || file.name.endsWith('.json') ? 'config' :
          file.name.includes('tokenizer') ? 'tokenizer' : 'other';

        uploadedFiles.push({
          filename: file.name,
          cid: result.cid,
          size: content.length,
          sha256,
          type: fileType,
        });
      }
    }

    // Append to existing files
    const existingFiles = filesStore.get(model.modelId) || [];
    filesStore.set(model.modelId, [...existingFiles, ...uploadedFiles]);

    // Update model timestamp
    model.updatedAt = Date.now();
    modelsStore.set(model.modelId, model);

    return c.json({ uploaded: uploadedFiles });
  });

  // Publish version
  router.post('/:org/:name/versions', async (c) => {
    const { 'x-jeju-address': owner } = validateHeaders(jejuAddressHeaderSchema, c);
    const org = c.req.param('org');
    const name = c.req.param('name');

    const model = findModelByKey(`${org}/${name}`);
    if (!model) {
      throw new Error('Model not found');
    }

    if (model.owner.toLowerCase() !== owner.toLowerCase()) {
      throw new Error('Not authorized');
    }

    const body = await validateBody(modelVersionRequestSchema, c);

    const files = filesStore.get(model.modelId) || [];
    const weightsFile = files.find(f => f.type === 'weights');
    const configFile = files.find(f => f.type === 'config');
    const tokenizerFile = files.find(f => f.type === 'tokenizer');

    const versionId = keccak256(
      encodePacked(['bytes32', 'string', 'uint256'], 
        [model.modelId as Hex, body.version, BigInt(Date.now())])
    );

    // Mark previous versions as not latest
    const existingVersions = versionsStore.get(model.modelId) || [];
    existingVersions.forEach(v => v.isLatest = false);

    const version: ModelVersion = {
      versionId,
      modelId: model.modelId,
      version: body.version,
      weightsUri: body.weightsUri || weightsFile?.cid || '',
      weightsHash: weightsFile?.sha256 || '',
      weightsSize: weightsFile?.size || 0,
      configUri: body.configUri || configFile?.cid || '',
      tokenizerUri: body.tokenizerUri || tokenizerFile?.cid || '',
      parameterCount: body.parameterCount || 0,
      precision: body.precision || 'fp16',
      publishedAt: Date.now(),
      isLatest: true,
    };

    versionsStore.set(model.modelId, [...existingVersions, version]);

    // Update model timestamp
    model.updatedAt = Date.now();
    modelsStore.set(model.modelId, model);

    return c.json(version, 201);
  });

  // Get versions
  router.get('/:org/:name/versions', async (c) => {
    const org = c.req.param('org');
    const name = c.req.param('name');

    const model = findModelByKey(`${org}/${name}`);
    if (!model) {
      throw new Error('Model not found');
    }

    const versions = versionsStore.get(model.modelId) || [];
    return c.json(versions);
  });

  // Get files
  router.get('/:org/:name/files', async (c) => {
    const org = c.req.param('org');
    const name = c.req.param('name');

    const model = findModelByKey(`${org}/${name}`);
    if (!model) {
      throw new Error('Model not found');
    }

    const files = filesStore.get(model.modelId) || [];
    return c.json(files);
  });

  // Download file
  router.get('/:org/:name/files/:filename', async (c) => {
    const org = c.req.param('org');
    const name = c.req.param('name');
    const filename = c.req.param('filename');

    const model = findModelByKey(`${org}/${name}`);
    if (!model) {
      throw new Error('Model not found');
    }

    const files = filesStore.get(model.modelId) || [];
    const file = files.find(f => f.filename === filename);
    
    if (!file) {
      return c.json({ error: 'File not found' }, 404);
    }

    // Track download
    const metrics = metricsStore.get(model.modelId) || { downloads: 0, stars: 0, inferences: 0 };
    metrics.downloads++;
    metricsStore.set(model.modelId, metrics);

    const result = await backend.download(file.cid);
    const content = Buffer.isBuffer(result.content) ? new Uint8Array(result.content) : result.content;
    return new Response(content, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  });

  // Star/unstar model
  router.post('/:org/:name/star', async (c) => {
    const { 'x-jeju-address': user } = validateHeaders(jejuAddressHeaderSchema, c);
    const org = c.req.param('org');
    const name = c.req.param('name');

    const model = findModelByKey(`${org}/${name}`);
    if (!model) {
      throw new Error('Model not found');
    }

    const starredUsers = starredStore.get(model.modelId) || new Set();
    const metrics = metricsStore.get(model.modelId) || { downloads: 0, stars: 0, inferences: 0 };

    if (starredUsers.has(user)) {
      starredUsers.delete(user);
      metrics.stars--;
    } else {
      starredUsers.add(user);
      metrics.stars++;
    }

    starredStore.set(model.modelId, starredUsers);
    metricsStore.set(model.modelId, metrics);

    return c.json({ starred: starredUsers.has(user), stars: metrics.stars });
  });

  // Run inference (proxy to endpoint)
  router.post('/:org/:name/inference', async (c) => {
    const org = c.req.param('org');
    const name = c.req.param('name');

    const model = findModelByKey(`${org}/${name}`);
    if (!model) {
      throw new Error('Model not found');
    }

    const body = await validateBody(modelInferenceRequestSchema, c);

    // Track inference
    const metrics = metricsStore.get(model.modelId) || { downloads: 0, stars: 0, inferences: 0 };
    metrics.inferences++;
    metricsStore.set(model.modelId, metrics);

    // In production, would forward to actual inference endpoint
    return c.json({
      status: 'queued',
      message: 'Inference request queued. Endpoint integration pending.',
      input: body,
    });
  });

  return router;
}

// ============================================================================
// Helpers
// ============================================================================

function findModelByKey(key: string): Model | null {
  for (const model of modelsStore.values()) {
    if (`${model.organization}/${model.name}` === key) {
      return model;
    }
  }
  return null;
}

function getPipelineTag(modelType: ModelType): string {
  const mapping: Record<ModelType, string> = {
    [ModelType.LLM]: 'text-generation',
    [ModelType.VISION]: 'image-classification',
    [ModelType.AUDIO]: 'automatic-speech-recognition',
    [ModelType.MULTIMODAL]: 'image-text-to-text',
    [ModelType.EMBEDDING]: 'feature-extraction',
    [ModelType.CLASSIFIER]: 'text-classification',
    [ModelType.REGRESSION]: 'tabular-regression',
    [ModelType.RL]: 'reinforcement-learning',
    [ModelType.OTHER]: 'other',
  };
  return mapping[modelType] || 'other';
}

