export const ReportType = {
  NETWORK_BAN: 'NETWORK_BAN',
  APP_BAN: 'APP_BAN',
  LABEL_HACKER: 'LABEL_HACKER',
  LABEL_SCAMMER: 'LABEL_SCAMMER',
} as const
export type ReportType = (typeof ReportType)[keyof typeof ReportType]
