import {
  BigIntColumn as BigIntColumn_,
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  IntColumn as IntColumn_,
  ManyToOne as ManyToOne_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'
import { OracleOperator } from './oracleOperator.model'

@Entity_()
export class OracleAttestation {
  constructor(props?: Partial<OracleAttestation>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @ManyToOne_(() => OracleOperator, { nullable: true })
  operator!: OracleOperator

  @Index_()
  @BigIntColumn_({ nullable: false })
  epoch!: bigint

  @IntColumn_({ nullable: false })
  feedsServed!: number

  @IntColumn_({ nullable: false })
  reportsSubmitted!: number

  @IntColumn_({ nullable: false })
  reportsAccepted!: number

  @IntColumn_({ nullable: false })
  disputesReceived!: number

  @IntColumn_({ nullable: false })
  participationScore!: number

  @IntColumn_({ nullable: false })
  accuracyScore!: number

  @Index_()
  @DateTimeColumn_({ nullable: false })
  attestedAt!: Date

  @StringColumn_({ nullable: false })
  txHash!: string
}
