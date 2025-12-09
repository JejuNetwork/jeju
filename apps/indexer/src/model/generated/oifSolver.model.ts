import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, StringColumn as StringColumn_, Index as Index_, BigIntColumn as BigIntColumn_, BooleanColumn as BooleanColumn_, DateTimeColumn as DateTimeColumn_, IntColumn as IntColumn_, OneToMany as OneToMany_} from "@subsquid/typeorm-store"
import {OIFSolverLiquidity} from "./oifSolverLiquidity.model"
import {OIFIntent} from "./oifIntent.model"
import {OIFSettlement} from "./oifSettlement.model"
import {OIFSlashEvent} from "./oifSlashEvent.model"

@Entity_()
export class OIFSolver {
    constructor(props?: Partial<OIFSolver>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_({unique: true})
    @StringColumn_({nullable: false})
    address!: string

    @StringColumn_({nullable: true})
    name!: string | undefined | null

    @StringColumn_({nullable: true})
    endpoint!: string | undefined | null

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

    @Index_()
    @DateTimeColumn_({nullable: false})
    lastActiveAt!: Date

    @IntColumn_({array: true, nullable: false})
    supportedChains!: (number)[]

    @IntColumn_({nullable: false})
    totalFills!: number

    @IntColumn_({nullable: false})
    successfulFills!: number

    @IntColumn_({nullable: false})
    failedFills!: number

    @IntColumn_({nullable: false})
    successRate!: number

    @IntColumn_({nullable: false})
    averageResponseMs!: number

    @IntColumn_({nullable: false})
    averageFillTimeMs!: number

    @BigIntColumn_({nullable: false})
    totalVolumeUsd!: bigint

    @BigIntColumn_({nullable: false})
    totalFeesEarned!: bigint

    @Index_()
    @IntColumn_({nullable: false})
    reputation!: number

    @OneToMany_(() => OIFSolverLiquidity, e => e.solver)
    liquidity!: OIFSolverLiquidity[]

    @OneToMany_(() => OIFIntent, e => e.solver)
    fills!: OIFIntent[]

    @OneToMany_(() => OIFSettlement, e => e.solver)
    settlements!: OIFSettlement[]

    @OneToMany_(() => OIFSlashEvent, e => e.solver)
    slashEvents!: OIFSlashEvent[]
}
