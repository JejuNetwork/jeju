import { NextRequest, NextResponse } from 'next/server';
import { validateQuery, errorResponse, expect } from '@/lib/validation';
import { getModelsQuerySchema, createModelSchema } from '@/lib/validation/schemas';
import { dwsClient } from '@/lib/services/dws';
import type { Model } from '@/types';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = validateQuery(getModelsQuerySchema, searchParams);

    // Use DWS client to fetch real models
    const models = await dwsClient.listModels({
      type: query.type,
      organization: query.organization,
      search: query.q,
    }).catch(() => []);

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
    const file = formData.get('file') as File | null;

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

    if (file) {
      // Upload model to DWS
      const model = await dwsClient.uploadModel({
        name: validated.name,
        organization: validated.organization,
        description: validated.description,
        type: validated.type,
        file,
      });
      return NextResponse.json(model, { status: 201 });
    }

    // Return processing status if no file (metadata-only upload)
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
