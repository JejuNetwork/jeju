import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, BigIntColumn as BigIntColumn_, Index as Index_, IntColumn as IntColumn_, BooleanColumn as BooleanColumn_, DateTimeColumn as DateTimeColumn_} from "@subsquid/typeorm-store"

@Entity_()
export class CompositeScoreCalculation {
    constructor(props?: Partial<CompositeScoreCalculation>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @BigIntColumn_({nullable: false})
    agentId!: bigint

    @IntColumn_({nullable: false})
    stakeScore!: number

    @IntColumn_({nullable: false})
    reputationScore!: number

    @IntColumn_({nullable: false})
    activityScore!: number

    @IntColumn_({nullable: false})
    violationPenalty!: number

    @IntColumn_({nullable: false})
    compositeScore!: number

    @BooleanColumn_({nullable: false})
    isBanned!: boolean

    @DateTimeColumn_({nullable: false})
    lastUpdated!: Date
}
