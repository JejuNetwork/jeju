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
import type { ComputeRentalStatus } from './_computeRentalStatus'
import { Account } from './account.model'
import { ComputeProvider } from './computeProvider.model'
import { ComputeResource } from './computeResource.model'

@Entity_()
export class ComputeRental {
  constructor(props?: Partial<ComputeRental>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_({ unique: true })
  @StringColumn_({ nullable: false })
  rentalId!: string

  @Index_()
  @ManyToOne_(() => Account, { nullable: true })
  renter!: Account

  @Index_()
  @ManyToOne_(() => ComputeProvider, { nullable: true })
  provider!: ComputeProvider

  @Index_()
  @ManyToOne_(() => ComputeResource, { nullable: true })
  resource!: ComputeResource | undefined | null

  @BigIntColumn_({ nullable: false })
  duration!: bigint

  @BigIntColumn_({ nullable: false })
  price!: bigint

  @Index_()
  @Column_('varchar', { length: 9, nullable: false })
  status!: ComputeRentalStatus

  @DateTimeColumn_({ nullable: true })
  startTime!: Date | undefined | null

  @DateTimeColumn_({ nullable: true })
  endTime!: Date | undefined | null

  @Index_()
  @DateTimeColumn_({ nullable: false })
  createdAt!: Date

  @StringColumn_({ nullable: false })
  txHash!: string

  @IntColumn_({ nullable: false })
  blockNumber!: number
}
