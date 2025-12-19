import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');
  const org = searchParams.get('org');
  const search = searchParams.get('q');

  // Mock data - in production this would query the ModelRegistry contract
  const models = [
    {
      id: 'jeju/llama-3-jeju-ft',
      name: 'Llama 3 Jeju Fine-tuned',
      organization: 'jeju',
      type: 'llm',
      description: 'Fine-tuned for smart contract development',
      downloads: 15000,
      stars: 234,
      size: '4.2GB',
      license: 'MIT',
      createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
      updatedAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
    },
    {
      id: 'jeju/code-embed-v1',
      name: 'Code Embedding v1',
      organization: 'jeju',
      type: 'embedding',
      description: 'Code embedding model for semantic search',
      downloads: 8500,
      stars: 156,
      size: '400MB',
      license: 'Apache-2.0',
      createdAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
      updatedAt: Date.now() - 14 * 24 * 60 * 60 * 1000,
    },
  ];

  return NextResponse.json({ models, total: models.length });
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const name = formData.get('name') as string;
  const organization = formData.get('organization') as string;
  const description = formData.get('description') as string;
  const type = formData.get('type') as string;

  const model = {
    id: `${organization}/${name}`,
    name,
    organization,
    description,
    type,
    status: 'processing',
    createdAt: Date.now(),
  };

  return NextResponse.json(model, { status: 201 });
}



