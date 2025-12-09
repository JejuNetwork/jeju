import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, DateTimeColumn as DateTimeColumn_, Index as Index_, BigIntColumn as BigIntColumn_, IntColumn as IntColumn_} from "@subsquid/typeorm-store"

@Entity_()
export class OIFStats {
    constructor(props?: Partial<OIFStats>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @DateTimeColumn_({nullable: true})
    date!: Date | undefined | null

    @BigIntColumn_({nullable: false})
    totalIntents!: bigint

    @IntColumn_({nullable: false})
    openIntents!: number

    @IntColumn_({nullable: false})
    pendingIntents!: number

    @IntColumn_({nullable: false})
    filledIntents!: number

    @IntColumn_({nullable: false})
    expiredIntents!: number

    @BigIntColumn_({nullable: false})
    totalVolume!: bigint

    @BigIntColumn_({nullable: false})
    totalVolumeUsd!: bigint

    @BigIntColumn_({nullable: false})
    totalFees!: bigint

    @BigIntColumn_({nullable: false})
    totalFeesUsd!: bigint

    @IntColumn_({nullable: false})
    totalSolvers!: number

    @IntColumn_({nullable: false})
    activeSolvers!: number

    @BigIntColumn_({nullable: false})
    totalSolverStake!: bigint

    @IntColumn_({nullable: false})
    totalRoutes!: number

    @IntColumn_({nullable: false})
    activeRoutes!: number

    @IntColumn_({nullable: false})
    averageFillTimeSeconds!: number

    @IntColumn_({nullable: false})
    successRate!: number

    @IntColumn_({nullable: false})
    last24hIntents!: number

    @BigIntColumn_({nullable: false})
    last24hVolume!: bigint

    @BigIntColumn_({nullable: false})
    last24hFees!: bigint

    @DateTimeColumn_({nullable: false})
    lastUpdated!: Date
}
