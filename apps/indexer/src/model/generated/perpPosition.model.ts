import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, StringColumn as StringColumn_, Index as Index_, ManyToOne as ManyToOne_, BigIntColumn as BigIntColumn_, IntColumn as IntColumn_, DateTimeColumn as DateTimeColumn_, OneToMany as OneToMany_} from "@subsquid/typeorm-store"
import {PerpMarket} from "./perpMarket.model"
import {Account} from "./account.model"
import {PerpPositionSide} from "./_perpPositionSide"
import {PerpPositionStatus} from "./_perpPositionStatus"
import {PerpTrade} from "./perpTrade.model"
import {PerpFundingPayment} from "./perpFundingPayment.model"

@Entity_()
export class PerpPosition {
    constructor(props?: Partial<PerpPosition>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_({unique: true})
    @StringColumn_({nullable: false})
    positionId!: string

    @Index_()
    @ManyToOne_(() => PerpMarket, {nullable: true})
    market!: PerpMarket

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    trader!: Account

    @Index_()
    @Column_("varchar", {length: 5, nullable: false})
    side!: PerpPositionSide

    @Index_()
    @Column_("varchar", {length: 10, nullable: false})
    status!: PerpPositionStatus

    @BigIntColumn_({nullable: false})
    size!: bigint

    @BigIntColumn_({nullable: false})
    margin!: bigint

    @StringColumn_({nullable: false})
    marginToken!: string

    @BigIntColumn_({nullable: false})
    entryPrice!: bigint

    @IntColumn_({nullable: false})
    leverage!: number

    @BigIntColumn_({nullable: false})
    markPrice!: bigint

    @BigIntColumn_({nullable: false})
    unrealizedPnl!: bigint

    @BigIntColumn_({nullable: false})
    liquidationPrice!: bigint

    @BigIntColumn_({nullable: false})
    healthFactor!: bigint

    @BigIntColumn_({nullable: false})
    realizedPnl!: bigint

    @BigIntColumn_({nullable: false})
    fundingPaid!: bigint

    @BigIntColumn_({nullable: false})
    feePaid!: bigint

    @Index_()
    @DateTimeColumn_({nullable: false})
    openedAt!: Date

    @DateTimeColumn_({nullable: true})
    closedAt!: Date | undefined | null

    @StringColumn_({nullable: false})
    openTxHash!: string

    @StringColumn_({nullable: true})
    closeTxHash!: string | undefined | null

    @OneToMany_(() => PerpTrade, e => e.position)
    trades!: PerpTrade[]

    @OneToMany_(() => PerpFundingPayment, e => e.position)
    fundingPayments!: PerpFundingPayment[]
}
