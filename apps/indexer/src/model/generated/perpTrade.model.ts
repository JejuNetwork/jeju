import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_, BigIntColumn as BigIntColumn_, StringColumn as StringColumn_, IntColumn as IntColumn_, DateTimeColumn as DateTimeColumn_} from "@subsquid/typeorm-store"
import {PerpMarket} from "./perpMarket.model"
import {PerpPosition} from "./perpPosition.model"
import {Account} from "./account.model"
import {PerpTradeType} from "./_perpTradeType"
import {PerpPositionSide} from "./_perpPositionSide"

@Entity_()
export class PerpTrade {
    constructor(props?: Partial<PerpTrade>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @ManyToOne_(() => PerpMarket, {nullable: true})
    market!: PerpMarket

    @Index_()
    @ManyToOne_(() => PerpPosition, {nullable: true})
    position!: PerpPosition | undefined | null

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    trader!: Account

    @Index_()
    @Column_("varchar", {length: 8, nullable: false})
    tradeType!: PerpTradeType

    @Column_("varchar", {length: 5, nullable: false})
    side!: PerpPositionSide

    @BigIntColumn_({nullable: false})
    size!: bigint

    @BigIntColumn_({nullable: false})
    price!: bigint

    @BigIntColumn_({nullable: false})
    margin!: bigint

    @StringColumn_({nullable: false})
    marginToken!: string

    @IntColumn_({nullable: false})
    leverage!: number

    @BigIntColumn_({nullable: false})
    fee!: bigint

    @BigIntColumn_({nullable: false})
    realizedPnl!: bigint

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
