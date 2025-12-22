import { NextRequest, NextResponse } from 'next/server';
import { validateQuery, errorResponse, expect } from '@/lib/validation';
import { getModelsQuerySchema, createModelSchema } from '@/lib/validation/schemas';
import type { Model } from '@/types';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    validateQuery(getModelsQuerySchema, searchParams);

    // Mock data - in production this would query the ModelRegistry contract
    const models: Model[] = [
      {
        id: 'jeju/llama-3-jeju-ft',
        name: 'Llama 3 Jeju Fine-tuned',
        organization: 'jeju',
        type: 'llm',
        description: 'Fine-tuned for smart contract development',
        version: '1.0.0',
        fileUri: 'ipfs://...',
        downloads: 15000,
        stars: 234,
        size: '4.2GB',
        license: 'MIT',
        createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
        updatedAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
        status: 'ready',
      },
      {
        id: 'jeju/code-embed-v1',
        name: 'Code Embedding v1',
        organization: 'jeju',
        type: 'embedding',
        description: 'Code embedding model for semantic search',
        version: '1.0.0',
        fileUri: 'ipfs://...',
        downloads: 8500,
        stars: 156,
        size: '400MB',
        license: 'Apache-2.0',
        createdAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
        updatedAt: Date.now() - 14 * 24 * 60 * 60 * 1000,
        status: 'ready',
      },
    ];

    return NextResponse.json({ models, total: models.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(message, 400);
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const name = formData.get('name');
    const organization = formData.get('organization');
    const description = formData.get('description');
    const type = formData.get('type');

    expect(name, 'Name is required');
    expect(organization, 'Organization is required');
    expect(description, 'Description is required');
    expect(type, 'Type is required');

    const validated = createModelSchema.parse({
      name: String(name),
      organization: String(organization),
      description: String(description),
      type: String(type),
    });

    const model: Model = {
      id: `${validated.organization}/${validated.name}`,
      name: validated.name,
      organization: validated.organization,
      description: validated.description,
      type: validated.type,
      version: '1.0.0',
      fileUri: '',
      downloads: 0,
      stars: 0,
      status: 'processing',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    return NextResponse.json(model, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(message, 400);
  }
}



