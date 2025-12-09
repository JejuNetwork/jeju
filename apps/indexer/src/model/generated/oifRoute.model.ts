import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, StringColumn as StringColumn_, Index as Index_, IntColumn as IntColumn_, BooleanColumn as BooleanColumn_, BigIntColumn as BigIntColumn_, DateTimeColumn as DateTimeColumn_} from "@subsquid/typeorm-store"
import {OIFOracleType} from "./_oifOracleType"

@Entity_()
export class OIFRoute {
    constructor(props?: Partial<OIFRoute>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_({unique: true})
    @StringColumn_({nullable: false})
    routeId!: string

    @Index_()
    @IntColumn_({nullable: false})
    sourceChainId!: number

    @Index_()
    @IntColumn_({nullable: false})
    destinationChainId!: number

    @StringColumn_({nullable: false})
    inputSettler!: string

    @StringColumn_({nullable: false})
    outputSettler!: string

    @Column_("varchar", {length: 15, nullable: false})
    oracle!: OIFOracleType

    @StringColumn_({nullable: true})
    oracleAddress!: string | undefined | null

    @Index_()
    @BooleanColumn_({nullable: false})
    isActive!: boolean

    @BigIntColumn_({nullable: false})
    totalVolume!: bigint

    @BigIntColumn_({nullable: false})
    totalVolumeUsd!: bigint

    @IntColumn_({nullable: false})
    totalIntents!: number

    @IntColumn_({nullable: false})
    successfulIntents!: number

    @IntColumn_({nullable: false})
    failedIntents!: number

    @IntColumn_({nullable: false})
    averageFeePercent!: number

    @IntColumn_({nullable: false})
    averageFillTimeSeconds!: number

    @IntColumn_({nullable: false})
    successRate!: number

    @IntColumn_({nullable: false})
    activeSolvers!: number

    @BigIntColumn_({nullable: false})
    totalLiquidity!: bigint

    @Index_()
    @DateTimeColumn_({nullable: false})
    createdAt!: Date

    @Index_()
    @DateTimeColumn_({nullable: false})
    lastUpdated!: Date
}
