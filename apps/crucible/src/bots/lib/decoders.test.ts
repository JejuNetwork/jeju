/**
 * Transaction Decoder Tests
 */

import { describe, expect, test } from 'bun:test'
import { encodeFunctionData, parseAbi } from 'viem'
import {
  decodeSwapTransaction,
  getAllSwapSelectors,
  isSwapSelector,
} from './decoders'

describe('Swap Selector Detection', () => {
  test('isSwapSelector should detect V2 selectors', () => {
    expect(isSwapSelector('0x38ed1739')).toBe(true) // swapExactTokensForTokens
    expect(isSwapSelector('0x7ff36ab5')).toBe(true) // swapExactETHForTokens
    expect(isSwapSelector('0x18cbafe5')).toBe(true) // swapExactTokensForETH
  })

  test('isSwapSelector should detect V3 selectors', () => {
    expect(isSwapSelector('0x414bf389')).toBe(true) // exactInputSingle
    expect(isSwapSelector('0xc04b8d59')).toBe(true) // exactInput
    expect(isSwapSelector('0xdb3e2198')).toBe(true) // exactOutputSingle
  })

  test('isSwapSelector should detect Universal Router selectors', () => {
    expect(isSwapSelector('0x3593564c')).toBe(true) // execute
  })

  test('isSwapSelector should reject non-swap selectors', () => {
    expect(isSwapSelector('0x12345678')).toBe(false)
    expect(isSwapSelector('0xa9059cbb')).toBe(false) // ERC20 transfer
    expect(isSwapSelector('0x095ea7b3')).toBe(false) // ERC20 approve
  })

  test('getAllSwapSelectors should return array of selectors', () => {
    const selectors = getAllSwapSelectors()
    expect(Array.isArray(selectors)).toBe(true)
    expect(selectors.length).toBeGreaterThan(10) // Should have many selectors

    // All should be 10 chars (0x + 8 hex chars)
    for (const selector of selectors) {
      expect(selector.length).toBe(10)
      expect(selector.startsWith('0x')).toBe(true)
    }
  })
})

describe('V2 Swap Decoding', () => {
  const V2_ROUTER_ABI = parseAbi([
    'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[])',
    'function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[])',
  ])

  test('should decode swapExactTokensForTokens', () => {
    const tokenA = '0x0000000000000000000000000000000000000001'
    const tokenB = '0x0000000000000000000000000000000000000002'
    const tokenC = '0x0000000000000000000000000000000000000003'
    const recipient = '0x0000000000000000000000000000000000000004'

    const calldata = encodeFunctionData({
      abi: V2_ROUTER_ABI,
      functionName: 'swapExactTokensForTokens',
      args: [
        BigInt(1e18), // amountIn
        BigInt(99e16), // amountOutMin
        [tokenA, tokenB, tokenC], // path
        recipient, // to
        BigInt(Date.now() + 3600), // deadline
      ],
    })

    const decoded = decodeSwapTransaction(calldata)

    expect(decoded).not.toBeNull()
    expect(decoded!.protocol).toBe('uniswap_v2')
    expect(decoded!.type).toBe('exactInput')
    expect(decoded!.tokenIn.toLowerCase()).toBe(tokenA.toLowerCase())
    expect(decoded!.tokenOut.toLowerCase()).toBe(tokenC.toLowerCase())
    expect(decoded!.amountIn).toBe(BigInt(1e18))
    expect(decoded!.amountOutMin).toBe(BigInt(99e16))
    expect(decoded!.recipient.toLowerCase()).toBe(recipient.toLowerCase())
    expect(decoded!.path).toHaveLength(3)
  })

  test('should decode swapExactETHForTokens', () => {
    const weth = '0x0000000000000000000000000000000000000001'
    const tokenB = '0x0000000000000000000000000000000000000002'
    const recipient = '0x0000000000000000000000000000000000000003'

    const calldata = encodeFunctionData({
      abi: V2_ROUTER_ABI,
      functionName: 'swapExactETHForTokens',
      args: [
        BigInt(99e16), // amountOutMin
        [weth, tokenB], // path
        recipient, // to
        BigInt(Date.now() + 3600), // deadline
      ],
    })

    const decoded = decodeSwapTransaction(calldata)

    expect(decoded).not.toBeNull()
    expect(decoded!.protocol).toBe('uniswap_v2')
    expect(decoded!.type).toBe('exactInput')
    expect(decoded!.tokenIn.toLowerCase()).toBe(weth.toLowerCase())
    expect(decoded!.tokenOut.toLowerCase()).toBe(tokenB.toLowerCase())
    expect(decoded!.amountOutMin).toBe(BigInt(99e16))
  })
})

describe('Edge Cases', () => {
  test('should return null for empty input', () => {
    expect(decodeSwapTransaction('')).toBeNull()
  })

  test('should return null for short input', () => {
    expect(decodeSwapTransaction('0x1234')).toBeNull()
  })

  test('should return null for unknown selector', () => {
    expect(decodeSwapTransaction(`0x12345678${'0'.repeat(64)}`)).toBeNull()
  })

  test('should handle malformed calldata gracefully', () => {
    // Valid swap selector but insufficient data
    const malformed = `0x38ed1739${'00'.repeat(10)}`
    const result = decodeSwapTransaction(malformed)
    expect(result).toBeNull()
  })
})
