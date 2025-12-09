import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, StringColumn as StringColumn_, Index as Index_, IntColumn as IntColumn_, DateTimeColumn as DateTimeColumn_} from "@subsquid/typeorm-store"

@Entity_()
export class TagIndex {
    constructor(props?: Partial<TagIndex>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_({unique: true})
    @StringColumn_({nullable: false})
    tag!: string

    @IntColumn_({nullable: false})
    agentCount!: number

    @Index_()
    @DateTimeColumn_({nullable: false})
    lastUpdated!: Date
}
