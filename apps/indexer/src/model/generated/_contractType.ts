export const ContractType = {
  UNKNOWN: 'UNKNOWN',
  ERC20: 'ERC20',
  ERC721: 'ERC721',
  ERC1155: 'ERC1155',
  PROXY: 'PROXY',
  MULTISIG: 'MULTISIG',
  DEX: 'DEX',
  LENDING: 'LENDING',
  NFT_MARKETPLACE: 'NFT_MARKETPLACE',
  GAME: 'GAME',
  PREDICTION_MARKET: 'PREDICTION_MARKET',
  GOVERNANCE: 'GOVERNANCE',
} as const
export type ContractType = (typeof ContractType)[keyof typeof ContractType]
