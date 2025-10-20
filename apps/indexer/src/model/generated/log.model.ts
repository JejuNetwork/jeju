import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_, StringColumn as StringColumn_, IntColumn as IntColumn_, BooleanColumn as BooleanColumn_} from "@subsquid/typeorm-store"
import {Account} from "./account.model"
import {Block} from "./block.model"
import {Transaction} from "./transaction.model"
import {DecodedEvent} from "./decodedEvent.model"

@Entity_()
export class Log {
    constructor(props?: Partial<Log>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    address!: Account

    @StringColumn_({nullable: false})
    data!: string

    @Index_()
    @StringColumn_({nullable: true})
    topic0!: string | undefined | null

    @Index_()
    @StringColumn_({nullable: true})
    topic1!: string | undefined | null

    @Index_()
    @StringColumn_({nullable: true})
    topic2!: string | undefined | null

    @Index_()
    @StringColumn_({nullable: true})
    topic3!: string | undefined | null

    @Index_()
    @ManyToOne_(() => Block, {nullable: true})
    block!: Block

    @Index_()
    @ManyToOne_(() => Transaction, {nullable: true})
    transaction!: Transaction

    @IntColumn_({nullable: false})
    logIndex!: number

    @IntColumn_({nullable: false})
    transactionIndex!: number

    @BooleanColumn_({nullable: false})
    removed!: boolean

    @Index_()
    @ManyToOne_(() => DecodedEvent, {nullable: true})
    decodedEvent!: DecodedEvent | undefined | null
}
