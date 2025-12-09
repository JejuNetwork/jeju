import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_, StringColumn as StringColumn_, IntColumn as IntColumn_, BigIntColumn as BigIntColumn_, DateTimeColumn as DateTimeColumn_, BooleanColumn as BooleanColumn_} from "@subsquid/typeorm-store"
import {XLP} from "./xlp.model"

@Entity_()
export class XLPSlashEvent {
    constructor(props?: Partial<XLPSlashEvent>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @ManyToOne_(() => XLP, {nullable: true})
    xlp!: XLP

    @Index_()
    @StringColumn_({nullable: false})
    voucherId!: string

    @IntColumn_({nullable: false})
    chainId!: number

    @BigIntColumn_({nullable: false})
    amount!: bigint

    @StringColumn_({nullable: false})
    victim!: string

    @Index_()
    @DateTimeColumn_({nullable: false})
    timestamp!: Date

    @BooleanColumn_({nullable: false})
    disputed!: boolean

    @StringColumn_({nullable: false})
    txHash!: string
}
