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
import { Keepalive } from './keepalive.model'

@Entity_()
export class KeepaliveAutoFund {
  constructor(props?: Partial<KeepaliveAutoFund>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @ManyToOne_(() => Keepalive, { nullable: true })
  keepalive!: Keepalive

  @BigIntColumn_({ nullable: false })
  amount!: bigint

  @StringColumn_({ nullable: false })
  vault!: string

  @BooleanColumn_({ nullable: false })
  success!: boolean

  @DateTimeColumn_({ nullable: false })
  timestamp!: Date

  @Index_()
  @IntColumn_({ nullable: false })
  blockNumber!: number

  @Index_()
  @StringColumn_({ nullable: false })
  txHash!: string
}
