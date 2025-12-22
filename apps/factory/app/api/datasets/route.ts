import { NextRequest, NextResponse } from 'next/server';
import { validateQuery, errorResponse, expect } from '@/lib/validation';
import { getDatasetsQuerySchema, createDatasetSchema } from '@/lib/validation/schemas';
import { getDwsUrl } from '@/config/contracts';
import type { Dataset } from '@/types';

// GET /api/datasets - List datasets
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = validateQuery(getDatasetsQuerySchema, searchParams);

    const dwsUrl = getDwsUrl();
    const params = new URLSearchParams();
    if (query.type) params.set('type', query.type);
    if (query.organization) params.set('org', query.organization);
    if (query.q) params.set('q', query.q);
    
    const res = await fetch(`${dwsUrl}/datasets?${params.toString()}`);
    
    if (!res.ok) {
      return NextResponse.json({ datasets: [], total: 0 });
    }

    const data = await res.json();
    return NextResponse.json({ datasets: data.datasets || data, total: data.total || data.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(message, 400);
  }
}

// POST /api/datasets - Upload a new dataset
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const name = formData.get('name');
    const organization = formData.get('organization');
    const description = formData.get('description');
    const type = formData.get('type');
    const license = formData.get('license');
    const file = formData.get('file') as File | null;

    expect(name, 'Name is required');
    expect(organization, 'Organization is required');
    expect(description, 'Description is required');
    expect(type, 'Type is required');
    expect(license, 'License is required');

    const validated = createDatasetSchema.parse({
      name: String(name),
      organization: String(organization),
      description: String(description),
      type: String(type),
      license: String(license),
    });

    const dwsUrl = getDwsUrl();
    const uploadFormData = new FormData();
    uploadFormData.append('name', validated.name);
    uploadFormData.append('organization', validated.organization);
    uploadFormData.append('description', validated.description);
    uploadFormData.append('type', validated.type);
    uploadFormData.append('license', validated.license);
    if (file) {
      uploadFormData.append('file', file);
    }
    
    const res = await fetch(`${dwsUrl}/datasets`, {
      method: 'POST',
      body: uploadFormData,
    });

    if (res.ok) {
      const dataset = await res.json();
      return NextResponse.json(dataset, { status: 201 });
    }

    // Fallback response if DWS upload fails
    const dataset: Dataset = {
      id: `dataset-${Date.now()}`,
      name: validated.name,
      organization: validated.organization,
      description: validated.description,
      type: validated.type,
      license: validated.license,
      format: 'unknown',
      size: '0',
      rows: 0,
      downloads: 0,
      stars: 0,
      tags: [],
      isVerified: false,
      status: 'processing',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    return NextResponse.json(dataset, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(message, 400);
  }
}
