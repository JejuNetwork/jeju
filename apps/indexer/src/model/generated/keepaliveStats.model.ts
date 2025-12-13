import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, DateTimeColumn as DateTimeColumn_, Index as Index_, IntColumn as IntColumn_, BigIntColumn as BigIntColumn_} from "@subsquid/typeorm-store"

@Entity_()
export class KeepaliveStats {
    constructor(props?: Partial<KeepaliveStats>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @DateTimeColumn_({nullable: true})
    date!: Date | undefined | null

    @IntColumn_({nullable: false})
    totalKeepalives!: number

    @IntColumn_({nullable: false})
    activeKeepalives!: number

    @IntColumn_({nullable: false})
    healthyCount!: number

    @IntColumn_({nullable: false})
    degradedCount!: number

    @IntColumn_({nullable: false})
    unhealthyCount!: number

    @IntColumn_({nullable: false})
    unfundedCount!: number

    @BigIntColumn_({nullable: false})
    totalFundedValue!: bigint

    @BigIntColumn_({nullable: false})
    totalAutoFunded!: bigint

    @IntColumn_({nullable: false})
    totalHealthChecks!: number

    @IntColumn_({nullable: false})
    mirrorCount!: number

    @IntColumn_({nullable: false})
    syncedMirrors!: number

    @DateTimeColumn_({nullable: false})
    lastUpdated!: Date
}
