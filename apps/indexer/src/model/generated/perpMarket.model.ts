import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, StringColumn as StringColumn_, Index as Index_, IntColumn as IntColumn_, BigIntColumn as BigIntColumn_, BooleanColumn as BooleanColumn_, DateTimeColumn as DateTimeColumn_, OneToMany as OneToMany_} from "@subsquid/typeorm-store"
import {PerpPosition} from "./perpPosition.model"
import {PerpTrade} from "./perpTrade.model"
import {PerpLiquidation} from "./perpLiquidation.model"
import {PerpFundingPayment} from "./perpFundingPayment.model"

@Entity_()
export class PerpMarket {
    constructor(props?: Partial<PerpMarket>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_({unique: true})
    @StringColumn_({nullable: false})
    marketId!: string

    @Index_()
    @StringColumn_({nullable: false})
    symbol!: string

    @StringColumn_({nullable: false})
    oracleAsset!: string

    @StringColumn_({nullable: true})
    settlementToken!: string | undefined | null

    @IntColumn_({nullable: false})
    maxLeverage!: number

    @IntColumn_({nullable: false})
    maintenanceMarginBps!: number

    @IntColumn_({nullable: false})
    liquidationFeeBps!: number

    @IntColumn_({nullable: false})
    makerFeeBps!: number

    @IntColumn_({nullable: false})
    takerFeeBps!: number

    @BigIntColumn_({nullable: false})
    maxOpenInterest!: bigint

    @Index_()
    @BooleanColumn_({nullable: false})
    isActive!: boolean

    @Index_()
    @DateTimeColumn_({nullable: false})
    createdAt!: Date

    @StringColumn_({nullable: false})
    createdTxHash!: string

    @BigIntColumn_({nullable: false})
    markPrice!: bigint

    @BigIntColumn_({nullable: false})
    indexPrice!: bigint

    @BigIntColumn_({nullable: false})
    fundingRate!: bigint

    @DateTimeColumn_({nullable: false})
    lastFundingTime!: Date

    @BigIntColumn_({nullable: false})
    longOpenInterest!: bigint

    @BigIntColumn_({nullable: false})
    shortOpenInterest!: bigint

    @BigIntColumn_({nullable: false})
    totalVolume!: bigint

    @IntColumn_({nullable: false})
    totalTrades!: number

    @IntColumn_({nullable: false})
    totalLiquidations!: number

    @BigIntColumn_({nullable: false})
    totalFundingPaid!: bigint

    @OneToMany_(() => PerpPosition, e => e.market)
    positions!: PerpPosition[]

    @OneToMany_(() => PerpTrade, e => e.market)
    trades!: PerpTrade[]

    @OneToMany_(() => PerpLiquidation, e => e.market)
    liquidations!: PerpLiquidation[]

    @OneToMany_(() => PerpFundingPayment, e => e.market)
    fundingPayments!: PerpFundingPayment[]
}
