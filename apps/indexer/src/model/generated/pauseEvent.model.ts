import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_, StringColumn as StringColumn_, BooleanColumn as BooleanColumn_, DateTimeColumn as DateTimeColumn_, IntColumn as IntColumn_} from "@subsquid/typeorm-store"
import {ProtectedContract} from "./protectedContract.model"
import {Account} from "./account.model"

@Entity_()
export class PauseEvent {
    constructor(props?: Partial<PauseEvent>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @ManyToOne_(() => ProtectedContract, {nullable: true})
    target!: ProtectedContract

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    pauser!: Account | undefined | null

    @StringColumn_({nullable: false})
    reason!: string

    @BooleanColumn_({nullable: false})
    isGlobal!: boolean

    @BooleanColumn_({nullable: false})
    wasEmergency!: boolean

    @Index_()
    @DateTimeColumn_({nullable: false})
    pausedAt!: Date

    @DateTimeColumn_({nullable: true})
    unpausedAt!: Date | undefined | null

    @IntColumn_({nullable: false})
    blockNumber!: number

    @StringColumn_({nullable: false})
    transactionHash!: string
}
