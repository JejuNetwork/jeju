/**
 * Datasets Registry Routes - HuggingFace-compatible API
 * 
 * Compatible with:
 * - huggingface_hub datasets library
 * - datasets.load_dataset()
 * - Custom jeju-hub CLI
 */

import { Hono } from 'hono';
import { createHash } from 'crypto';
import { keccak256, encodePacked } from 'viem';
import type { BackendManager } from '../../storage/backends';
import { validateBody, validateQuery, validateHeaders, jejuAddressHeaderSchema, datasetCreationSchema, datasetConfigSchema, z } from '../../shared';

// Extended schemas for HuggingFace-compatible API
const hfDatasetsQuerySchema = z.object({
  search: z.string().optional(),
  author: z.string().optional(),
  filter: z.string().optional(),
  sort: z.enum(['downloads', 'modified', 'created']).default('downloads'),
  limit: z.coerce.number().int().positive().max(100).default(30),
  offset: z.coerce.number().int().nonnegative().default(0),
});

const nativeDatasetsQuerySchema = z.object({
  org: z.string().optional(),
  q: z.string().optional(),
  format: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

// ============================================================================
// Types
// ============================================================================

export enum DatasetFormat {
  PARQUET = 0,
  CSV = 1,
  JSON = 2,
  JSONL = 3,
  ARROW = 4,
  TEXT = 5,
  IMAGEFOLDER = 6,
  AUDIOFOLDER = 7,
  OTHER = 8,
}

export enum DatasetLicense {
  MIT = 0,
  APACHE_2 = 1,
  CC_BY_4 = 2,
  CC_BY_SA_4 = 3,
  CC_BY_NC_4 = 4,
  CC0 = 5,
  ODC_BY = 6,
  OTHER = 7,
}

export interface Dataset {
  datasetId: string;
  name: string;
  organization: string;
  owner: string;
  description: string;
  format: DatasetFormat;
  license: DatasetLicense;
  licenseUri: string;
  tags: string[];
  size: number;
  numRows: number;
  numFiles: number;
  createdAt: number;
  updatedAt: number;
  isPublic: boolean;
}

export interface DatasetFile {
  filename: string;
  cid: string;
  size: number;
  sha256: string;
  split?: string; // train, test, validation
  numRows?: number;
}

export interface DatasetConfig {
  name: string;
  description: string;
  splits: {
    name: string;
    numRows: number;
    numBytes: number;
  }[];
  features: Record<string, { dtype: string }>;
}

interface DatasetsContext {
  backend: BackendManager;
}

// In-memory store
const datasetsStore = new Map<string, Dataset>();
const filesStore = new Map<string, DatasetFile[]>();
const configsStore = new Map<string, DatasetConfig>();
const metricsStore = new Map<string, { downloads: number; views: number }>();

// ============================================================================
// Router
// ============================================================================

export function createDatasetsRouter(ctx: DatasetsContext): Hono {
  const router = new Hono();
  const { backend } = ctx;

  // Health check
  router.get('/health', (c) => c.json({ service: 'dws-datasets', status: 'healthy' }));

  // ============================================================================
  // HuggingFace Hub API Compatibility
  // ============================================================================

  // List datasets (HF Hub compatible)
  router.get('/api/datasets', async (c) => {
    const { search, author, sort, limit, offset } = validateQuery(hfDatasetsQuerySchema, c);

    let datasets = Array.from(datasetsStore.values());

    // Filter by author/organization
    if (author) {
      datasets = datasets.filter(d => d.organization.toLowerCase() === author.toLowerCase());
    }

    // Filter by search term
    if (search) {
      const searchLower = search.toLowerCase();
      datasets = datasets.filter(d => 
        d.name.toLowerCase().includes(searchLower) ||
        d.description.toLowerCase().includes(searchLower) ||
        d.tags.some(t => t.toLowerCase().includes(searchLower))
      );
    }

    // Sort
    datasets.sort((a, b) => {
      const metricsA = metricsStore.get(a.datasetId) || { downloads: 0, views: 0 };
      const metricsB = metricsStore.get(b.datasetId) || { downloads: 0, views: 0 };
      
      if (sort === 'downloads') return metricsB.downloads - metricsA.downloads;
      if (sort === 'modified') return b.updatedAt - a.updatedAt;
      return b.createdAt - a.createdAt;
    });

    const total = datasets.length;
    datasets = datasets.slice(offset, offset + limit);

    // Convert to HF format
    const result = datasets.map(d => {
      const metrics = metricsStore.get(d.datasetId) || { downloads: 0, views: 0 };
      return {
        _id: d.datasetId,
        id: `${d.organization}/${d.name}`,
        author: d.organization,
        sha: d.datasetId.slice(0, 40),
        lastModified: new Date(d.updatedAt).toISOString(),
        private: !d.isPublic,
        disabled: false,
        tags: d.tags,
        downloads: metrics.downloads,
        createdAt: new Date(d.createdAt).toISOString(),
      };
    });

    return c.json(result, 200, {
      'X-Total-Count': total.toString(),
    });
  });

  // Get single dataset (HF Hub compatible)
  router.get('/api/datasets/:org/:name', async (c) => {
    const org = c.req.param('org');
    const name = c.req.param('name');

    const dataset = findDatasetByKey(`${org}/${name}`);
    if (!dataset) {
      throw new Error('Dataset not found');
    }

    const files = filesStore.get(dataset.datasetId) || [];
    const config = configsStore.get(dataset.datasetId);
    const metrics = metricsStore.get(dataset.datasetId) || { downloads: 0, views: 0 };

    return c.json({
      _id: dataset.datasetId,
      id: `${org}/${name}`,
      author: dataset.organization,
      sha: dataset.datasetId.slice(0, 40),
      lastModified: new Date(dataset.updatedAt).toISOString(),
      private: !dataset.isPublic,
      disabled: false,
      tags: dataset.tags,
      downloads: metrics.downloads,
      createdAt: new Date(dataset.createdAt).toISOString(),
      cardData: {
        license: DatasetLicense[dataset.license].toLowerCase().replace('_', '-'),
        tags: dataset.tags,
        size_categories: getSizeCategory(dataset.size),
      },
      siblings: files.map(f => ({
        rfilename: f.filename,
        size: f.size,
        blobId: f.cid,
      })),
      config: config || null,
    });
  });

  // Get dataset files/tree (HF Hub compatible)
  router.get('/api/datasets/:org/:name/tree/:revision', async (c) => {
    const org = c.req.param('org');
    const name = c.req.param('name');

    const dataset = findDatasetByKey(`${org}/${name}`);
    if (!dataset) {
      throw new Error('Dataset not found');
    }

    const files = filesStore.get(dataset.datasetId) || [];

    return c.json(files.map(f => ({
      type: 'file',
      oid: f.cid,
      size: f.size,
      path: f.filename,
    })));
  });

  // Download file (HF Hub compatible)
  router.get('/api/datasets/:org/:name/resolve/:revision/*', async (c) => {
    const org = c.req.param('org');
    const name = c.req.param('name');
    const filename = c.req.url.split('/resolve/')[1]?.split('/').slice(1).join('/');

    const dataset = findDatasetByKey(`${org}/${name}`);
    if (!dataset) {
      throw new Error('Dataset not found');
    }

    const files = filesStore.get(dataset.datasetId) || [];
    const file = files.find(f => f.filename === filename);
    
    if (!file) {
      return c.json({ error: 'File not found' }, 404);
    }

    // Track download
    const metrics = metricsStore.get(dataset.datasetId) || { downloads: 0, views: 0 };
    metrics.downloads++;
    metricsStore.set(dataset.datasetId, metrics);

    const result = await backend.download(file.cid).catch(() => null);
    if (!result) {
      throw new Error('File not available');
    }

    const content = Buffer.isBuffer(result.content) ? new Uint8Array(result.content) : result.content;
    return new Response(content, {
      headers: {
        'Content-Type': getContentType(filename),
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Sha256': file.sha256,
      },
    });
  });

  // Parquet files info (for datasets library)
  router.get('/api/datasets/:org/:name/parquet', async (c) => {
    const org = c.req.param('org');
    const name = c.req.param('name');

    const dataset = findDatasetByKey(`${org}/${name}`);
    if (!dataset) {
      throw new Error('Dataset not found');
    }

    const files = filesStore.get(dataset.datasetId) || [];
    const parquetFiles = files.filter(f => f.filename.endsWith('.parquet'));

    // Group by split
    const splits: Record<string, string[]> = {};
    for (const file of parquetFiles) {
      const split = file.split || 'train';
      if (!splits[split]) splits[split] = [];
      splits[split].push(`/storage/download/${file.cid}`);
    }

    return c.json({
      parquet_files: splits,
      features: configsStore.get(dataset.datasetId)?.features || {},
    });
  });

  // ============================================================================
  // Jeju Native API
  // ============================================================================

  // List all datasets
  router.get('/', async (c) => {
    const { org, q: search, format, limit, offset } = validateQuery(nativeDatasetsQuerySchema, c);

    let datasets = Array.from(datasetsStore.values());

    if (org) {
      datasets = datasets.filter(d => d.organization.toLowerCase() === org.toLowerCase());
    }

    if (search) {
      const searchLower = search.toLowerCase();
      datasets = datasets.filter(d => 
        d.name.toLowerCase().includes(searchLower) ||
        d.description.toLowerCase().includes(searchLower)
      );
    }

    if (format) {
      const formatNum = DatasetFormat[format.toUpperCase() as keyof typeof DatasetFormat];
      if (formatNum !== undefined) {
        datasets = datasets.filter(d => d.format === formatNum);
      }
    }

    const total = datasets.length;
    datasets = datasets.slice(offset, offset + limit);

    return c.json({
      datasets: datasets.map(d => ({
        ...d,
        metrics: metricsStore.get(d.datasetId) || { downloads: 0, views: 0 },
      })),
      total,
      limit,
      offset,
    });
  });

  // Get dataset details
  router.get('/:org/:name', async (c) => {
    const org = c.req.param('org');
    const name = c.req.param('name');

    const dataset = findDatasetByKey(`${org}/${name}`);
    if (!dataset) {
      throw new Error('Dataset not found');
    }

    const files = filesStore.get(dataset.datasetId) || [];
    const config = configsStore.get(dataset.datasetId);
    const metrics = metricsStore.get(dataset.datasetId) || { downloads: 0, views: 0 };

    return c.json({
      ...dataset,
      files,
      config,
      metrics,
    });
  });

  // Create dataset
  router.post('/', async (c) => {
    const { 'x-jeju-address': owner } = validateHeaders(jejuAddressHeaderSchema, c);
    const body = await validateBody(datasetCreationSchema.extend({
      isPublic: z.boolean().optional(),
    }), c);

    const format = typeof body.format === 'string'
      ? DatasetFormat[body.format.toUpperCase() as keyof typeof DatasetFormat]
      : (body.format ?? DatasetFormat.PARQUET);
    const license = typeof body.license === 'string'
      ? DatasetLicense[body.license.toUpperCase().replace('-', '_') as keyof typeof DatasetLicense]
      : (body.license ?? DatasetLicense.CC_BY_4);

    const org = body.organization ?? owner;
    const datasetId = keccak256(
      encodePacked(['string', 'string', 'address', 'uint256'], 
        [org, body.name, owner, BigInt(Date.now())])
    );

    const dataset: Dataset = {
      datasetId,
      name: body.name,
      organization: org,
      owner,
      description: body.description,
      format,
      license,
      licenseUri: '',
      tags: body.tags || [],
      size: 0,
      numRows: 0,
      numFiles: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isPublic: body.isPublic ?? true,
    };

    datasetsStore.set(datasetId, dataset);
    metricsStore.set(datasetId, { downloads: 0, views: 0 });

    return c.json(dataset, 201);
  });

  // Upload dataset files
  router.post('/:org/:name/upload', async (c) => {
    const { 'x-jeju-address': owner } = validateHeaders(jejuAddressHeaderSchema, c);
    const org = c.req.param('org');
    const name = c.req.param('name');

    const dataset = findDatasetByKey(`${org}/${name}`);
    if (!dataset) {
      throw new Error('Dataset not found');
    }

    if (dataset.owner.toLowerCase() !== owner.toLowerCase()) {
      throw new Error('Not authorized');
    }

    const formData = await c.req.formData();
    const split = formData.get('split') as string | null;
    const uploadedFiles: DatasetFile[] = [];
    let totalSize = 0;
    let totalRows = 0;

    for (const [, value] of formData.entries()) {
      if (typeof value !== 'string') {
        const file = value as File;
        const content = Buffer.from(await file.arrayBuffer());
        const sha256 = createHash('sha256').update(content).digest('hex');
        
        const result = await backend.upload(content, { filename: file.name });
        
        // Estimate row count for parquet/jsonl files
        const estimatedRows = estimateRows(content, file.name);
        
        uploadedFiles.push({
          filename: file.name,
          cid: result.cid,
          size: content.length,
          sha256,
          split: split || getSplitFromFilename(file.name),
          numRows: estimatedRows,
        });

        totalSize += content.length;
        totalRows += estimatedRows;
      }
    }

    // Append to existing files
    const existingFiles = filesStore.get(dataset.datasetId) || [];
    filesStore.set(dataset.datasetId, [...existingFiles, ...uploadedFiles]);

    // Update dataset metadata
    dataset.size += totalSize;
    dataset.numRows += totalRows;
    dataset.numFiles += uploadedFiles.length;
    dataset.updatedAt = Date.now();
    datasetsStore.set(dataset.datasetId, dataset);

    return c.json({ uploaded: uploadedFiles });
  });

  // Set dataset config
  router.put('/:org/:name/config', async (c) => {
    const { 'x-jeju-address': owner } = validateHeaders(jejuAddressHeaderSchema, c);
    const org = c.req.param('org');
    const name = c.req.param('name');

    const dataset = findDatasetByKey(`${org}/${name}`);
    if (!dataset) {
      throw new Error('Dataset not found');
    }

    if (dataset.owner.toLowerCase() !== owner.toLowerCase()) {
      throw new Error('Not authorized');
    }

    const config = await validateBody(datasetConfigSchema, c);
    configsStore.set(dataset.datasetId, config);

    return c.json(config);
  });

  // Get files
  router.get('/:org/:name/files', async (c) => {
    const org = c.req.param('org');
    const name = c.req.param('name');

    const dataset = findDatasetByKey(`${org}/${name}`);
    if (!dataset) {
      throw new Error('Dataset not found');
    }

    const files = filesStore.get(dataset.datasetId) || [];
    return c.json(files);
  });

  // Download file
  router.get('/:org/:name/files/:filename', async (c) => {
    const org = c.req.param('org');
    const name = c.req.param('name');
    const filename = c.req.param('filename');

    const dataset = findDatasetByKey(`${org}/${name}`);
    if (!dataset) {
      throw new Error('Dataset not found');
    }

    const files = filesStore.get(dataset.datasetId) || [];
    const file = files.find(f => f.filename === filename);
    
    if (!file) {
      return c.json({ error: 'File not found' }, 404);
    }

    // Track download
    const metrics = metricsStore.get(dataset.datasetId) || { downloads: 0, views: 0 };
    metrics.downloads++;
    metricsStore.set(dataset.datasetId, metrics);

    const result = await backend.download(file.cid);
    const content = Buffer.isBuffer(result.content) ? new Uint8Array(result.content) : result.content;
    return new Response(content, {
      headers: {
        'Content-Type': getContentType(filename),
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  });

  return router;
}

// ============================================================================
// Helpers
// ============================================================================

function findDatasetByKey(key: string): Dataset | null {
  for (const dataset of datasetsStore.values()) {
    if (`${dataset.organization}/${dataset.name}` === key) {
      return dataset;
    }
  }
  return null;
}

function getSizeCategory(bytes: number): string[] {
  if (bytes < 1_000_000) return ['n<1K'];
  if (bytes < 10_000_000) return ['1K<n<10K'];
  if (bytes < 100_000_000) return ['10K<n<100K'];
  if (bytes < 1_000_000_000) return ['100K<n<1M'];
  if (bytes < 10_000_000_000) return ['1M<n<10M'];
  return ['n>10M'];
}

function getSplitFromFilename(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.includes('train')) return 'train';
  if (lower.includes('test')) return 'test';
  if (lower.includes('valid') || lower.includes('val') || lower.includes('dev')) return 'validation';
  return 'train';
}

function estimateRows(content: Buffer, filename: string): number {
  // Simple estimation - in production would parse the actual file
  if (filename.endsWith('.jsonl')) {
    return content.toString().split('\n').filter(l => l.trim()).length;
  }
  if (filename.endsWith('.csv')) {
    return content.toString().split('\n').filter(l => l.trim()).length - 1;
  }
  // For parquet, would use actual parsing
  return 0;
}

function getContentType(filename: string): string {
  if (filename.endsWith('.parquet')) return 'application/octet-stream';
  if (filename.endsWith('.csv')) return 'text/csv';
  if (filename.endsWith('.json') || filename.endsWith('.jsonl')) return 'application/json';
  if (filename.endsWith('.arrow')) return 'application/octet-stream';
  if (filename.endsWith('.txt')) return 'text/plain';
  return 'application/octet-stream';
}

