/**
 * Faucet API Routes
 * 
 * GET /api/faucet/status/[address] - Check faucet eligibility
 * POST /api/faucet/claim - Claim tokens
 * GET /api/faucet/info - Get faucet info
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  getFaucetStatus,
  claimFromFaucet,
  getFaucetInfo,
  ClaimRequestSchema,
  FaucetStatusSchema,
  FaucetClaimResultSchema,
  FaucetInfoSchema,
} from '@/lib/faucet'
import { AddressSchema } from '@jejunetwork/types'

type RouteContext = {
  params: Promise<{ action: string[] }>
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { action } = await context.params
  const [endpoint, ...rest] = action

  // GET /api/faucet/info
  if (endpoint === 'info' && rest.length === 0) {
    const info = getFaucetInfo()
    return NextResponse.json(FaucetInfoSchema.parse(info))
  }

  // GET /api/faucet/status/[address]
  if (endpoint === 'status' && rest.length === 1) {
    const address = rest[0]
    
    const parseResult = AddressSchema.safeParse(address)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid address format' },
        { status: 400 }
      )
    }

    const status = await getFaucetStatus(parseResult.data)
    return NextResponse.json(FaucetStatusSchema.parse(status))
  }

  return NextResponse.json(
    { error: 'Not found' },
    { status: 404 }
  )
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { action } = await context.params
  const [endpoint] = action

  // POST /api/faucet/claim
  if (endpoint === 'claim') {
    const body = await request.json()
    
    const parseResult = ClaimRequestSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json(
        { 
          success: false, 
          error: `Invalid request: ${parseResult.error.issues[0].message}` 
        },
        { status: 400 }
      )
    }

    const result = await claimFromFaucet(parseResult.data.address).catch((error: Error) => ({
      success: false as const,
      error: error.message,
    }))

    const validated = FaucetClaimResultSchema.parse(result)
    
    if (!validated.success) {
      return NextResponse.json(validated, { status: 400 })
    }

    return NextResponse.json(validated)
  }

  return NextResponse.json(
    { error: 'Not found' },
    { status: 404 }
  )
}
