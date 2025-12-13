import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_, BigIntColumn as BigIntColumn_, BooleanColumn as BooleanColumn_, StringColumn as StringColumn_, DateTimeColumn as DateTimeColumn_, IntColumn as IntColumn_} from "@subsquid/typeorm-store"
import {ENSMirror} from "./ensMirror.model"

@Entity_()
export class ENSMirrorSync {
    constructor(props?: Partial<ENSMirrorSync>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @ManyToOne_(() => ENSMirror, {nullable: true})
    mirror!: ENSMirror

    @BigIntColumn_({nullable: false})
    ethBlockNumber!: bigint

    @BooleanColumn_({nullable: false})
    success!: boolean

    @StringColumn_({nullable: true})
    errorReason!: string | undefined | null

    @DateTimeColumn_({nullable: false})
    timestamp!: Date

    @Index_()
    @IntColumn_({nullable: false})
    blockNumber!: number

    @Index_()
    @StringColumn_({nullable: false})
    txHash!: string
}
