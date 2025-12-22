import {
  BigIntColumn as BigIntColumn_,
  BooleanColumn as BooleanColumn_,
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  IntColumn as IntColumn_,
  ManyToOne as ManyToOne_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'
import { XLP } from './xlp.model'

@Entity_()
export class XLPSlashEvent {
  constructor(props?: Partial<XLPSlashEvent>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @ManyToOne_(() => XLP, { nullable: true })
  xlp!: XLP

  @Index_()
  @StringColumn_({ nullable: false })
  voucherId!: string

  @IntColumn_({ nullable: false })
  chainId!: number

  @BigIntColumn_({ nullable: false })
  amount!: bigint

  @StringColumn_({ nullable: false })
  victim!: string

  @Index_()
  @DateTimeColumn_({ nullable: false })
  timestamp!: Date

  @BooleanColumn_({ nullable: false })
  disputed!: boolean

  @StringColumn_({ nullable: false })
  txHash!: string
}
