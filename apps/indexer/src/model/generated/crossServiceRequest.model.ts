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
import type { CrossServiceRequestStatus } from './_crossServiceRequestStatus'
import type { CrossServiceRequestType } from './_crossServiceRequestType'
import { Account } from './account.model'
import { ComputeProvider } from './computeProvider.model'
import { ComputeRental } from './computeRental.model'
import { ContainerImage } from './containerImage.model'
import { StorageProvider } from './storageProvider.model'

@Entity_()
export class CrossServiceRequest {
  constructor(props?: Partial<CrossServiceRequest>) {
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
  @Column_('varchar', { length: 14, nullable: false })
  requestType!: CrossServiceRequestType

  @Index_()
  @ManyToOne_(() => ContainerImage, { nullable: true })
  containerImage!: ContainerImage | undefined | null

  @Index_()
  @StringColumn_({ nullable: false })
  sourceCid!: string

  @Index_()
  @ManyToOne_(() => StorageProvider, { nullable: true })
  sourceProvider!: StorageProvider | undefined | null

  @Index_()
  @ManyToOne_(() => ComputeProvider, { nullable: true })
  destinationProvider!: ComputeProvider | undefined | null

  @Index_()
  @ManyToOne_(() => ComputeRental, { nullable: true })
  destinationRental!: ComputeRental | undefined | null

  @Index_()
  @Column_('varchar', { length: 11, nullable: false })
  status!: CrossServiceRequestStatus

  @Index_()
  @DateTimeColumn_({ nullable: false })
  createdAt!: Date

  @DateTimeColumn_({ nullable: true })
  completedAt!: Date | undefined | null

  @BigIntColumn_({ nullable: false })
  storageCost!: bigint

  @BigIntColumn_({ nullable: false })
  bandwidthCost!: bigint

  @BigIntColumn_({ nullable: false })
  totalCost!: bigint

  @StringColumn_({ nullable: true })
  error!: string | undefined | null

  @StringColumn_({ nullable: false })
  txHash!: string

  @Index_()
  @IntColumn_({ nullable: false })
  blockNumber!: number
}
