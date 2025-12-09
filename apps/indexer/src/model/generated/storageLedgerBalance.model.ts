import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_, BigIntColumn as BigIntColumn_, DateTimeColumn as DateTimeColumn_} from "@subsquid/typeorm-store"
import {Account} from "./account.model"
import {StorageProvider} from "./storageProvider.model"

@Entity_()
export class StorageLedgerBalance {
    constructor(props?: Partial<StorageLedgerBalance>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    user!: Account

    @Index_()
    @ManyToOne_(() => StorageProvider, {nullable: true})
    provider!: StorageProvider | undefined | null

    @BigIntColumn_({nullable: false})
    totalBalance!: bigint

    @BigIntColumn_({nullable: false})
    availableBalance!: bigint

    @BigIntColumn_({nullable: false})
    lockedBalance!: bigint

    @BigIntColumn_({nullable: false})
    pendingRefund!: bigint

    @DateTimeColumn_({nullable: true})
    refundUnlockTime!: Date | undefined | null

    @Index_()
    @DateTimeColumn_({nullable: false})
    lastUpdated!: Date
}
