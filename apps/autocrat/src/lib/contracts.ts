/**
 * @fileoverview Contract ABIs and helpers
 */

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// ============ ERC20 ABI ============

export const ERC20_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'allowance',
    inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'approve',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'transfer',
    inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'decimals',
    inputs: [],
    outputs: [{ type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'symbol',
    inputs: [],
    outputs: [{ type: 'string' }],
    stateMutability: 'view',
  },
] as const;

// ============ XLP V2 Pair ABI ============

export const XLP_V2_PAIR_ABI = [
  {
    type: 'function',
    name: 'getReserves',
    inputs: [],
    outputs: [
      { name: 'reserve0', type: 'uint112' },
      { name: 'reserve1', type: 'uint112' },
      { name: 'blockTimestampLast', type: 'uint32' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'token0',
    inputs: [],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'token1',
    inputs: [],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'swap',
    inputs: [
      { name: 'amount0Out', type: 'uint256' },
      { name: 'amount1Out', type: 'uint256' },
      { name: 'to', type: 'address' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    name: 'Swap',
    inputs: [
      { name: 'sender', type: 'address', indexed: true },
      { name: 'amount0In', type: 'uint256', indexed: false },
      { name: 'amount1In', type: 'uint256', indexed: false },
      { name: 'amount0Out', type: 'uint256', indexed: false },
      { name: 'amount1Out', type: 'uint256', indexed: false },
      { name: 'to', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'Sync',
    inputs: [
      { name: 'reserve0', type: 'uint112', indexed: false },
      { name: 'reserve1', type: 'uint112', indexed: false },
    ],
  },
] as const;

// ============ XLP V2 Factory ABI ============

export const XLP_V2_FACTORY_ABI = [
  {
    type: 'function',
    name: 'getPair',
    inputs: [{ name: 'tokenA', type: 'address' }, { name: 'tokenB', type: 'address' }],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'allPairs',
    inputs: [{ name: 'index', type: 'uint256' }],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'allPairsLength',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'PairCreated',
    inputs: [
      { name: 'token0', type: 'address', indexed: true },
      { name: 'token1', type: 'address', indexed: true },
      { name: 'pair', type: 'address', indexed: false },
      { name: '', type: 'uint256', indexed: false },
    ],
  },
] as const;

// ============ XLP Router ABI ============

export const XLP_ROUTER_ABI = [
  {
    type: 'function',
    name: 'swapExactTokensForTokens',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'swapTokensForExactTokens',
    inputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'amountInMax', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'swapExactETHForTokens',
    inputs: [
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'getAmountsOut',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'path', type: 'address[]' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getAmountsIn',
    inputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'path', type: 'address[]' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
    stateMutability: 'view',
  },
] as const;

// ============ Perpetual Market ABI ============

export const PERPETUAL_MARKET_ABI = [
  {
    type: 'function',
    name: 'isLiquidatable',
    inputs: [{ name: 'positionId', type: 'bytes32' }],
    outputs: [
      { name: 'canLiquidate', type: 'bool' },
      { name: 'healthFactor', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'liquidate',
    inputs: [{ name: 'positionId', type: 'bytes32' }],
    outputs: [{ name: 'liquidatorReward', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getPosition',
    inputs: [{ name: 'positionId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'positionId', type: 'bytes32' },
          { name: 'trader', type: 'address' },
          { name: 'marketId', type: 'bytes32' },
          { name: 'side', type: 'uint8' },
          { name: 'marginType', type: 'uint8' },
          { name: 'size', type: 'uint256' },
          { name: 'margin', type: 'uint256' },
          { name: 'marginToken', type: 'address' },
          { name: 'entryPrice', type: 'uint256' },
          { name: 'entryFundingIndex', type: 'int256' },
          { name: 'lastUpdateTime', type: 'uint256' },
          { name: 'isOpen', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getTraderPositions',
    inputs: [{ name: 'trader', type: 'address' }],
    outputs: [{ type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'PositionOpened',
    inputs: [
      { name: 'positionId', type: 'bytes32', indexed: true },
      { name: 'trader', type: 'address', indexed: true },
      { name: 'marketId', type: 'bytes32', indexed: true },
      { name: 'side', type: 'uint8', indexed: false },
      { name: 'size', type: 'uint256', indexed: false },
      { name: 'margin', type: 'uint256', indexed: false },
      { name: 'entryPrice', type: 'uint256', indexed: false },
      { name: 'leverage', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'PositionLiquidated',
    inputs: [
      { name: 'positionId', type: 'bytes32', indexed: true },
      { name: 'trader', type: 'address', indexed: true },
      { name: 'liquidator', type: 'address', indexed: true },
      { name: 'size', type: 'uint256', indexed: false },
      { name: 'price', type: 'uint256', indexed: false },
      { name: 'liquidatorReward', type: 'uint256', indexed: false },
    ],
  },
] as const;

// ============ Autocrat Treasury ABI ============

export const AUTOCRAT_TREASURY_ABI = [
  {
    type: 'function',
    name: 'depositProfit',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'source', type: 'uint8' },
      { name: 'txHash', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'distributeProfits',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'withdrawOperatorEarnings',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'authorizedOperators',
    inputs: [{ name: 'operator', type: 'address' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'totalProfitsByToken',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getDistributionConfig',
    inputs: [],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'protocolBps', type: 'uint16' },
          { name: 'stakersBps', type: 'uint16' },
          { name: 'insuranceBps', type: 'uint16' },
          { name: 'operatorBps', type: 'uint16' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'ProfitDeposited',
    inputs: [
      { name: 'operator', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'source', type: 'uint8', indexed: false },
      { name: 'txHash', type: 'bytes32', indexed: false },
    ],
  },
] as const;

// ============ OIF Input Settler ABI ============

export const INPUT_SETTLER_ABI = [
  {
    type: 'event',
    name: 'Open',
    inputs: [
      { name: 'orderId', type: 'bytes32', indexed: true },
      {
        name: 'order',
        type: 'tuple',
        indexed: false,
        components: [
          { name: 'user', type: 'address' },
          { name: 'originChainId', type: 'uint256' },
          { name: 'openDeadline', type: 'uint32' },
          { name: 'fillDeadline', type: 'uint32' },
          { name: 'orderId', type: 'bytes32' },
          {
            name: 'maxSpent',
            type: 'tuple[]',
            components: [
              { name: 'token', type: 'bytes32' },
              { name: 'amount', type: 'uint256' },
              { name: 'recipient', type: 'bytes32' },
              { name: 'chainId', type: 'uint256' },
            ],
          },
          {
            name: 'minReceived',
            type: 'tuple[]',
            components: [
              { name: 'token', type: 'bytes32' },
              { name: 'amount', type: 'uint256' },
              { name: 'recipient', type: 'bytes32' },
              { name: 'chainId', type: 'uint256' },
            ],
          },
          {
            name: 'fillInstructions',
            type: 'tuple[]',
            components: [
              { name: 'destinationChainId', type: 'uint64' },
              { name: 'destinationSettler', type: 'bytes32' },
              { name: 'originData', type: 'bytes' },
            ],
          },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'getOrder',
    inputs: [{ name: 'orderId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'user', type: 'address' },
          { name: 'inputToken', type: 'address' },
          { name: 'inputAmount', type: 'uint256' },
          { name: 'outputToken', type: 'address' },
          { name: 'outputAmount', type: 'uint256' },
          { name: 'destinationChainId', type: 'uint256' },
          { name: 'recipient', type: 'address' },
          { name: 'maxFee', type: 'uint256' },
          { name: 'openDeadline', type: 'uint32' },
          { name: 'fillDeadline', type: 'uint32' },
          { name: 'solver', type: 'address' },
          { name: 'filled', type: 'bool' },
          { name: 'refunded', type: 'bool' },
          { name: 'createdBlock', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const;

// ============ Output Settler ABI ============

export const OUTPUT_SETTLER_ABI = [
  {
    type: 'function',
    name: 'fill',
    inputs: [
      { name: 'orderId', type: 'bytes32' },
      { name: 'recipient', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
] as const;

// ============ Price Oracle ABI ============

export const PRICE_ORACLE_ABI = [
  {
    type: 'function',
    name: 'getPrice',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [
      { name: 'priceUSD', type: 'uint256' },
      { name: 'decimals', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'setPrice',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'priceUSD', type: 'uint256' },
      { name: 'decimals', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'isPriceFresh',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
] as const;

// ============ Chainlink Aggregator ABI ============

export const CHAINLINK_AGGREGATOR_ABI = [
  {
    type: 'function',
    name: 'latestRoundData',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'decimals',
    inputs: [],
    outputs: [{ type: 'uint8' }],
    stateMutability: 'view',
  },
] as const;
