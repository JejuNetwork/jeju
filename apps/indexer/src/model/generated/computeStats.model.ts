import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, DateTimeColumn as DateTimeColumn_, Index as Index_, IntColumn as IntColumn_, BigIntColumn as BigIntColumn_} from "@subsquid/typeorm-store"

@Entity_()
export class ComputeStats {
    constructor(props?: Partial<ComputeStats>) {
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
    totalResources!: number

    @IntColumn_({nullable: false})
    availableResources!: number

    @IntColumn_({nullable: false})
    totalRentals!: number

    @IntColumn_({nullable: false})
    activeRentals!: number

    @IntColumn_({nullable: false})
    completedRentals!: number

    @IntColumn_({nullable: false})
    totalInferenceRequests!: number

    @BigIntColumn_({nullable: false})
    totalStaked!: bigint

    @BigIntColumn_({nullable: false})
    totalEarnings!: bigint

    @IntColumn_({nullable: false})
    last24hRentals!: number

    @IntColumn_({nullable: false})
    last24hInference!: number

    @DateTimeColumn_({nullable: false})
    lastUpdated!: Date
}
