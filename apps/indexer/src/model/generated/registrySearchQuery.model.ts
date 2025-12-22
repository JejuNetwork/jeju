import {
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  IntColumn as IntColumn_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'

@Entity_()
export class RegistrySearchQuery {
  constructor(props?: Partial<RegistrySearchQuery>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @StringColumn_({ nullable: false })
  queryType!: string

  @StringColumn_({ nullable: false })
  queryParams!: string

  @IntColumn_({ nullable: false })
  resultCount!: number

  @IntColumn_({ nullable: false })
  executionTime!: number

  @Index_()
  @DateTimeColumn_({ nullable: false })
  queriedAt!: Date
}
