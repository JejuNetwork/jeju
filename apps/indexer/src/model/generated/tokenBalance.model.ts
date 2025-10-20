import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_, BigIntColumn as BigIntColumn_, IntColumn as IntColumn_, DateTimeColumn as DateTimeColumn_} from "@subsquid/typeorm-store"
import {Account} from "./account.model"
import {Contract} from "./contract.model"

@Entity_()
export class TokenBalance {
    constructor(props?: Partial<TokenBalance>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    account!: Account

    @Index_()
    @ManyToOne_(() => Contract, {nullable: true})
    token!: Contract

    @BigIntColumn_({nullable: false})
    balance!: bigint

    @IntColumn_({nullable: false})
    transferCount!: number

    @Index_()
    @DateTimeColumn_({nullable: false})
    lastUpdated!: Date
}
