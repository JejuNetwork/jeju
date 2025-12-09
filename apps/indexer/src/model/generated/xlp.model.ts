import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, StringColumn as StringColumn_, Index as Index_, BigIntColumn as BigIntColumn_, BooleanColumn as BooleanColumn_, DateTimeColumn as DateTimeColumn_, IntColumn as IntColumn_, OneToMany as OneToMany_} from "@subsquid/typeorm-store"
import {XLPLiquidityDeposit} from "./xlpLiquidityDeposit.model"
import {CrossChainVoucher} from "./crossChainVoucher.model"

@Entity_()
export class XLP {
    constructor(props?: Partial<XLP>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_({unique: true})
    @StringColumn_({nullable: false})
    address!: string

    @BigIntColumn_({nullable: false})
    stakedAmount!: bigint

    @BigIntColumn_({nullable: false})
    unbondingAmount!: bigint

    @BigIntColumn_({nullable: true})
    unbondingStartTime!: bigint | undefined | null

    @BigIntColumn_({nullable: false})
    slashedAmount!: bigint

    @Index_()
    @BooleanColumn_({nullable: false})
    isActive!: boolean

    @Index_()
    @DateTimeColumn_({nullable: false})
    registeredAt!: Date

    @IntColumn_({array: true, nullable: false})
    supportedChains!: (number)[]

    @IntColumn_({nullable: false})
    totalVouchersIssued!: number

    @IntColumn_({nullable: false})
    totalVouchersFulfilled!: number

    @IntColumn_({nullable: false})
    totalVouchersFailed!: number

    @BigIntColumn_({nullable: false})
    totalFeesEarned!: bigint

    @IntColumn_({nullable: false})
    averageResponseTimeMs!: number

    @Index_()
    @IntColumn_({nullable: false})
    reputation!: number

    @OneToMany_(() => XLPLiquidityDeposit, e => e.xlp)
    liquidityDeposits!: XLPLiquidityDeposit[]

    @OneToMany_(() => CrossChainVoucher, e => e.xlp)
    vouchersIssued!: CrossChainVoucher[]
}
