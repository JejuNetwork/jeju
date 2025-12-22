import {
  BigIntColumn as BigIntColumn_,
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  ManyToOne as ManyToOne_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'
import { FederatedIdentity } from './federatedIdentity.model'

@Entity_()
export class CrossNetworkAttestation {
  constructor(props?: Partial<CrossNetworkAttestation>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @ManyToOne_(() => FederatedIdentity, { nullable: true })
  federatedIdentity!: FederatedIdentity

  @Index_()
  @BigIntColumn_({ nullable: false })
  targetChainId!: bigint

  @DateTimeColumn_({ nullable: false })
  attestedAt!: Date

  @StringColumn_({ nullable: false })
  attester!: string

  @StringColumn_({ nullable: false })
  attestationHash!: string
}
