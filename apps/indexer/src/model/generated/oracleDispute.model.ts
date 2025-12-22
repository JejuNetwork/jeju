import {
  BigIntColumn as BigIntColumn_,
  Column as Column_,
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  IntColumn as IntColumn_,
  ManyToOne as ManyToOne_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'
import type { OracleDisputeOutcome } from './_oracleDisputeOutcome'
import type { OracleDisputeStatus } from './_oracleDisputeStatus'
import { Account } from './account.model'
import { OracleFeed } from './oracleFeed.model'
import { OracleReport } from './oracleReport.model'

@Entity_()
export class OracleDispute {
  constructor(props?: Partial<OracleDispute>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_({ unique: true })
  @StringColumn_({ nullable: false })
  disputeId!: string

  @Index_()
  @ManyToOne_(() => OracleReport, { nullable: true })
  report!: OracleReport

  @Index_()
  @ManyToOne_(() => OracleFeed, { nullable: true })
  feed!: OracleFeed

  @Index_()
  @ManyToOne_(() => Account, { nullable: true })
  disputer!: Account

  @BigIntColumn_({ nullable: false })
  bond!: bigint

  @StringColumn_({ nullable: false })
  reason!: string

  @Index_()
  @Column_('varchar', { length: 10, nullable: false })
  status!: OracleDisputeStatus

  @BigIntColumn_({ nullable: true })
  challengeBond!: bigint | undefined | null

  @Index_()
  @ManyToOne_(() => Account, { nullable: true })
  challenger!: Account | undefined | null

  @Index_()
  @DateTimeColumn_({ nullable: false })
  openedAt!: Date

  @DateTimeColumn_({ nullable: false })
  challengeDeadline!: Date

  @DateTimeColumn_({ nullable: true })
  resolvedAt!: Date | undefined | null

  @Column_('varchar', { length: 7, nullable: true })
  outcome!: OracleDisputeOutcome | undefined | null

  @BigIntColumn_({ nullable: true })
  slashedAmount!: bigint | undefined | null

  @StringColumn_({ nullable: false })
  txHash!: string

  @Index_()
  @IntColumn_({ nullable: false })
  blockNumber!: number
}
