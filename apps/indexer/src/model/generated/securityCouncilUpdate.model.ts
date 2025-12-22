import {
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  IntColumn as IntColumn_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'

@Entity_()
export class SecurityCouncilUpdate {
  constructor(props?: Partial<SecurityCouncilUpdate>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @StringColumn_({ array: true, nullable: false })
  members!: string[]

  @IntColumn_({ nullable: false })
  memberCount!: number

  @Index_()
  @DateTimeColumn_({ nullable: false })
  updatedAt!: Date

  @IntColumn_({ nullable: false })
  blockNumber!: number

  @StringColumn_({ nullable: false })
  transactionHash!: string
}
