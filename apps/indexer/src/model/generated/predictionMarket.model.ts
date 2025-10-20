import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, StringColumn as StringColumn_, Index as Index_, BigIntColumn as BigIntColumn_, DateTimeColumn as DateTimeColumn_, BooleanColumn as BooleanColumn_, OneToMany as OneToMany_} from "@subsquid/typeorm-store"
import {MarketTrade} from "./marketTrade.model"
import {MarketPosition} from "./marketPosition.model"

@Entity_()
export class PredictionMarket {
    constructor(props?: Partial<PredictionMarket>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_({unique: true})
    @StringColumn_({nullable: false})
    sessionId!: string

    @StringColumn_({nullable: false})
    question!: string

    @BigIntColumn_({nullable: false})
    liquidityB!: bigint

    @BigIntColumn_({nullable: false})
    yesShares!: bigint

    @BigIntColumn_({nullable: false})
    noShares!: bigint

    @BigIntColumn_({nullable: false})
    totalVolume!: bigint

    @Index_()
    @DateTimeColumn_({nullable: false})
    createdAt!: Date

    @Index_()
    @BooleanColumn_({nullable: false})
    resolved!: boolean

    @BooleanColumn_({nullable: true})
    outcome!: boolean | undefined | null

    @OneToMany_(() => MarketTrade, e => e.market)
    trades!: MarketTrade[]

    @OneToMany_(() => MarketPosition, e => e.market)
    positions!: MarketPosition[]
}
