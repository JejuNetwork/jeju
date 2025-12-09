import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, StringColumn as StringColumn_, Index as Index_, BigIntColumn as BigIntColumn_, IntColumn as IntColumn_, BooleanColumn as BooleanColumn_, DateTimeColumn as DateTimeColumn_, OneToMany as OneToMany_} from "@subsquid/typeorm-store"
import {StorageProviderType} from "./_storageProviderType"
import {StorageTier} from "./_storageTier"
import {StorageDeal} from "./storageDeal.model"

@Entity_()
export class StorageProvider {
    constructor(props?: Partial<StorageProvider>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_({unique: true})
    @StringColumn_({nullable: false})
    address!: string

    @StringColumn_({nullable: false})
    name!: string

    @StringColumn_({nullable: false})
    endpoint!: string

    @Index_()
    @Column_("varchar", {length: 12, nullable: false})
    providerType!: StorageProviderType

    @StringColumn_({nullable: true})
    attestationHash!: string | undefined | null

    @BigIntColumn_({nullable: false})
    stakeAmount!: bigint

    @IntColumn_({nullable: true})
    agentId!: number | undefined | null

    @Index_()
    @BooleanColumn_({nullable: false})
    isActive!: boolean

    @BooleanColumn_({nullable: false})
    isVerified!: boolean

    @Index_()
    @DateTimeColumn_({nullable: false})
    registeredAt!: Date

    @Index_()
    @DateTimeColumn_({nullable: false})
    lastUpdated!: Date

    @BigIntColumn_({nullable: false})
    totalCapacityGB!: bigint

    @BigIntColumn_({nullable: false})
    usedCapacityGB!: bigint

    @BigIntColumn_({nullable: false})
    availableCapacityGB!: bigint

    @BigIntColumn_({nullable: false})
    pricePerGBMonth!: bigint

    @BigIntColumn_({nullable: false})
    uploadPricePerGB!: bigint

    @BigIntColumn_({nullable: false})
    retrievalPricePerGB!: bigint

    @IntColumn_({nullable: false})
    minStoragePeriodDays!: number

    @IntColumn_({nullable: false})
    maxStoragePeriodDays!: number

    @IntColumn_({nullable: false})
    healthScore!: number

    @IntColumn_({nullable: false})
    avgLatencyMs!: number

    @IntColumn_({nullable: false})
    replicationFactor!: number

    @StringColumn_({nullable: true})
    ipfsGateway!: string | undefined | null

    @Column_("varchar", {length: 9, array: true, nullable: false})
    supportedTiers!: (StorageTier)[]

    @IntColumn_({nullable: false})
    totalDeals!: number

    @IntColumn_({nullable: false})
    activeDeals!: number

    @IntColumn_({nullable: false})
    completedDeals!: number

    @IntColumn_({nullable: false})
    failedDeals!: number

    @BigIntColumn_({nullable: false})
    totalStoredGB!: bigint

    @BigIntColumn_({nullable: false})
    totalEarnings!: bigint

    @IntColumn_({nullable: false})
    avgRating!: number

    @IntColumn_({nullable: false})
    ratingCount!: number

    @IntColumn_({nullable: false})
    uptimePercent!: number

    @OneToMany_(() => StorageDeal, e => e.provider)
    deals!: StorageDeal[]
}
