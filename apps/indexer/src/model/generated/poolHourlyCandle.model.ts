import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_, DateTimeColumn as DateTimeColumn_, BigIntColumn as BigIntColumn_, StringColumn as StringColumn_, IntColumn as IntColumn_} from "@subsquid/typeorm-store"
import {DEXPool} from "./dexPool.model"

/**
 * Hourly OHLCV for a specific pool.
 */
@Entity_()
export class PoolHourlyCandle {
    constructor(props?: Partial<PoolHourlyCandle>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @ManyToOne_(() => DEXPool, {nullable: true})
    pool!: DEXPool

    @Index_()
    @DateTimeColumn_({nullable: false})
    periodStart!: Date

    @BigIntColumn_({nullable: false})
    reserve0!: bigint

    @BigIntColumn_({nullable: false})
    reserve1!: bigint

    @StringColumn_({nullable: false})
    liquidityUSD!: string

    @BigIntColumn_({nullable: false})
    volumeToken0!: bigint

    @BigIntColumn_({nullable: false})
    volumeToken1!: bigint

    @StringColumn_({nullable: false})
    volumeUSD!: string

    @IntColumn_({nullable: false})
    txCount!: number

    @StringColumn_({nullable: false})
    open!: string

    @StringColumn_({nullable: false})
    close!: string

    @StringColumn_({nullable: false})
    high!: string

    @StringColumn_({nullable: false})
    low!: string
}
