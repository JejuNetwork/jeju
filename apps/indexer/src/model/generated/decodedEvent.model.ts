import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, StringColumn as StringColumn_, Index as Index_, JSONColumn as JSONColumn_, ManyToOne as ManyToOne_, OneToOne as OneToOne_, JoinColumn as JoinColumn_, DateTimeColumn as DateTimeColumn_} from "@subsquid/typeorm-store"
import {Account} from "./account.model"
import {Block} from "./block.model"
import {Transaction} from "./transaction.model"
import {Log} from "./log.model"

@Entity_()
export class DecodedEvent {
    constructor(props?: Partial<DecodedEvent>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @StringColumn_({nullable: false})
    eventSignature!: string

    @Index_()
    @StringColumn_({nullable: false})
    eventName!: string

    @JSONColumn_({nullable: false})
    args!: unknown

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    address!: Account

    @Index_()
    @ManyToOne_(() => Block, {nullable: true})
    block!: Block

    @Index_()
    @ManyToOne_(() => Transaction, {nullable: true})
    transaction!: Transaction

    @Index_({unique: true})
    @OneToOne_(() => Log, {nullable: true})
    @JoinColumn_()
    log!: Log

    @Index_()
    @DateTimeColumn_({nullable: false})
    timestamp!: Date
}
