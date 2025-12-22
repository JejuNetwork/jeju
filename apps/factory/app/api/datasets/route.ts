import { NextRequest, NextResponse } from 'next/server';
import { validateQuery, errorResponse, expect } from '@/lib/validation';
import { getDatasetsQuerySchema, createDatasetSchema } from '@/lib/validation/schemas';
import type { Dataset } from '@/types';

// GET /api/datasets - List datasets
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    validateQuery(getDatasetsQuerySchema, searchParams);

    const datasets: Dataset[] = [
      {
        id: '1',
        name: 'jeju-contracts-v2',
        organization: 'jeju',
        description: 'Curated dataset of audited Solidity smart contracts',
        type: 'code',
        format: 'parquet',
        size: '2.3 GB',
        rows: 150000,
        downloads: 8420,
        stars: 234,
        license: 'Apache-2.0',
        tags: ['solidity', 'smart-contracts', 'security'],
        isVerified: true,
        createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
        updatedAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
        status: 'ready',
      },
    ];

    return NextResponse.json({ datasets, total: datasets.length });
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

