import {
  BigIntColumn as BigIntColumn_,
  BooleanColumn as BooleanColumn_,
  Column as Column_,
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  IntColumn as IntColumn_,
  ManyToOne as ManyToOne_,
  OneToMany as OneToMany_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'
import type { ContainerArchitecture } from './_containerArchitecture'
import type { StorageTier } from './_storageTier'
import { Account } from './account.model'
import { CrossServiceRequest } from './crossServiceRequest.model'
import { RegisteredAgent } from './registeredAgent.model'
import { StorageDeal } from './storageDeal.model'
import { StorageProvider } from './storageProvider.model'

@Entity_()
export class ContainerImage {
  constructor(props?: Partial<ContainerImage>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_({ unique: true })
  @StringColumn_({ nullable: false })
  cid!: string

  @StringColumn_({ nullable: false })
  name!: string

  @StringColumn_({ nullable: false })
  tag!: string

  @BigIntColumn_({ nullable: false })
  sizeBytes!: bigint

  @Index_()
  @DateTimeColumn_({ nullable: false })
  uploadedAt!: Date

  @Index_()
  @ManyToOne_(() => Account, { nullable: true })
  uploadedBy!: Account

  @Index_()
  @ManyToOne_(() => StorageProvider, { nullable: true })
  storageProvider!: StorageProvider | undefined | null

  @Index_()
  @ManyToOne_(() => StorageDeal, { nullable: true })
  storageDeal!: StorageDeal | undefined | null

  @Index_()
  @Column_('varchar', { length: 9, nullable: false })
  tier!: StorageTier

  @DateTimeColumn_({ nullable: true })
  expiresAt!: Date | undefined | null

  @Index_()
  @Column_('varchar', { length: 5, nullable: false })
  architecture!: ContainerArchitecture

  @Index_()
  @BooleanColumn_({ nullable: false })
  gpuRequired!: boolean

  @IntColumn_({ nullable: true })
  minGpuVram!: number | undefined | null

  @Index_()
  @BooleanColumn_({ nullable: false })
  teeRequired!: boolean

  @StringColumn_({ nullable: false })
  contentHash!: string

  @Index_()
  @BooleanColumn_({ nullable: false })
  verified!: boolean

  @Index_()
  @ManyToOne_(() => RegisteredAgent, { nullable: true })
  verifiedBy!: RegisteredAgent | undefined | null

  @IntColumn_({ nullable: false })
  pullCount!: number

  @DateTimeColumn_({ nullable: true })
  lastPulledAt!: Date | undefined | null

  @OneToMany_(
    () => CrossServiceRequest,
    (e) => e.containerImage,
  )
  crossServiceRequests!: CrossServiceRequest[]
}
