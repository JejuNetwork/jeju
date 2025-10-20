import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, StringColumn as StringColumn_, Index as Index_, BooleanColumn as BooleanColumn_, DateTimeColumn as DateTimeColumn_, ManyToOne as ManyToOne_, OneToMany as OneToMany_} from "@subsquid/typeorm-store"
import {ContractType} from "./_contractType"
import {Account} from "./account.model"
import {Transaction} from "./transaction.model"
import {Block} from "./block.model"
import {TokenTransfer} from "./tokenTransfer.model"

@Entity_()
export class Contract {
    constructor(props?: Partial<Contract>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_({unique: true})
    @StringColumn_({nullable: false})
    address!: string

    @StringColumn_({nullable: true})
    bytecode!: string | undefined | null

    @Column_("varchar", {length: 17, nullable: true})
    contractType!: ContractType | undefined | null

    @BooleanColumn_({nullable: false})
    isERC20!: boolean

    @BooleanColumn_({nullable: false})
    isERC721!: boolean

    @BooleanColumn_({nullable: false})
    isERC1155!: boolean

    @BooleanColumn_({nullable: false})
    isProxy!: boolean

    @StringColumn_({nullable: true})
    implementationAddress!: string | undefined | null

    @BooleanColumn_({nullable: false})
    verified!: boolean

    @Index_()
    @DateTimeColumn_({nullable: false})
    firstSeenAt!: Date

    @Index_()
    @DateTimeColumn_({nullable: false})
    lastSeenAt!: Date

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    creator!: Account | undefined | null

    @Index_()
    @ManyToOne_(() => Transaction, {nullable: true})
    creationTransaction!: Transaction | undefined | null

    @Index_()
    @ManyToOne_(() => Block, {nullable: true})
    creationBlock!: Block | undefined | null

    @OneToMany_(() => TokenTransfer, e => e.token)
    tokenTransfers!: TokenTransfer[]
}
