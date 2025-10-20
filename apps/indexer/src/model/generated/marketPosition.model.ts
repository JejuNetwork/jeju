import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_, BigIntColumn as BigIntColumn_, BooleanColumn as BooleanColumn_, DateTimeColumn as DateTimeColumn_} from "@subsquid/typeorm-store"
import {PredictionMarket} from "./predictionMarket.model"
import {Account} from "./account.model"

@Entity_()
export class MarketPosition {
    constructor(props?: Partial<MarketPosition>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @ManyToOne_(() => PredictionMarket, {nullable: true})
    market!: PredictionMarket

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    trader!: Account

    @BigIntColumn_({nullable: false})
    yesShares!: bigint

    @BigIntColumn_({nullable: false})
    noShares!: bigint

    @BigIntColumn_({nullable: false})
    totalSpent!: bigint

    @BigIntColumn_({nullable: false})
    totalReceived!: bigint

    @BooleanColumn_({nullable: false})
    hasClaimed!: boolean

    @Index_()
    @DateTimeColumn_({nullable: false})
    lastUpdated!: Date
}
