import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_, StringColumn as StringColumn_, IntColumn as IntColumn_, BigIntColumn as BigIntColumn_, DateTimeColumn as DateTimeColumn_, BooleanColumn as BooleanColumn_} from "@subsquid/typeorm-store"
import {OIFSolver} from "./oifSolver.model"

@Entity_()
export class OIFSlashEvent {
    constructor(props?: Partial<OIFSlashEvent>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @ManyToOne_(() => OIFSolver, {nullable: true})
    solver!: OIFSolver

    @Index_()
    @StringColumn_({nullable: false})
    intentId!: string

    @StringColumn_({nullable: false})
    orderId!: string

    @IntColumn_({nullable: false})
    chainId!: number

    @BigIntColumn_({nullable: false})
    amount!: bigint

    @StringColumn_({nullable: false})
    victim!: string

    @StringColumn_({nullable: false})
    reason!: string

    @Index_()
    @DateTimeColumn_({nullable: false})
    timestamp!: Date

    @BooleanColumn_({nullable: false})
    disputed!: boolean

    @StringColumn_({nullable: false})
    txHash!: string
}
