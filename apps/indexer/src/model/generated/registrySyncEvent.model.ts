import {
  BigIntColumn as BigIntColumn_,
  Column as Column_,
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'
import type { FederationRegistryType } from './_federationRegistryType'

@Entity_()
export class RegistrySyncEvent {
  constructor(props?: Partial<RegistrySyncEvent>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_({ unique: true })
  @StringColumn_({ nullable: false })
  updateId!: string

  @Index_()
  @BigIntColumn_({ nullable: false })
  sourceChainId!: bigint

  @Column_('varchar', { length: 12, nullable: false })
  registryType!: FederationRegistryType

  @StringColumn_({ nullable: false })
  registryAddress!: string

  @BigIntColumn_({ nullable: false })
  entryCount!: bigint

  @StringColumn_({ nullable: true })
  merkleRoot!: string | undefined | null

  @BigIntColumn_({ nullable: false })
  blockNumber!: bigint

  @DateTimeColumn_({ nullable: false })
  timestamp!: Date
}
