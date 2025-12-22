export const TraceType = {
  CALL: 'CALL',
  DELEGATECALL: 'DELEGATECALL',
  STATICCALL: 'STATICCALL',
  CREATE: 'CREATE',
  CREATE2: 'CREATE2',
  SELFDESTRUCT: 'SELFDESTRUCT',
} as const
export type TraceType = (typeof TraceType)[keyof typeof TraceType]
