import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, DateTimeColumn as DateTimeColumn_, Index as Index_, IntColumn as IntColumn_, BigIntColumn as BigIntColumn_} from "@subsquid/typeorm-store"

@Entity_()
export class OracleNetworkStats {
    constructor(props?: Partial<OracleNetworkStats>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @DateTimeColumn_({nullable: true})
    date!: Date | undefined | null

    @IntColumn_({nullable: false})
    totalFeeds!: number

    @IntColumn_({nullable: false})
    activeFeeds!: number

    @IntColumn_({nullable: false})
    totalOperators!: number

    @IntColumn_({nullable: false})
    activeOperators!: number

    @IntColumn_({nullable: false})
    totalReportsToday!: number

    @IntColumn_({nullable: false})
    totalDisputesToday!: number

    @IntColumn_({nullable: false})
    disputeRate!: number

    @BigIntColumn_({nullable: false})
    totalStaked!: bigint

    @BigIntColumn_({nullable: false})
    totalFeesCollected!: bigint

    @BigIntColumn_({nullable: false})
    feesToday!: bigint

    @IntColumn_({nullable: false})
    avgParticipationScore!: number

    @IntColumn_({nullable: false})
    avgAccuracyScore!: number

    @DateTimeColumn_({nullable: false})
    lastUpdated!: Date
}
