export const TokenStandard = {
  ERC20: 'ERC20',
  ERC721: 'ERC721',
  ERC1155: 'ERC1155',
} as const
export type TokenStandard = (typeof TokenStandard)[keyof typeof TokenStandard]
