import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, StringColumn as StringColumn_, Index as Index_, ManyToOne as ManyToOne_, IntColumn as IntColumn_, BooleanColumn as BooleanColumn_, DateTimeColumn as DateTimeColumn_, BigIntColumn as BigIntColumn_, OneToMany as OneToMany_} from "@subsquid/typeorm-store"
import {Account} from "./account.model"
import {ENSMirrorSync} from "./ensMirrorSync.model"

@Entity_()
export class ENSMirror {
    constructor(props?: Partial<ENSMirror>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @StringColumn_({nullable: false})
    ensNode!: string

    @Index_()
    @StringColumn_({nullable: false})
    jnsNode!: string

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    owner!: Account

    @IntColumn_({nullable: false})
    syncInterval!: number

    @BooleanColumn_({nullable: false})
    mirrorContenthash!: boolean

    @BooleanColumn_({nullable: false})
    mirrorAddress!: boolean

    @StringColumn_({array: true, nullable: false})
    textKeys!: (string)[]

    @BooleanColumn_({nullable: false})
    active!: boolean

    @DateTimeColumn_({nullable: false})
    createdAt!: Date

    @DateTimeColumn_({nullable: true})
    lastSyncAt!: Date | undefined | null

    @IntColumn_({nullable: false})
    syncCount!: number

    @BigIntColumn_({nullable: true})
    lastEthBlock!: bigint | undefined | null

    @OneToMany_(() => ENSMirrorSync, e => e.mirror)
    syncs!: ENSMirrorSync[]
}
