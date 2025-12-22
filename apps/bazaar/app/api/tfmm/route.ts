import { NextRequest, NextResponse } from 'next/server'
import { TFMMGetQuerySchema, TFMMPostRequestSchema, type TFMMCreatePoolParams, type TFMMUpdateStrategyParams, type TFMMTriggerRebalanceParams } from '@/schemas/api'
import { expectValid, expectExists } from '@/lib/validation'
import {
  getAllTFMMPools,
  getTFMMPool,
  getTFMMStrategies,
  getOracleStatus,
  createTFMMPool,
  updatePoolStrategy,
  triggerPoolRebalance,
  getTFMMStats,
} from '@/lib/tfmm/utils'

/**
 * TFMM REST API
 * 
 * Endpoints:
 * GET /api/tfmm - Get all TFMM pools
 * GET /api/tfmm?pool=<address> - Get specific pool details
 * GET /api/tfmm?action=strategies - Get available strategies
 * GET /api/tfmm?action=oracles - Get oracle status
 */

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  
  const query = expectValid(TFMMGetQuerySchema, {
    pool: searchParams.get('pool') || undefined,
    action: searchParams.get('action') || undefined,
  }, 'TFMM query parameters')

  const { pool, action } = query

  // Get specific pool
  if (pool) {
    const foundPool = getTFMMPool(pool)
    expectExists(foundPool, `Pool not found: ${pool}`)
    return NextResponse.json({ pool: foundPool })
  }

  // Get strategies
  if (action === 'strategies') {
    return NextResponse.json({ strategies: getTFMMStrategies() })
  }

  // Get oracle status
  if (action === 'oracles') {
    return NextResponse.json({ oracles: getOracleStatus() })
  }

  // Default: return all pools
  const stats = getTFMMStats()
  return NextResponse.json({ 
    pools: getAllTFMMPools(),
    ...stats,
  })
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { action, params } = expectValid(TFMMPostRequestSchema, body, 'TFMM POST request')

  switch (action) {
    case 'create_pool': {
      const result = await createTFMMPool(params as TFMMCreatePoolParams)
      return NextResponse.json({
        success: true,
        ...result,
      })
    }

    case 'update_strategy': {
      const result = await updatePoolStrategy(params as TFMMUpdateStrategyParams)
      return NextResponse.json({
        success: true,
        ...result,
      })
    }

    case 'trigger_rebalance': {
      const result = await triggerPoolRebalance(params as TFMMTriggerRebalanceParams)
      return NextResponse.json({
        success: true,
        ...result,
      })
    }

    default: {
      throw new Error(`Unknown action: ${action}`)
    }
  }
}

