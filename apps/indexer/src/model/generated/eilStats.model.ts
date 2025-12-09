import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, DateTimeColumn as DateTimeColumn_, Index as Index_, BigIntColumn as BigIntColumn_, IntColumn as IntColumn_} from "@subsquid/typeorm-store"

@Entity_()
export class EILStats {
    constructor(props?: Partial<EILStats>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @DateTimeColumn_({nullable: true})
    date!: Date | undefined | null

    @BigIntColumn_({nullable: false})
    totalVolumeUsd!: bigint

    @BigIntColumn_({nullable: false})
    totalTransactions!: bigint

    @IntColumn_({nullable: false})
    totalXLPs!: number

    @IntColumn_({nullable: false})
    activeXLPs!: number

    @BigIntColumn_({nullable: false})
    totalStakedEth!: bigint

    @IntColumn_({nullable: false})
    averageFeePercent!: number

    @IntColumn_({nullable: false})
    averageTimeSeconds!: number

    @IntColumn_({nullable: false})
    successRate!: number

    @BigIntColumn_({nullable: false})
    last24hVolume!: bigint

    @BigIntColumn_({nullable: false})
    last24hTransactions!: bigint
}
