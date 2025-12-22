export const ReportStatus = {
  PENDING: 'PENDING',
  RESOLVED_YES: 'RESOLVED_YES',
  RESOLVED_NO: 'RESOLVED_NO',
  EXECUTED: 'EXECUTED',
} as const
export type ReportStatus = (typeof ReportStatus)[keyof typeof ReportStatus]
