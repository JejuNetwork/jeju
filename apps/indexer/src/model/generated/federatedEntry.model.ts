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
import { FederatedRegistry } from './federatedRegistry.model'

@Entity_()
export class FederatedEntry {
  constructor(props?: Partial<FederatedEntry>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_({ unique: true })
  @StringColumn_({ nullable: false })
  entryId!: string

  @Index_()
  @ManyToOne_(() => FederatedRegistry, { nullable: true })
  registry!: FederatedRegistry

  @Index_()
  @StringColumn_({ nullable: false })
  originId!: string

  @StringColumn_({ nullable: false })
  name!: string

  @StringColumn_({ nullable: true })
  metadataUri!: string | undefined | null

  @Index_()
  @BigIntColumn_({ nullable: false })
  originChainId!: bigint

  @DateTimeColumn_({ nullable: false })
  syncedAt!: Date

  @IntColumn_({ nullable: false })
  syncedBlock!: number

  @BooleanColumn_({ nullable: false })
  isActive!: boolean
}
