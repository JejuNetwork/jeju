import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, StringColumn as StringColumn_, Index as Index_, ManyToOne as ManyToOne_, BigIntColumn as BigIntColumn_, DateTimeColumn as DateTimeColumn_, IntColumn as IntColumn_} from "@subsquid/typeorm-store"
import {Account} from "./account.model"
import {ComputeProvider} from "./computeProvider.model"
import {InferenceStatus} from "./_inferenceStatus"

@Entity_()
export class InferenceRequest {
    constructor(props?: Partial<InferenceRequest>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_({unique: true})
    @StringColumn_({nullable: false})
    requestId!: string

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    requester!: Account

    @Index_()
    @ManyToOne_(() => ComputeProvider, {nullable: true})
    provider!: ComputeProvider

    @Index_()
    @StringColumn_({nullable: false})
    model!: string

    @BigIntColumn_({nullable: false})
    maxTokens!: bigint

    @BigIntColumn_({nullable: true})
    tokensUsed!: bigint | undefined | null

    @Index_()
    @Column_("varchar", {length: 9, nullable: false})
    status!: InferenceStatus

    @StringColumn_({nullable: true})
    responseHash!: string | undefined | null

    @Index_()
    @DateTimeColumn_({nullable: false})
    createdAt!: Date

    @DateTimeColumn_({nullable: true})
    completedAt!: Date | undefined | null

    @StringColumn_({nullable: false})
    txHash!: string

    @IntColumn_({nullable: false})
    blockNumber!: number
}
