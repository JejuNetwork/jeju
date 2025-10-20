import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, DateTimeColumn as DateTimeColumn_, BigIntColumn as BigIntColumn_} from "@subsquid/typeorm-store"

@Entity_()
export class StorageStats {
    constructor(props?: Partial<StorageStats>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @DateTimeColumn_({nullable: false})
    date!: Date

    @BigIntColumn_({nullable: false})
    totalFiles!: bigint

    @BigIntColumn_({nullable: false})
    totalSizeBytes!: bigint

    @BigIntColumn_({nullable: false})
    totalRevenue!: bigint

    @BigIntColumn_({nullable: false})
    activeUsers!: bigint

    @BigIntColumn_({nullable: false})
    evidenceFiles!: bigint

    @BigIntColumn_({nullable: false})
    attestationFiles!: bigint

    @BigIntColumn_({nullable: false})
    assetFiles!: bigint

    @BigIntColumn_({nullable: false})
    metadataFiles!: bigint
}
