import { NextRequest, NextResponse } from 'next/server';
import { dwsClient } from '@/lib/services/dws';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || undefined;
  const org = searchParams.get('org') || undefined;
  const search = searchParams.get('q') || undefined;

  const models = await dwsClient.listModels({ type, organization: org, search });
  return NextResponse.json(models);
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const name = formData.get('name') as string;
  const organization = formData.get('organization') as string;
  const description = formData.get('description') as string;
  const type = formData.get('type') as string;
  const modelFile = formData.get('model') as Blob;
  const configFile = formData.get('config') as Blob | null;

  const model = await dwsClient.uploadModel({
    name,
    organization,
    description,
    type,
    file: modelFile,
    config: configFile || undefined,
  });

  return NextResponse.json(model);
}



