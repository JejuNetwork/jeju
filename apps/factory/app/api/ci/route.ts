import { NextRequest, NextResponse } from 'next/server';
import { validateQuery, validateBody, errorResponse } from '@/lib/validation';
import { getCIQuerySchema, createCIRunSchema } from '@/lib/validation/schemas';
import { dwsClient, CIWorkflow } from '@/lib/services/dws';
import type { CIRun } from '@/types';

// Transform DWS CIWorkflow to CIRun format
function transformWorkflow(workflow: CIWorkflow): CIRun {
  return {
    id: workflow.id,
    workflow: workflow.name,
    status: workflow.status,
    conclusion: workflow.status === 'success' ? 'success' : workflow.status === 'failed' ? 'failure' : undefined,
    branch: 'main',
    commit: '',
    commitMessage: '',
    author: '',
    startedAt: workflow.triggeredAt,
    completedAt: workflow.completedAt,
    duration: workflow.completedAt ? Math.floor((workflow.completedAt - workflow.triggeredAt) / 1000) : undefined,
    jobs: workflow.steps.map(step => ({
      name: step.name,
      status: step.status as CIRun['jobs'][number]['status'],
      duration: step.duration,
    })),
    createdAt: workflow.triggeredAt,
    updatedAt: workflow.completedAt || workflow.triggeredAt,
  };
}

// GET /api/ci - List CI/CD workflow runs
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = validateQuery(getCIQuerySchema, searchParams);

    const repoId = searchParams.get('repoId') || undefined;
    const workflows = await dwsClient.listWorkflows(repoId).catch(() => []);
    
    const runs = workflows.map(transformWorkflow);

    return NextResponse.json({ runs, total: runs.length, page: query.page });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(message, 400);
  }
}

// POST /api/ci - Trigger a new workflow run
export async function POST(request: NextRequest) {
  try {
    const body = await validateBody(createCIRunSchema, request.json());

    const workflow = await dwsClient.triggerWorkflow({
      repoId: body.repoId,
      workflowName: body.workflow,
      ref: body.branch,
    });

    const run = transformWorkflow(workflow);
    return NextResponse.json(run, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(message, 400);
  }
}
