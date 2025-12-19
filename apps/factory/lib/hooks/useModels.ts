/**
 * Models and Datasets Hooks
 * Connects to DWS Model Hub (HuggingFace-compatible)
 */

import { useState, useEffect, useCallback } from 'react';
import { dwsClient } from '../services/dws';

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

export interface Model {
  modelId: string;
  name: string;
  organization: string;
  owner: string;
  modelType: ModelType;
  license: LicenseType;
  description: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  isPublic: boolean;
  isVerified: boolean;
  metrics?: {
    downloads: number;
    stars: number;
    inferences: number;
  };
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

export interface Dataset {
  datasetId: string;
  name: string;
  organization: string;
  owner: string;
  description: string;
  format: number;
  license: number;
  tags: string[];
  size: number;
  numRows: number;
  numFiles: number;
  createdAt: number;
  updatedAt: number;
  isPublic: boolean;
  metrics?: {
    downloads: number;
    views: number;
  };
}

// ============================================================================
// Hooks
// ============================================================================

export function useModels(params?: {
  type?: string;
  organization?: string;
  search?: string;
}) {
  const [models, setModels] = useState<Model[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    loadModels();
  }, [params?.type, params?.organization, params?.search]);

  async function loadModels() {
    setIsLoading(true);
    setError(null);

    const result = await dwsClient.listModels(params).catch((err: Error) => {
      setError(err);
      return [];
    });
    
    setModels(result);
    setIsLoading(false);
  }

  return { models, isLoading, error, refresh: loadModels };
}

export function useModel(organization: string, name: string) {
  const [model, setModel] = useState<Model | null>(null);
  const [versions, setVersions] = useState<ModelVersion[]>([]);
  const [files, setFiles] = useState<ModelFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    loadModel();
  }, [organization, name]);

  async function loadModel() {
    setIsLoading(true);
    setError(null);

    const dwsUrl = process.env.NEXT_PUBLIC_DWS_URL || 'http://localhost:4030';
    
    const response = await fetch(`${dwsUrl}/models/${organization}/${name}`).catch((err: Error) => {
      setError(err);
      return null;
    });

    if (!response?.ok) {
      setError(new Error('Model not found'));
      setIsLoading(false);
      return;
    }

    const data = await response.json() as {
      model?: Model;
      versions?: ModelVersion[];
      files?: ModelFile[];
    } & Model;
    
    // Handle both nested and flat response formats
    setModel(data.model || data);
    setVersions(data.versions || []);
    setFiles(data.files || []);
    setIsLoading(false);
  }

  return { model, versions, files, isLoading, error, refresh: loadModel };
}

export function useModelActions() {
  const [isPending, setIsPending] = useState(false);

  const createModel = useCallback(async (params: {
    name: string;
    organization: string;
    description: string;
    modelType: ModelType;
    license?: LicenseType;
    tags?: string[];
  }) => {
    setIsPending(true);
    const dwsUrl = process.env.NEXT_PUBLIC_DWS_URL || 'http://localhost:4030';
    
    const response = await fetch(`${dwsUrl}/models`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    setIsPending(false);
    if (!response.ok) {
      throw new Error('Failed to create model');
    }
    return response.json() as Promise<Model>;
  }, []);

  const uploadFiles = useCallback(async (
    organization: string,
    name: string,
    files: File[]
  ) => {
    setIsPending(true);
    const dwsUrl = process.env.NEXT_PUBLIC_DWS_URL || 'http://localhost:4030';
    
    const formData = new FormData();
    files.forEach(file => formData.append('files', file));

    const response = await fetch(`${dwsUrl}/models/${organization}/${name}/upload`, {
      method: 'POST',
      body: formData,
    });

    setIsPending(false);
    if (!response.ok) {
      throw new Error('Failed to upload files');
    }
    return response.json() as Promise<{ uploaded: ModelFile[] }>;
  }, []);

  const publishVersion = useCallback(async (
    organization: string,
    name: string,
    version: string,
    params?: {
      parameterCount?: number;
      precision?: string;
    }
  ) => {
    setIsPending(true);
    const dwsUrl = process.env.NEXT_PUBLIC_DWS_URL || 'http://localhost:4030';
    
    const response = await fetch(`${dwsUrl}/models/${organization}/${name}/versions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version, ...params }),
    });

    setIsPending(false);
    if (!response.ok) {
      throw new Error('Failed to publish version');
    }
    return response.json() as Promise<ModelVersion>;
  }, []);

  const toggleStar = useCallback(async (organization: string, name: string) => {
    const dwsUrl = process.env.NEXT_PUBLIC_DWS_URL || 'http://localhost:4030';
    
    const response = await fetch(`${dwsUrl}/models/${organization}/${name}/star`, {
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error('Failed to toggle star');
    }
    return response.json() as Promise<{ starred: boolean; stars: number }>;
  }, []);

  const runInference = useCallback(async (
    organization: string,
    name: string,
    input: Record<string, unknown>
  ) => {
    setIsPending(true);
    const dwsUrl = process.env.NEXT_PUBLIC_DWS_URL || 'http://localhost:4030';
    
    const response = await fetch(`${dwsUrl}/models/${organization}/${name}/inference`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });

    setIsPending(false);
    if (!response.ok) {
      throw new Error('Failed to run inference');
    }
    return response.json();
  }, []);

  return {
    createModel,
    uploadFiles,
    publishVersion,
    toggleStar,
    runInference,
    isPending,
  };
}

export function useDatasets(params?: {
  organization?: string;
  search?: string;
  format?: string;
}) {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    loadDatasets();
  }, [params?.organization, params?.search, params?.format]);

  async function loadDatasets() {
    setIsLoading(true);
    setError(null);

    const dwsUrl = process.env.NEXT_PUBLIC_DWS_URL || 'http://localhost:4030';
    const searchParams = new URLSearchParams();
    if (params?.organization) searchParams.set('org', params.organization);
    if (params?.search) searchParams.set('q', params.search);
    if (params?.format) searchParams.set('format', params.format);

    const response = await fetch(`${dwsUrl}/datasets?${searchParams}`).catch((err: Error) => {
      setError(err);
      return null;
    });

    if (!response?.ok) {
      setError(new Error('Failed to fetch datasets'));
      setIsLoading(false);
      return;
    }

    const data = await response.json() as { datasets: Dataset[] };
    setDatasets(data.datasets || []);
    setIsLoading(false);
  }

  return { datasets, isLoading, error, refresh: loadDatasets };
}

export function useDataset(organization: string, name: string) {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [files, setFiles] = useState<{ filename: string; cid: string; size: number; split?: string }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    loadDataset();
  }, [organization, name]);

  async function loadDataset() {
    setIsLoading(true);
    setError(null);

    const dwsUrl = process.env.NEXT_PUBLIC_DWS_URL || 'http://localhost:4030';
    
    const response = await fetch(`${dwsUrl}/datasets/${organization}/${name}`).catch((err: Error) => {
      setError(err);
      return null;
    });

    if (!response?.ok) {
      setError(new Error('Dataset not found'));
      setIsLoading(false);
      return;
    }

    const data = await response.json();
    setDataset(data);
    setFiles(data.files || []);
    setIsLoading(false);
  }

  return { dataset, files, isLoading, error, refresh: loadDataset };
}

// Type label helpers
export function getModelTypeLabel(type: ModelType): string {
  const labels: Record<ModelType, string> = {
    [ModelType.LLM]: 'LLM',
    [ModelType.VISION]: 'Vision',
    [ModelType.AUDIO]: 'Audio',
    [ModelType.MULTIMODAL]: 'Multimodal',
    [ModelType.EMBEDDING]: 'Embedding',
    [ModelType.CLASSIFIER]: 'Classifier',
    [ModelType.REGRESSION]: 'Regression',
    [ModelType.RL]: 'RL',
    [ModelType.OTHER]: 'Other',
  };
  return labels[type] || 'Other';
}

export function getLicenseLabel(license: LicenseType): string {
  const labels: Record<LicenseType, string> = {
    [LicenseType.MIT]: 'MIT',
    [LicenseType.APACHE_2]: 'Apache 2.0',
    [LicenseType.GPL_3]: 'GPL 3.0',
    [LicenseType.CC_BY_4]: 'CC BY 4.0',
    [LicenseType.CC_BY_NC_4]: 'CC BY-NC 4.0',
    [LicenseType.LLAMA_2]: 'Llama 2',
    [LicenseType.CUSTOM]: 'Custom',
    [LicenseType.PROPRIETARY]: 'Proprietary',
  };
  return labels[license] || 'Unknown';
}

