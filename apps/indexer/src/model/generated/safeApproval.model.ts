import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_, BooleanColumn as BooleanColumn_, BytesColumn as BytesColumn_, DateTimeColumn as DateTimeColumn_, IntColumn as IntColumn_, StringColumn as StringColumn_} from "@subsquid/typeorm-store"
import {SafeExecution} from "./safeExecution.model"
import {Account} from "./account.model"

@Entity_()
export class SafeApproval {
    constructor(props?: Partial<SafeApproval>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @ManyToOne_(() => SafeExecution, {nullable: true})
    execution!: SafeExecution

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    approver!: Account

    @BooleanColumn_({nullable: false})
    isAI!: boolean

    @BytesColumn_({nullable: true})
    attestationHash!: Uint8Array | undefined | null

    @Index_()
    @DateTimeColumn_({nullable: false})
    approvedAt!: Date

    @IntColumn_({nullable: false})
    blockNumber!: number

    @StringColumn_({nullable: false})
    transactionHash!: string
}
