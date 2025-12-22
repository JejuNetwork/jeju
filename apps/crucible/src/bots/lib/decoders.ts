/**
 * Transaction Decoders - Parse swap transactions from mempool
 *
 * Supports:
 * - Uniswap V2 Router
 * - Uniswap V3 Router / SwapRouter02
 * - Universal Router (Permit2)
 * - SushiSwap
 * - 0x Exchange
 */

import { decodeAbiParameters, type Hex, parseAbiParameters } from 'viem'

// ============ Decoded Transaction Types ============

export interface DecodedSwap {
  protocol:
    | 'uniswap_v2'
    | 'uniswap_v3'
    | 'universal_router'
    | 'sushiswap'
    | '0x'
    | 'unknown'
  type: 'exactInput' | 'exactOutput' | 'unknown'
  tokenIn: string
  tokenOut: string
  amountIn: bigint
  amountOut: bigint
  amountInMax?: bigint
  amountOutMin?: bigint
  recipient: string
  deadline?: bigint
  path?: string[]
  fee?: number
  sqrtPriceLimitX96?: bigint
}

// ============ Function Selectors ============

// Uniswap V2 Router
const V2_SELECTORS = {
  swapExactTokensForTokens: '0x38ed1739',
  swapTokensForExactTokens: '0x8803dbee',
  swapExactETHForTokens: '0x7ff36ab5',
  swapTokensForExactETH: '0x4a25d94a',
  swapExactTokensForETH: '0x18cbafe5',
  swapETHForExactTokens: '0xfb3bdb41',
  swapExactTokensForTokensSupportingFeeOnTransferTokens: '0x5c11d795',
  swapExactETHForTokensSupportingFeeOnTransferTokens: '0xb6f9de95',
  swapExactTokensForETHSupportingFeeOnTransferTokens: '0x791ac947',
}

// Uniswap V3 Router
const V3_SELECTORS = {
  exactInputSingle: '0x414bf389',
  exactInput: '0xc04b8d59',
  exactOutputSingle: '0xdb3e2198',
  exactOutput: '0xf28c0498',
  // SwapRouter02
  exactInputSingle02: '0x04e45aaf',
  exactInput02: '0xb858183f',
  exactOutputSingle02: '0x5023b4df',
  exactOutput02: '0x09b81346',
}

// Universal Router
const UNIVERSAL_ROUTER_SELECTORS = {
  execute: '0x3593564c',
  executeWithDeadline: '0x24856bc3',
}

// Universal Router command types
const UNIVERSAL_COMMANDS = {
  V3_SWAP_EXACT_IN: 0x00,
  V3_SWAP_EXACT_OUT: 0x01,
  PERMIT2_TRANSFER_FROM: 0x02,
  PERMIT2_PERMIT_BATCH: 0x03,
  SWEEP: 0x04,
  TRANSFER: 0x05,
  PAY_PORTION: 0x06,
  V2_SWAP_EXACT_IN: 0x08,
  V2_SWAP_EXACT_OUT: 0x09,
  PERMIT2_PERMIT: 0x0a,
  WRAP_ETH: 0x0b,
  UNWRAP_WETH: 0x0c,
  PERMIT2_TRANSFER_FROM_BATCH: 0x0d,
}

// ============ Decoder Functions ============

/**
 * Decode any swap transaction
 */
export function decodeSwapTransaction(input: string): DecodedSwap | null {
  if (!input || input.length < 10) return null

  const selector = input.slice(0, 10).toLowerCase()

  // Try V2 decoders
  if (Object.values(V2_SELECTORS).includes(selector)) {
    return decodeV2Swap(selector, input)
  }

  // Try V3 decoders
  if (Object.values(V3_SELECTORS).includes(selector)) {
    return decodeV3Swap(selector, input)
  }

  // Try Universal Router
  if (Object.values(UNIVERSAL_ROUTER_SELECTORS).includes(selector)) {
    return decodeUniversalRouterSwap(selector, input)
  }

  return null
}

/**
 * Decode Uniswap V2 swap
 */
function decodeV2Swap(selector: string, input: string): DecodedSwap | null {
  const data = `0x${input.slice(10)}` as Hex

  try {
    switch (selector) {
      case V2_SELECTORS.swapExactTokensForTokens:
      case V2_SELECTORS.swapExactTokensForTokensSupportingFeeOnTransferTokens: {
        const decoded = decodeAbiParameters(
          parseAbiParameters(
            'uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline',
          ),
          data,
        )
        const path = decoded[2] as string[]
        return {
          protocol: 'uniswap_v2',
          type: 'exactInput',
          tokenIn: path[0],
          tokenOut: path[path.length - 1],
          amountIn: decoded[0] as bigint,
          amountOut: 0n,
          amountOutMin: decoded[1] as bigint,
          recipient: decoded[3] as string,
          deadline: decoded[4] as bigint,
          path,
        }
      }

      case V2_SELECTORS.swapTokensForExactTokens: {
        const decoded = decodeAbiParameters(
          parseAbiParameters(
            'uint256 amountOut, uint256 amountInMax, address[] path, address to, uint256 deadline',
          ),
          data,
        )
        const path = decoded[2] as string[]
        return {
          protocol: 'uniswap_v2',
          type: 'exactOutput',
          tokenIn: path[0],
          tokenOut: path[path.length - 1],
          amountIn: 0n,
          amountOut: decoded[0] as bigint,
          amountInMax: decoded[1] as bigint,
          amountOutMin: decoded[0] as bigint,
          recipient: decoded[3] as string,
          deadline: decoded[4] as bigint,
          path,
        }
      }

      case V2_SELECTORS.swapExactETHForTokens:
      case V2_SELECTORS.swapExactETHForTokensSupportingFeeOnTransferTokens: {
        // amountIn is msg.value, not in calldata
        const decoded = decodeAbiParameters(
          parseAbiParameters(
            'uint256 amountOutMin, address[] path, address to, uint256 deadline',
          ),
          data,
        )
        const path = decoded[1] as string[]
        return {
          protocol: 'uniswap_v2',
          type: 'exactInput',
          tokenIn: path[0], // WETH
          tokenOut: path[path.length - 1],
          amountIn: 0n, // Would need tx.value
          amountOut: 0n,
          amountOutMin: decoded[0] as bigint,
          recipient: decoded[2] as string,
          deadline: decoded[3] as bigint,
          path,
        }
      }

      case V2_SELECTORS.swapExactTokensForETH:
      case V2_SELECTORS.swapExactTokensForETHSupportingFeeOnTransferTokens: {
        const decoded = decodeAbiParameters(
          parseAbiParameters(
            'uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline',
          ),
          data,
        )
        const path = decoded[2] as string[]
        return {
          protocol: 'uniswap_v2',
          type: 'exactInput',
          tokenIn: path[0],
          tokenOut: path[path.length - 1], // WETH
          amountIn: decoded[0] as bigint,
          amountOut: 0n,
          amountOutMin: decoded[1] as bigint,
          recipient: decoded[3] as string,
          deadline: decoded[4] as bigint,
          path,
        }
      }

      case V2_SELECTORS.swapETHForExactTokens: {
        const decoded = decodeAbiParameters(
          parseAbiParameters(
            'uint256 amountOut, address[] path, address to, uint256 deadline',
          ),
          data,
        )
        const path = decoded[1] as string[]
        return {
          protocol: 'uniswap_v2',
          type: 'exactOutput',
          tokenIn: path[0], // WETH
          tokenOut: path[path.length - 1],
          amountIn: 0n,
          amountOut: decoded[0] as bigint,
          amountOutMin: decoded[0] as bigint,
          recipient: decoded[2] as string,
          deadline: decoded[3] as bigint,
          path,
        }
      }

      case V2_SELECTORS.swapTokensForExactETH: {
        const decoded = decodeAbiParameters(
          parseAbiParameters(
            'uint256 amountOut, uint256 amountInMax, address[] path, address to, uint256 deadline',
          ),
          data,
        )
        const path = decoded[2] as string[]
        return {
          protocol: 'uniswap_v2',
          type: 'exactOutput',
          tokenIn: path[0],
          tokenOut: path[path.length - 1], // WETH
          amountIn: 0n,
          amountOut: decoded[0] as bigint,
          amountInMax: decoded[1] as bigint,
          amountOutMin: decoded[0] as bigint,
          recipient: decoded[3] as string,
          deadline: decoded[4] as bigint,
          path,
        }
      }
    }
  } catch {
    return null
  }

  return null
}

/**
 * Decode Uniswap V3 swap
 */
function decodeV3Swap(selector: string, input: string): DecodedSwap | null {
  const data = `0x${input.slice(10)}` as Hex

  try {
    switch (selector) {
      case V3_SELECTORS.exactInputSingle:
      case V3_SELECTORS.exactInputSingle02: {
        // (address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)
        const decoded = decodeAbiParameters(
          parseAbiParameters(
            'address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96',
          ),
          data,
        )
        return {
          protocol: 'uniswap_v3',
          type: 'exactInput',
          tokenIn: decoded[0] as string,
          tokenOut: decoded[1] as string,
          fee: Number(decoded[2]),
          recipient: decoded[3] as string,
          deadline: decoded[4] as bigint,
          amountIn: decoded[5] as bigint,
          amountOut: 0n,
          amountOutMin: decoded[6] as bigint,
          sqrtPriceLimitX96: decoded[7] as bigint,
        }
      }

      case V3_SELECTORS.exactInput:
      case V3_SELECTORS.exactInput02: {
        // (bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum)
        const decoded = decodeAbiParameters(
          parseAbiParameters(
            'bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum',
          ),
          data,
        )
        const { tokenIn, tokenOut, fees } = decodeV3Path(decoded[0] as Hex)
        return {
          protocol: 'uniswap_v3',
          type: 'exactInput',
          tokenIn,
          tokenOut,
          fee: fees[0],
          recipient: decoded[1] as string,
          deadline: decoded[2] as bigint,
          amountIn: decoded[3] as bigint,
          amountOut: 0n,
          amountOutMin: decoded[4] as bigint,
        }
      }

      case V3_SELECTORS.exactOutputSingle:
      case V3_SELECTORS.exactOutputSingle02: {
        const decoded = decodeAbiParameters(
          parseAbiParameters(
            'address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96',
          ),
          data,
        )
        return {
          protocol: 'uniswap_v3',
          type: 'exactOutput',
          tokenIn: decoded[0] as string,
          tokenOut: decoded[1] as string,
          fee: Number(decoded[2]),
          recipient: decoded[3] as string,
          deadline: decoded[4] as bigint,
          amountIn: 0n,
          amountOut: decoded[5] as bigint,
          amountInMax: decoded[6] as bigint,
          amountOutMin: decoded[5] as bigint,
          sqrtPriceLimitX96: decoded[7] as bigint,
        }
      }

      case V3_SELECTORS.exactOutput:
      case V3_SELECTORS.exactOutput02: {
        const decoded = decodeAbiParameters(
          parseAbiParameters(
            'bytes path, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum',
          ),
          data,
        )
        const { tokenIn, tokenOut, fees } = decodeV3Path(decoded[0] as Hex)
        return {
          protocol: 'uniswap_v3',
          type: 'exactOutput',
          tokenIn: tokenOut, // Path is reversed for exactOutput
          tokenOut: tokenIn,
          fee: fees[0],
          recipient: decoded[1] as string,
          deadline: decoded[2] as bigint,
          amountIn: 0n,
          amountOut: decoded[3] as bigint,
          amountInMax: decoded[4] as bigint,
          amountOutMin: decoded[3] as bigint,
        }
      }
    }
  } catch {
    return null
  }

  return null
}

/**
 * Decode Universal Router execute call
 */
function decodeUniversalRouterSwap(
  _selector: string,
  input: string,
): DecodedSwap | null {
  const data = `0x${input.slice(10)}` as Hex

  try {
    // execute(bytes commands, bytes[] inputs, uint256 deadline)
    const decoded = decodeAbiParameters(
      parseAbiParameters('bytes commands, bytes[] inputs, uint256 deadline'),
      data,
    )

    const commands = decoded[0] as Hex
    const inputs = decoded[1] as Hex[]
    const deadline = decoded[2] as bigint

    // Parse commands
    const commandBytes = Buffer.from(commands.slice(2), 'hex')

    for (let i = 0; i < commandBytes.length; i++) {
      const command = commandBytes[i] & 0x3f // Lower 6 bits are command type
      const inputData = inputs[i]

      switch (command) {
        case UNIVERSAL_COMMANDS.V3_SWAP_EXACT_IN: {
          // (address recipient, uint256 amountIn, uint256 amountOutMin, bytes path, bool payerIsUser)
          const swapDecoded = decodeAbiParameters(
            parseAbiParameters(
              'address recipient, uint256 amountIn, uint256 amountOutMin, bytes path, bool payerIsUser',
            ),
            inputData,
          )
          const { tokenIn, tokenOut, fees } = decodeV3Path(
            swapDecoded[3] as Hex,
          )
          return {
            protocol: 'universal_router',
            type: 'exactInput',
            tokenIn,
            tokenOut,
            fee: fees[0],
            recipient: swapDecoded[0] as string,
            deadline,
            amountIn: swapDecoded[1] as bigint,
            amountOut: 0n,
            amountOutMin: swapDecoded[2] as bigint,
          }
        }

        case UNIVERSAL_COMMANDS.V3_SWAP_EXACT_OUT: {
          const swapDecoded = decodeAbiParameters(
            parseAbiParameters(
              'address recipient, uint256 amountOut, uint256 amountInMax, bytes path, bool payerIsUser',
            ),
            inputData,
          )
          const { tokenIn, tokenOut, fees } = decodeV3Path(
            swapDecoded[3] as Hex,
          )
          return {
            protocol: 'universal_router',
            type: 'exactOutput',
            tokenIn: tokenOut, // Reversed for exactOutput
            tokenOut: tokenIn,
            fee: fees[0],
            recipient: swapDecoded[0] as string,
            deadline,
            amountIn: 0n,
            amountOut: swapDecoded[1] as bigint,
            amountInMax: swapDecoded[2] as bigint,
            amountOutMin: swapDecoded[1] as bigint,
          }
        }

        case UNIVERSAL_COMMANDS.V2_SWAP_EXACT_IN: {
          // (address recipient, uint256 amountIn, uint256 amountOutMin, address[] path, bool payerIsUser)
          const swapDecoded = decodeAbiParameters(
            parseAbiParameters(
              'address recipient, uint256 amountIn, uint256 amountOutMin, address[] path, bool payerIsUser',
            ),
            inputData,
          )
          const path = swapDecoded[3] as string[]
          return {
            protocol: 'universal_router',
            type: 'exactInput',
            tokenIn: path[0],
            tokenOut: path[path.length - 1],
            recipient: swapDecoded[0] as string,
            deadline,
            amountIn: swapDecoded[1] as bigint,
            amountOut: 0n,
            amountOutMin: swapDecoded[2] as bigint,
            path,
          }
        }

        case UNIVERSAL_COMMANDS.V2_SWAP_EXACT_OUT: {
          const swapDecoded = decodeAbiParameters(
            parseAbiParameters(
              'address recipient, uint256 amountOut, uint256 amountInMax, address[] path, bool payerIsUser',
            ),
            inputData,
          )
          const path = swapDecoded[3] as string[]
          return {
            protocol: 'universal_router',
            type: 'exactOutput',
            tokenIn: path[0],
            tokenOut: path[path.length - 1],
            recipient: swapDecoded[0] as string,
            deadline,
            amountIn: 0n,
            amountOut: swapDecoded[1] as bigint,
            amountInMax: swapDecoded[2] as bigint,
            amountOutMin: swapDecoded[1] as bigint,
            path,
          }
        }
      }
    }
  } catch {
    return null
  }

  return null
}

/**
 * Decode V3 path (tokenA + fee + tokenB + fee + tokenC...)
 */
function decodeV3Path(path: Hex): {
  tokenIn: string
  tokenOut: string
  fees: number[]
} {
  const pathBytes = Buffer.from(path.slice(2), 'hex')

  const tokens: string[] = []
  const fees: number[] = []

  let offset = 0
  while (offset < pathBytes.length) {
    // Token address (20 bytes)
    tokens.push(`0x${pathBytes.slice(offset, offset + 20).toString('hex')}`)
    offset += 20

    // Fee (3 bytes) if not at end
    if (offset < pathBytes.length) {
      const fee = pathBytes.readUIntBE(offset, 3)
      fees.push(fee)
      offset += 3
    }
  }

  return {
    tokenIn: tokens[0],
    tokenOut: tokens[tokens.length - 1],
    fees,
  }
}

/**
 * Check if a selector is a known swap function
 */
export function isSwapSelector(selector: string): boolean {
  const lower = selector.toLowerCase()
  return (
    Object.values(V2_SELECTORS).includes(lower) ||
    Object.values(V3_SELECTORS).includes(lower) ||
    Object.values(UNIVERSAL_ROUTER_SELECTORS).includes(lower)
  )
}

/**
 * Get all known swap selectors
 */
export function getAllSwapSelectors(): string[] {
  return [
    ...Object.values(V2_SELECTORS),
    ...Object.values(V3_SELECTORS),
    ...Object.values(UNIVERSAL_ROUTER_SELECTORS),
  ]
}
