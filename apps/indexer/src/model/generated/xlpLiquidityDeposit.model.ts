import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_, StringColumn as StringColumn_, IntColumn as IntColumn_, BigIntColumn as BigIntColumn_, DateTimeColumn as DateTimeColumn_} from "@subsquid/typeorm-store"
import {XLP} from "./xlp.model"

@Entity_()
export class XLPLiquidityDeposit {
    constructor(props?: Partial<XLPLiquidityDeposit>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @ManyToOne_(() => XLP, {nullable: true})
    xlp!: XLP

    @Index_()
    @StringColumn_({nullable: false})
    token!: string

    @Index_()
    @IntColumn_({nullable: false})
    chainId!: number

    @BigIntColumn_({nullable: false})
    amount!: bigint

    @BigIntColumn_({nullable: false})
    ethAmount!: bigint

    @Index_()
    @DateTimeColumn_({nullable: false})
    lastUpdated!: Date
}
