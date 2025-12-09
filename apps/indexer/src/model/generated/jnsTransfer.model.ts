import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_, DateTimeColumn as DateTimeColumn_, StringColumn as StringColumn_, IntColumn as IntColumn_} from "@subsquid/typeorm-store"
import {JNSName} from "./jnsName.model"
import {Account} from "./account.model"

@Entity_()
export class JNSTransfer {
    constructor(props?: Partial<JNSTransfer>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @ManyToOne_(() => JNSName, {nullable: true})
    name!: JNSName

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    from!: Account

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    to!: Account

    @Index_()
    @DateTimeColumn_({nullable: false})
    timestamp!: Date

    @StringColumn_({nullable: false})
    txHash!: string

    @Index_()
    @IntColumn_({nullable: false})
    blockNumber!: number
}
