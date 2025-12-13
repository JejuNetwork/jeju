import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_, StringColumn as StringColumn_, IntColumn as IntColumn_, BooleanColumn as BooleanColumn_, DateTimeColumn as DateTimeColumn_} from "@subsquid/typeorm-store"
import {Account} from "./account.model"

@Entity_()
export class ProtectedContract {
    constructor(props?: Partial<ProtectedContract>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    target!: Account

    @StringColumn_({nullable: false})
    name!: string

    @IntColumn_({nullable: false})
    priority!: number

    @Index_()
    @BooleanColumn_({nullable: false})
    isPaused!: boolean

    @DateTimeColumn_({nullable: true})
    pausedAt!: Date | undefined | null

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    pausedBy!: Account | undefined | null

    @StringColumn_({nullable: true})
    pauseReason!: string | undefined | null

    @Index_()
    @DateTimeColumn_({nullable: false})
    registeredAt!: Date
}
