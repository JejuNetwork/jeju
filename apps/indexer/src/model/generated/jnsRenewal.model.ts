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
import { Account } from './account.model'
import { JNSName } from './jnsName.model'

@Entity_()
export class JNSRenewal {
  constructor(props?: Partial<JNSRenewal>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @ManyToOne_(() => JNSName, { nullable: true })
  name!: JNSName

  @Index_()
  @ManyToOne_(() => Account, { nullable: true })
  renewer!: Account

  @BigIntColumn_({ nullable: false })
  cost!: bigint

  @DateTimeColumn_({ nullable: false })
  newExpiresAt!: Date

  @Index_()
  @DateTimeColumn_({ nullable: false })
  timestamp!: Date

  @StringColumn_({ nullable: false })
  txHash!: string

  @Index_()
  @IntColumn_({ nullable: false })
  blockNumber!: number
}
