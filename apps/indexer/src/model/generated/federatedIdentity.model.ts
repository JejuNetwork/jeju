import {
  BigIntColumn as BigIntColumn_,
  BooleanColumn as BooleanColumn_,
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  IntColumn as IntColumn_,
  OneToMany as OneToMany_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'
import { CrossNetworkAttestation } from './crossNetworkAttestation.model'

@Entity_()
export class FederatedIdentity {
  constructor(props?: Partial<FederatedIdentity>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_({ unique: true })
  @StringColumn_({ nullable: false })
  federatedId!: string

  @Index_()
  @BigIntColumn_({ nullable: false })
  originChainId!: bigint

  @Index_()
  @BigIntColumn_({ nullable: false })
  originAgentId!: bigint

  @Index_()
  @StringColumn_({ nullable: false })
  originOwner!: string

  @StringColumn_({ nullable: false })
  originRegistryHash!: string

  @DateTimeColumn_({ nullable: false })
  federatedAt!: Date

  @BooleanColumn_({ nullable: false })
  isActive!: boolean

  @IntColumn_({ nullable: false })
  reputationScore!: number

  @OneToMany_(
    () => CrossNetworkAttestation,
    (e) => e.federatedIdentity,
  )
  attestations!: CrossNetworkAttestation[]
}
