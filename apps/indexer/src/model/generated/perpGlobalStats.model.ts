import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, DateTimeColumn as DateTimeColumn_, Index as Index_, IntColumn as IntColumn_, BigIntColumn as BigIntColumn_} from "@subsquid/typeorm-store"

@Entity_()
export class PerpGlobalStats {
    constructor(props?: Partial<PerpGlobalStats>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @DateTimeColumn_({nullable: true})
    date!: Date | undefined | null

    @IntColumn_({nullable: false})
    totalMarkets!: number

    @IntColumn_({nullable: false})
    activeMarkets!: number

    @BigIntColumn_({nullable: false})
    totalVolume!: bigint

    @BigIntColumn_({nullable: false})
    volume24h!: bigint

    @IntColumn_({nullable: false})
    totalTrades!: number

    @IntColumn_({nullable: false})
    trades24h!: number

    @BigIntColumn_({nullable: false})
    totalOpenInterest!: bigint

    @BigIntColumn_({nullable: false})
    totalLongOI!: bigint

    @BigIntColumn_({nullable: false})
    totalShortOI!: bigint

    @IntColumn_({nullable: false})
    totalLiquidations!: number

    @IntColumn_({nullable: false})
    liquidations24h!: number

    @BigIntColumn_({nullable: false})
    totalFees!: bigint

    @BigIntColumn_({nullable: false})
    fees24h!: bigint

    @BigIntColumn_({nullable: false})
    totalBadDebt!: bigint

    @BigIntColumn_({nullable: false})
    insuranceFundBalance!: bigint

    @IntColumn_({nullable: false})
    uniqueTraders!: number

    @IntColumn_({nullable: false})
    activeTraders24h!: number

    @DateTimeColumn_({nullable: false})
    lastUpdated!: Date
}
