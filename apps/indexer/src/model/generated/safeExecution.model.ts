import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, BytesColumn as BytesColumn_, StringColumn as StringColumn_, BigIntColumn as BigIntColumn_, IntColumn as IntColumn_, BooleanColumn as BooleanColumn_, DateTimeColumn as DateTimeColumn_, Index as Index_, OneToMany as OneToMany_} from "@subsquid/typeorm-store"
import {SafeApproval} from "./safeApproval.model"

@Entity_()
export class SafeExecution {
    constructor(props?: Partial<SafeExecution>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @BytesColumn_({nullable: false})
    proposalId!: Uint8Array

    @StringColumn_({nullable: false})
    target!: string

    @BigIntColumn_({nullable: false})
    value!: bigint

    @BytesColumn_({nullable: true})
    data!: Uint8Array | undefined | null

    @IntColumn_({nullable: false})
    humanApprovals!: number

    @BooleanColumn_({nullable: false})
    aiApproved!: boolean

    @BooleanColumn_({nullable: false})
    executed!: boolean

    @BooleanColumn_({nullable: false})
    cancelled!: boolean

    @Index_()
    @DateTimeColumn_({nullable: false})
    createdAt!: Date

    @DateTimeColumn_({nullable: true})
    executedAt!: Date | undefined | null

    @OneToMany_(() => SafeApproval, e => e.execution)
    approvals!: SafeApproval[]
}
