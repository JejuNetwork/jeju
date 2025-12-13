import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_, BigIntColumn as BigIntColumn_, DateTimeColumn as DateTimeColumn_, StringColumn as StringColumn_, IntColumn as IntColumn_} from "@subsquid/typeorm-store"
import {PerpMarket} from "./perpMarket.model"
import {PerpPosition} from "./perpPosition.model"
import {Account} from "./account.model"

@Entity_()
export class PerpLiquidation {
    constructor(props?: Partial<PerpLiquidation>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @ManyToOne_(() => PerpMarket, {nullable: true})
    market!: PerpMarket

    @Index_()
    @ManyToOne_(() => PerpPosition, {nullable: true})
    position!: PerpPosition

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    liquidator!: Account

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    trader!: Account

    @BigIntColumn_({nullable: false})
    size!: bigint

    @BigIntColumn_({nullable: false})
    margin!: bigint

    @BigIntColumn_({nullable: false})
    liquidationPrice!: bigint

    @BigIntColumn_({nullable: false})
    markPrice!: bigint

    @BigIntColumn_({nullable: false})
    liquidatorReward!: bigint

    @BigIntColumn_({nullable: false})
    insuranceFundFee!: bigint

    @BigIntColumn_({nullable: false})
    badDebt!: bigint

    @Index_()
    @DateTimeColumn_({nullable: false})
    timestamp!: Date

    @Index_()
    @StringColumn_({nullable: false})
    txHash!: string

    @Index_()
    @IntColumn_({nullable: false})
    blockNumber!: number
}
