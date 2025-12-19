import { NextRequest, NextResponse } from 'next/server';

// GET /api/datasets - List datasets
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type'); // text, code, image, audio, multimodal, tabular
  const org = searchParams.get('org');
  const search = searchParams.get('q');
  const sortBy = searchParams.get('sortBy') || 'downloads';

  const datasets = [
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
    },
  ];

  return NextResponse.json({ datasets, total: datasets.length });
}

// POST /api/datasets - Upload a new dataset
export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const name = formData.get('name') as string;
  const organization = formData.get('organization') as string;
  const description = formData.get('description') as string;
  const type = formData.get('type') as string;
  const license = formData.get('license') as string;
  const files = formData.getAll('files') as File[];

  const dataset = {
    id: `dataset-${Date.now()}`,
    name,
    organization,
    description,
    type,
    license,
    files: files.map(f => ({ name: f.name, size: f.size })),
    status: 'processing',
    createdAt: Date.now(),
  };

  return NextResponse.json(dataset, { status: 201 });
}

