import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_, BigIntColumn as BigIntColumn_, StringColumn as StringColumn_, IntColumn as IntColumn_, DateTimeColumn as DateTimeColumn_} from "@subsquid/typeorm-store"
import {DEXPool} from "./dexPool.model"
import {Transaction} from "./transaction.model"
import {Account} from "./account.model"
import {Token} from "./token.model"

/**
 * Individual swap event from a DEX.
 */
@Entity_()
export class Swap {
    constructor(props?: Partial<Swap>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @ManyToOne_(() => DEXPool, {nullable: true})
    pool!: DEXPool

    @Index_()
    @ManyToOne_(() => Transaction, {nullable: true})
    transaction!: Transaction

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    sender!: Account

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    recipient!: Account

    @Index_()
    @ManyToOne_(() => Token, {nullable: true})
    tokenIn!: Token

    @Index_()
    @ManyToOne_(() => Token, {nullable: true})
    tokenOut!: Token

    @BigIntColumn_({nullable: false})
    amountIn!: bigint

    @BigIntColumn_({nullable: false})
    amountOut!: bigint

    @StringColumn_({nullable: true})
    amountInUSD!: string | undefined | null

    @StringColumn_({nullable: true})
    amountOutUSD!: string | undefined | null

    @StringColumn_({nullable: true})
    priceIn!: string | undefined | null

    @StringColumn_({nullable: true})
    priceOut!: string | undefined | null

    @IntColumn_({nullable: true})
    priceImpactBps!: number | undefined | null

    @Index_()
    @DateTimeColumn_({nullable: false})
    timestamp!: Date

    @Index_()
    @IntColumn_({nullable: false})
    blockNumber!: number

    @IntColumn_({nullable: false})
    logIndex!: number
}
