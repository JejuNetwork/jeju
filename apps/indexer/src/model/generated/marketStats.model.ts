import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, DateTimeColumn as DateTimeColumn_, Index as Index_, BigIntColumn as BigIntColumn_} from "@subsquid/typeorm-store"

@Entity_()
export class MarketStats {
    constructor(props?: Partial<MarketStats>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @DateTimeColumn_({nullable: false})
    date!: Date

    @BigIntColumn_({nullable: false})
    totalMarkets!: bigint

    @BigIntColumn_({nullable: false})
    activeMarkets!: bigint

    @BigIntColumn_({nullable: false})
    resolvedMarkets!: bigint

    @BigIntColumn_({nullable: false})
    totalVolume!: bigint

    @BigIntColumn_({nullable: false})
    totalTrades!: bigint

    @BigIntColumn_({nullable: false})
    uniqueTraders!: bigint
}
