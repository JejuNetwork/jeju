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
import type { FederationChainType } from './_federationChainType'
import type { FederationRegistryType } from './_federationRegistryType'
import { FederatedEntry } from './federatedEntry.model'
import { FederatedNetwork } from './federatedNetwork.model'

@Entity_()
export class FederatedRegistry {
  constructor(props?: Partial<FederatedRegistry>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_({ unique: true })
  @StringColumn_({ nullable: false })
  registryId!: string

  @Index_()
  @ManyToOne_(() => FederatedNetwork, { nullable: true })
  network!: FederatedNetwork

  @Column_('varchar', { length: 6, nullable: false })
  chainType!: FederationChainType

  @Index_()
  @Column_('varchar', { length: 12, nullable: false })
  registryType!: FederationRegistryType

  @Index_()
  @StringColumn_({ nullable: false })
  contractAddress!: string

  @StringColumn_({ nullable: false })
  name!: string

  @StringColumn_({ nullable: true })
  version!: string | undefined | null

  @StringColumn_({ nullable: true })
  metadataUri!: string | undefined | null

  @BigIntColumn_({ nullable: false })
  entryCount!: bigint

  @BigIntColumn_({ nullable: false })
  lastSyncBlock!: bigint

  @BooleanColumn_({ nullable: false })
  isActive!: boolean

  @DateTimeColumn_({ nullable: false })
  registeredAt!: Date

  @IntColumn_({ nullable: false })
  registeredBlock!: number

  @OneToMany_(
    () => FederatedEntry,
    (e) => e.registry,
  )
  entries!: FederatedEntry[]
}
