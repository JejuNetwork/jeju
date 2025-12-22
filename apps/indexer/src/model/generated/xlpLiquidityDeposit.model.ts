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
import { XLP } from './xlp.model'

@Entity_()
export class XLPLiquidityDeposit {
  constructor(props?: Partial<XLPLiquidityDeposit>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @ManyToOne_(() => XLP, { nullable: true })
  xlp!: XLP

  @Index_()
  @StringColumn_({ nullable: false })
  token!: string

  @Index_()
  @IntColumn_({ nullable: false })
  chainId!: number

  @BigIntColumn_({ nullable: false })
  amount!: bigint

  @BigIntColumn_({ nullable: false })
  ethAmount!: bigint

  @Index_()
  @DateTimeColumn_({ nullable: false })
  lastUpdated!: Date
}
