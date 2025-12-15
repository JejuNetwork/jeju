import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, BigIntColumn as BigIntColumn_, Index as Index_, IntColumn as IntColumn_, DateTimeColumn as DateTimeColumn_} from "@subsquid/typeorm-store"

@Entity_()
export class WeightedReputationQuery {
    constructor(props?: Partial<WeightedReputationQuery>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @BigIntColumn_({nullable: false})
    agentId!: bigint

    @IntColumn_({nullable: false})
    weightedReputation!: number

    @BigIntColumn_({nullable: false})
    totalWeight!: bigint

    @IntColumn_({nullable: false})
    providerCount!: number

    @DateTimeColumn_({nullable: false})
    queriedAt!: Date
}
