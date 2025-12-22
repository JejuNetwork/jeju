import {
  BigIntColumn as BigIntColumn_,
  BooleanColumn as BooleanColumn_,
  Column as Column_,
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  IntColumn as IntColumn_,
  ManyToOne as ManyToOne_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'
import type { VoucherRequestStatus } from './_voucherRequestStatus'
import { Account } from './account.model'
import { CrossChainVoucher } from './crossChainVoucher.model'

@Entity_()
export class CrossChainVoucherRequest {
  constructor(props?: Partial<CrossChainVoucherRequest>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_({ unique: true })
  @StringColumn_({ nullable: false })
  requestId!: string

  @Index_()
  @ManyToOne_(() => Account, { nullable: true })
  requester!: Account

  @Index_()
  @IntColumn_({ nullable: false })
  sourceChain!: number

  @Index_()
  @IntColumn_({ nullable: false })
  destinationChain!: number

  @Index_()
  @StringColumn_({ nullable: false })
  sourceToken!: string

  @StringColumn_({ nullable: false })
  destinationToken!: string

  @BigIntColumn_({ nullable: false })
  amount!: bigint

  @BigIntColumn_({ nullable: false })
  maxFee!: bigint

  @BigIntColumn_({ nullable: false })
  currentFee!: bigint

  @BigIntColumn_({ nullable: false })
  feeIncrement!: bigint

  @StringColumn_({ nullable: false })
  recipient!: string

  @BigIntColumn_({ nullable: false })
  gasOnDestination!: bigint

  @BigIntColumn_({ nullable: false })
  deadline!: bigint

  @Index_()
  @DateTimeColumn_({ nullable: false })
  createdAt!: Date

  @BigIntColumn_({ nullable: false })
  createdBlock!: bigint

  @Index_()
  @Column_('varchar', { length: 9, nullable: false })
  status!: VoucherRequestStatus

  @BooleanColumn_({ nullable: false })
  claimed!: boolean

  @BooleanColumn_({ nullable: false })
  expired!: boolean

  @BooleanColumn_({ nullable: false })
  refunded!: boolean

  @Index_()
  @ManyToOne_(() => CrossChainVoucher, { nullable: true })
  voucher!: CrossChainVoucher | undefined | null
}
