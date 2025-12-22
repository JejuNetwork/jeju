export const ReportSeverity = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
} as const
export type ReportSeverity =
  (typeof ReportSeverity)[keyof typeof ReportSeverity]
