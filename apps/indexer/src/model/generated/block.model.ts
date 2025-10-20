import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, IntColumn as IntColumn_, Index as Index_, StringColumn as StringColumn_, DateTimeColumn as DateTimeColumn_, BigIntColumn as BigIntColumn_, ManyToOne as ManyToOne_, OneToMany as OneToMany_} from "@subsquid/typeorm-store"
import {Account} from "./account.model"
import {Transaction} from "./transaction.model"
import {Log} from "./log.model"

@Entity_()
export class Block {
    constructor(props?: Partial<Block>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @IntColumn_({nullable: false})
    number!: number

    @StringColumn_({nullable: false})
    hash!: string

    @StringColumn_({nullable: false})
    parentHash!: string

    @Index_()
    @DateTimeColumn_({nullable: false})
    timestamp!: Date

    @IntColumn_({nullable: false})
    transactionCount!: number

    @BigIntColumn_({nullable: false})
    gasUsed!: bigint

    @BigIntColumn_({nullable: false})
    gasLimit!: bigint

    @BigIntColumn_({nullable: true})
    baseFeePerGas!: bigint | undefined | null

    @IntColumn_({nullable: false})
    size!: number

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    miner!: Account | undefined | null

    @OneToMany_(() => Transaction, e => e.block)
    transactions!: Transaction[]

    @OneToMany_(() => Log, e => e.block)
    logs!: Log[]
}
