export const GameType = {
  GENERIC: 'GENERIC',
  CALIGULAND: 'CALIGULAND',
  EHORSE: 'EHORSE',
  HYPERSCAPE: 'HYPERSCAPE',
} as const
export type GameType = (typeof GameType)[keyof typeof GameType]
