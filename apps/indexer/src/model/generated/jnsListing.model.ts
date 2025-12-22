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
import type { JNSListingStatus } from './_jnsListingStatus'
import { Account } from './account.model'
import { JNSName } from './jnsName.model'

@Entity_()
export class JNSListing {
  constructor(props?: Partial<JNSListing>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @ManyToOne_(() => JNSName, { nullable: true })
  name!: JNSName

  @Index_()
  @ManyToOne_(() => Account, { nullable: true })
  seller!: Account

  @BigIntColumn_({ nullable: false })
  price!: bigint

  @StringColumn_({ nullable: false })
  currency!: string

  @Column_('varchar', { length: 9, nullable: false })
  status!: JNSListingStatus

  @Index_()
  @DateTimeColumn_({ nullable: false })
  createdAt!: Date

  @DateTimeColumn_({ nullable: true })
  expiresAt!: Date | undefined | null

  @DateTimeColumn_({ nullable: true })
  soldAt!: Date | undefined | null

  @Index_()
  @ManyToOne_(() => Account, { nullable: true })
  buyer!: Account | undefined | null

  @StringColumn_({ nullable: false })
  txHash!: string

  @Index_()
  @IntColumn_({ nullable: false })
  blockNumber!: number
}
