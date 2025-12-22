import {
  BigIntColumn as BigIntColumn_,
  BooleanColumn as BooleanColumn_,
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  IntColumn as IntColumn_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'

@Entity_()
export class SolanaVerifiedEntry {
  constructor(props?: Partial<SolanaVerifiedEntry>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_({ unique: true })
  @StringColumn_({ nullable: false })
  mint!: string

  @StringColumn_({ nullable: true })
  authority!: string | undefined | null

  @StringColumn_({ nullable: true })
  name!: string | undefined | null

  @StringColumn_({ nullable: true })
  symbol!: string | undefined | null

  @StringColumn_({ nullable: true })
  uri!: string | undefined | null

  @StringColumn_({ nullable: false })
  programType!: string

  @BigIntColumn_({ nullable: true })
  supply!: bigint | undefined | null

  @IntColumn_({ nullable: true })
  decimals!: number | undefined | null

  @BooleanColumn_({ nullable: false })
  verified!: boolean

  @DateTimeColumn_({ nullable: false })
  verifiedAt!: Date

  @BigIntColumn_({ nullable: true })
  wormholeSequence!: bigint | undefined | null
}
