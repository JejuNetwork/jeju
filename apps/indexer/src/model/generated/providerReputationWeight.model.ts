import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, StringColumn as StringColumn_, Index as Index_, BigIntColumn as BigIntColumn_, DateTimeColumn as DateTimeColumn_, IntColumn as IntColumn_} from "@subsquid/typeorm-store"

@Entity_()
export class ProviderReputationWeight {
    constructor(props?: Partial<ProviderReputationWeight>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @StringColumn_({nullable: false})
    provider!: string

    @BigIntColumn_({nullable: true})
    providerAgentId!: bigint | undefined | null

    @BigIntColumn_({nullable: false})
    stakeAmount!: bigint

    @DateTimeColumn_({nullable: true})
    stakeTime!: Date | undefined | null

    @IntColumn_({nullable: false})
    averageReputation!: number

    @IntColumn_({nullable: false})
    violationsReported!: number

    @IntColumn_({nullable: false})
    operatorCount!: number

    @IntColumn_({nullable: false})
    weightedScore!: number

    @DateTimeColumn_({nullable: false})
    lastUpdated!: Date
}
