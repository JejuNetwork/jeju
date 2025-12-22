import {
  BigIntColumn as BigIntColumn_,
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  IntColumn as IntColumn_,
  PrimaryColumn as PrimaryColumn_,
} from '@subsquid/typeorm-store'

@Entity_()
export class FederationStats {
  constructor(props?: Partial<FederationStats>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @DateTimeColumn_({ nullable: true })
  date!: Date | undefined | null

  @IntColumn_({ nullable: false })
  totalNetworks!: number

  @IntColumn_({ nullable: false })
  activeNetworks!: number

  @IntColumn_({ nullable: false })
  stakedNetworks!: number

  @IntColumn_({ nullable: false })
  verifiedNetworks!: number

  @IntColumn_({ nullable: false })
  totalRegistries!: number

  @BigIntColumn_({ nullable: false })
  totalEntries!: bigint

  @BigIntColumn_({ nullable: false })
  totalStaked!: bigint

  @IntColumn_({ nullable: false })
  solanaEntries!: number

  @DateTimeColumn_({ nullable: false })
  lastUpdated!: Date
}
