import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_, DateTimeColumn as DateTimeColumn_, BigIntColumn as BigIntColumn_, IntColumn as IntColumn_} from "@subsquid/typeorm-store"
import {PerpMarket} from "./perpMarket.model"

@Entity_()
export class PerpMarketStats {
    constructor(props?: Partial<PerpMarketStats>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @ManyToOne_(() => PerpMarket, {nullable: true})
    market!: PerpMarket | undefined | null

    @Index_()
    @DateTimeColumn_({nullable: true})
    date!: Date | undefined | null

    @BigIntColumn_({nullable: false})
    volume24h!: bigint

    @IntColumn_({nullable: false})
    trades24h!: number

    @IntColumn_({nullable: false})
    uniqueTraders24h!: number

    @BigIntColumn_({nullable: false})
    longOpenInterest!: bigint

    @BigIntColumn_({nullable: false})
    shortOpenInterest!: bigint

    @BigIntColumn_({nullable: false})
    totalOpenInterest!: bigint

    @BigIntColumn_({nullable: false})
    highPrice24h!: bigint

    @BigIntColumn_({nullable: false})
    lowPrice24h!: bigint

    @BigIntColumn_({nullable: false})
    openPrice24h!: bigint

    @BigIntColumn_({nullable: false})
    closePrice24h!: bigint

    @BigIntColumn_({nullable: false})
    fundingRate!: bigint

    @BigIntColumn_({nullable: false})
    cumulativeFunding24h!: bigint

    @IntColumn_({nullable: false})
    liquidations24h!: number

    @BigIntColumn_({nullable: false})
    liquidationVolume24h!: bigint

    @BigIntColumn_({nullable: false})
    totalFees24h!: bigint

    @BigIntColumn_({nullable: false})
    insuranceFundFees24h!: bigint

    @DateTimeColumn_({nullable: false})
    lastUpdated!: Date
}
