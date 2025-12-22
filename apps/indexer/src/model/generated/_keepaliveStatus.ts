export const KeepaliveStatus = {
  UNKNOWN: 'UNKNOWN',
  HEALTHY: 'HEALTHY',
  DEGRADED: 'DEGRADED',
  UNHEALTHY: 'UNHEALTHY',
  UNFUNDED: 'UNFUNDED',
} as const
export type KeepaliveStatus =
  (typeof KeepaliveStatus)[keyof typeof KeepaliveStatus]
