import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, StringColumn as StringColumn_, IntColumn as IntColumn_, DateTimeColumn as DateTimeColumn_, Index as Index_} from "@subsquid/typeorm-store"

@Entity_()
export class RegistrySearchQuery {
    constructor(props?: Partial<RegistrySearchQuery>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @StringColumn_({nullable: false})
    queryType!: string

    @StringColumn_({nullable: false})
    queryParams!: string

    @IntColumn_({nullable: false})
    resultCount!: number

    @IntColumn_({nullable: false})
    executionTime!: number

    @Index_()
    @DateTimeColumn_({nullable: false})
    queriedAt!: Date
}
