import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, DateTimeColumn as DateTimeColumn_, Index as Index_, IntColumn as IntColumn_, BigIntColumn as BigIntColumn_} from "@subsquid/typeorm-store"

@Entity_()
export class JNSStats {
    constructor(props?: Partial<JNSStats>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @DateTimeColumn_({nullable: true})
    date!: Date | undefined | null

    @IntColumn_({nullable: false})
    totalNames!: number

    @IntColumn_({nullable: false})
    activeNames!: number

    @IntColumn_({nullable: false})
    expiredNames!: number

    @IntColumn_({nullable: false})
    totalOwners!: number

    @BigIntColumn_({nullable: false})
    totalRevenue!: bigint

    @IntColumn_({nullable: false})
    registrationsToday!: number

    @IntColumn_({nullable: false})
    renewalsToday!: number

    @IntColumn_({nullable: false})
    transfersToday!: number

    @BigIntColumn_({nullable: false})
    floorPrice!: bigint

    @BigIntColumn_({nullable: false})
    avgSalePrice!: bigint

    @IntColumn_({nullable: false})
    totalListings!: number

    @IntColumn_({nullable: false})
    activeListings!: number

    @DateTimeColumn_({nullable: false})
    lastUpdated!: Date
}
