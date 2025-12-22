/**
 * Models and Datasets Hooks
 * Connects to DWS Model Hub (HuggingFace-compatible)
 */

import { useState, useEffect, useCallback } from 'react';
import { dwsClient } from '../services/dws';
import type { Model, ModelVersion, ModelFile, Dataset, ModelType } from '@/types';

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
    
    // Cast to compatible type
    setModels(result as unknown as Model[]);
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
    license?: string;
    tags?: string[];
  }) => {
    setIsPending(true);
    const dwsUrl = process.env.NEXT_PUBLIC_DWS_URL || 'http://localhost:4030';
    
    const response = await fetch(`${dwsUrl}/models`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...params,
        type: params.modelType, // Map modelType to type for API
      }),
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

    const data = await response.json() as Dataset & { 
      files?: { filename: string; cid: string; size: number; split?: string }[] 
    };
    setDataset(data);
    setFiles(data.files || []);
    setIsLoading(false);
  }

  return { dataset, files, isLoading, error, refresh: loadDataset };
}

// Type label helpers
export function getModelTypeLabel(type: ModelType): string {
  const labels: Record<ModelType, string> = {
    'llm': 'LLM',
    'image': 'Image',
    'audio': 'Audio',
    'multimodal': 'Multimodal',
    'embedding': 'Embedding',
    'code': 'Code',
  };
  return labels[type] || 'Other';
}

export function getLicenseLabel(license: string): string {
  return license;
}
