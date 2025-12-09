import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_, BigIntColumn as BigIntColumn_, DateTimeColumn as DateTimeColumn_, StringColumn as StringColumn_, IntColumn as IntColumn_} from "@subsquid/typeorm-store"
import {JNSName} from "./jnsName.model"
import {Account} from "./account.model"

@Entity_()
export class JNSRenewal {
    constructor(props?: Partial<JNSRenewal>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @ManyToOne_(() => JNSName, {nullable: true})
    name!: JNSName

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    renewer!: Account

    @BigIntColumn_({nullable: false})
    cost!: bigint

    @DateTimeColumn_({nullable: false})
    newExpiresAt!: Date

    @Index_()
    @DateTimeColumn_({nullable: false})
    timestamp!: Date

    @StringColumn_({nullable: false})
    txHash!: string

    @Index_()
    @IntColumn_({nullable: false})
    blockNumber!: number
}
