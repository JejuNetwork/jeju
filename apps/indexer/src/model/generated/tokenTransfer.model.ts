import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, IntColumn as IntColumn_, Index as Index_, ManyToOne as ManyToOne_, BigIntColumn as BigIntColumn_, StringColumn as StringColumn_, DateTimeColumn as DateTimeColumn_} from "@subsquid/typeorm-store"
import {TokenStandard} from "./_tokenStandard"
import {Account} from "./account.model"
import {Contract} from "./contract.model"
import {Block} from "./block.model"
import {Transaction} from "./transaction.model"

@Entity_()
export class TokenTransfer {
    constructor(props?: Partial<TokenTransfer>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @IntColumn_({nullable: false})
    logIndex!: number

    @Index_()
    @Column_("varchar", {length: 7, nullable: false})
    tokenStandard!: TokenStandard

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    from!: Account

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    to!: Account

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    operator!: Account | undefined | null

    @Index_()
    @ManyToOne_(() => Contract, {nullable: true})
    token!: Contract | undefined | null

    @BigIntColumn_({nullable: true})
    value!: bigint | undefined | null

    @StringColumn_({nullable: true})
    tokenId!: string | undefined | null

    @Index_()
    @ManyToOne_(() => Block, {nullable: true})
    block!: Block

    @Index_()
    @ManyToOne_(() => Transaction, {nullable: true})
    transaction!: Transaction

    @Index_()
    @DateTimeColumn_({nullable: false})
    timestamp!: Date
}
