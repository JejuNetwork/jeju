import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, DateTimeColumn as DateTimeColumn_, Index as Index_, IntColumn as IntColumn_, BigIntColumn as BigIntColumn_} from "@subsquid/typeorm-store"

@Entity_()
export class StorageMarketStats {
    constructor(props?: Partial<StorageMarketStats>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @DateTimeColumn_({nullable: true})
    date!: Date | undefined | null

    @IntColumn_({nullable: false})
    totalProviders!: number

    @IntColumn_({nullable: false})
    activeProviders!: number

    @IntColumn_({nullable: false})
    verifiedProviders!: number

    @BigIntColumn_({nullable: false})
    totalCapacityTB!: bigint

    @BigIntColumn_({nullable: false})
    usedCapacityTB!: bigint

    @IntColumn_({nullable: false})
    totalDeals!: number

    @IntColumn_({nullable: false})
    activeDeals!: number

    @IntColumn_({nullable: false})
    completedDeals!: number

    @BigIntColumn_({nullable: false})
    totalStaked!: bigint

    @BigIntColumn_({nullable: false})
    totalEarnings!: bigint

    @BigIntColumn_({nullable: false})
    avgPricePerGBMonth!: bigint

    @IntColumn_({nullable: false})
    last24hDeals!: number

    @BigIntColumn_({nullable: false})
    last24hVolume!: bigint

    @DateTimeColumn_({nullable: false})
    lastUpdated!: Date
}
