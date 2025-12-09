import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, StringColumn as StringColumn_, Index as Index_, ManyToOne as ManyToOne_, BigIntColumn as BigIntColumn_, DateTimeColumn as DateTimeColumn_, IntColumn as IntColumn_} from "@subsquid/typeorm-store"
import {Account} from "./account.model"
import {StorageProvider} from "./storageProvider.model"
import {StorageDealStatus} from "./_storageDealStatus"
import {StorageTier} from "./_storageTier"

@Entity_()
export class StorageDeal {
    constructor(props?: Partial<StorageDeal>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_({unique: true})
    @StringColumn_({nullable: false})
    dealId!: string

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    user!: Account

    @Index_()
    @ManyToOne_(() => StorageProvider, {nullable: true})
    provider!: StorageProvider

    @Index_()
    @Column_("varchar", {length: 10, nullable: false})
    status!: StorageDealStatus

    @Index_()
    @StringColumn_({nullable: false})
    cid!: string

    @BigIntColumn_({nullable: false})
    sizeBytes!: bigint

    @Index_()
    @Column_("varchar", {length: 9, nullable: false})
    tier!: StorageTier

    @DateTimeColumn_({nullable: true})
    startTime!: Date | undefined | null

    @DateTimeColumn_({nullable: true})
    endTime!: Date | undefined | null

    @BigIntColumn_({nullable: false})
    totalCost!: bigint

    @BigIntColumn_({nullable: false})
    paidAmount!: bigint

    @BigIntColumn_({nullable: false})
    refundedAmount!: bigint

    @IntColumn_({nullable: false})
    replicationFactor!: number

    @IntColumn_({nullable: false})
    retrievalCount!: number

    @Index_()
    @DateTimeColumn_({nullable: false})
    createdAt!: Date

    @StringColumn_({nullable: false})
    txHash!: string

    @IntColumn_({nullable: false})
    blockNumber!: number

    @IntColumn_({nullable: true})
    rating!: number | undefined | null

    @StringColumn_({nullable: true})
    ratingComment!: string | undefined | null
}
