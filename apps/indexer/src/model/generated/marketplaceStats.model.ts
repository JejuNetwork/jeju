import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, DateTimeColumn as DateTimeColumn_, Index as Index_, IntColumn as IntColumn_, BigIntColumn as BigIntColumn_} from "@subsquid/typeorm-store"

@Entity_()
export class MarketplaceStats {
    constructor(props?: Partial<MarketplaceStats>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @DateTimeColumn_({nullable: true})
    date!: Date | undefined | null

    @IntColumn_({nullable: false})
    computeProviders!: number

    @IntColumn_({nullable: false})
    activeComputeProviders!: number

    @IntColumn_({nullable: false})
    computeAgentLinked!: number

    @IntColumn_({nullable: false})
    totalComputeRentals!: number

    @IntColumn_({nullable: false})
    activeComputeRentals!: number

    @BigIntColumn_({nullable: false})
    computeStaked!: bigint

    @BigIntColumn_({nullable: false})
    computeEarnings!: bigint

    @IntColumn_({nullable: false})
    storageProviders!: number

    @IntColumn_({nullable: false})
    activeStorageProviders!: number

    @IntColumn_({nullable: false})
    storageAgentLinked!: number

    @IntColumn_({nullable: false})
    totalStorageDeals!: number

    @IntColumn_({nullable: false})
    activeStorageDeals!: number

    @BigIntColumn_({nullable: false})
    storageCapacityTB!: bigint

    @BigIntColumn_({nullable: false})
    storageUsedTB!: bigint

    @BigIntColumn_({nullable: false})
    storageStaked!: bigint

    @IntColumn_({nullable: false})
    totalContainerImages!: number

    @IntColumn_({nullable: false})
    verifiedContainerImages!: number

    @IntColumn_({nullable: false})
    totalCrossServiceRequests!: number

    @IntColumn_({nullable: false})
    successfulRequests!: number

    @IntColumn_({nullable: false})
    fullStackAgents!: number

    @IntColumn_({nullable: false})
    last24hContainerPulls!: number

    @BigIntColumn_({nullable: false})
    last24hCrossServiceVolume!: bigint

    @DateTimeColumn_({nullable: false})
    lastUpdated!: Date
}
