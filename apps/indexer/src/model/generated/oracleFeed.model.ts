import {
  BigIntColumn as BigIntColumn_,
  BooleanColumn as BooleanColumn_,
  Column as Column_,
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  IntColumn as IntColumn_,
  OneToMany as OneToMany_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'
import type { OracleFeedCategory } from './_oracleFeedCategory'
import { OracleCommitteeMember } from './oracleCommitteeMember.model'
import { OracleDispute } from './oracleDispute.model'
import { OracleReport } from './oracleReport.model'

@Entity_()
export class OracleFeed {
  constructor(props?: Partial<OracleFeed>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_({ unique: true })
  @StringColumn_({ nullable: false })
  feedId!: string

  @Index_()
  @StringColumn_({ nullable: false })
  symbol!: string

  @StringColumn_({ nullable: false })
  baseToken!: string

  @StringColumn_({ nullable: false })
  quoteToken!: string

  @IntColumn_({ nullable: false })
  decimals!: number

  @IntColumn_({ nullable: false })
  heartbeatSeconds!: number

  @Column_('varchar', { length: 16, nullable: false })
  category!: OracleFeedCategory

  @Index_()
  @BooleanColumn_({ nullable: false })
  isActive!: boolean

  @IntColumn_({ nullable: false })
  minOracles!: number

  @IntColumn_({ nullable: false })
  quorumThreshold!: number

  @Index_()
  @DateTimeColumn_({ nullable: false })
  createdAt!: Date

  @StringColumn_({ nullable: false })
  createdTxHash!: string

  @Index_()
  @DateTimeColumn_({ nullable: false })
  lastUpdated!: Date

  @BigIntColumn_({ nullable: true })
  latestPrice!: bigint | undefined | null

  @BigIntColumn_({ nullable: true })
  latestConfidence!: bigint | undefined | null

  @DateTimeColumn_({ nullable: true })
  latestTimestamp!: Date | undefined | null

  @BigIntColumn_({ nullable: true })
  latestRound!: bigint | undefined | null

  @IntColumn_({ nullable: false })
  totalReports!: number

  @IntColumn_({ nullable: false })
  totalDisputes!: number

  @OneToMany_(
    () => OracleReport,
    (e) => e.feed,
  )
  reports!: OracleReport[]

  @OneToMany_(
    () => OracleDispute,
    (e) => e.feed,
  )
  disputes!: OracleDispute[]

  @OneToMany_(
    () => OracleCommitteeMember,
    (e) => e.feed,
  )
  committee!: OracleCommitteeMember[]
}
