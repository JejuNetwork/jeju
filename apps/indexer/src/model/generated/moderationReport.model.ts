import {
  BigIntColumn as BigIntColumn_,
  BytesColumn as BytesColumn_,
  Column as Column_,
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  ManyToOne as ManyToOne_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'
import type { ReportSeverity } from './_reportSeverity'
import type { ReportStatus } from './_reportStatus'
import type { ReportType } from './_reportType'
import { IPFSFile } from './ipfsFile.model'

@Entity_()
export class ModerationReport {
  constructor(props?: Partial<ModerationReport>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @BigIntColumn_({ nullable: false })
  reportId!: bigint

  @BigIntColumn_({ nullable: false })
  targetAgentId!: bigint

  @BytesColumn_({ nullable: false })
  reporter!: Uint8Array

  @Column_('varchar', { length: 13, nullable: false })
  reportType!: ReportType

  @Column_('varchar', { length: 8, nullable: false })
  severity!: ReportSeverity

  @Index_()
  @ManyToOne_(() => IPFSFile, { nullable: true })
  evidenceIPFS!: IPFSFile | undefined | null

  @StringColumn_({ nullable: false })
  details!: string

  @Column_('varchar', { length: 12, nullable: false })
  status!: ReportStatus

  @DateTimeColumn_({ nullable: false })
  createdAt!: Date
}
