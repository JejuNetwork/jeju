import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, StringColumn as StringColumn_, Index as Index_, ManyToOne as ManyToOne_, DateTimeColumn as DateTimeColumn_} from "@subsquid/typeorm-store"
import {JNSName} from "./jnsName.model"

@Entity_()
export class JNSReverseRecord {
    constructor(props?: Partial<JNSReverseRecord>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_({unique: true})
    @StringColumn_({nullable: false})
    address!: string

    @Index_()
    @ManyToOne_(() => JNSName, {nullable: true})
    name!: JNSName | undefined | null

    @StringColumn_({nullable: true})
    primaryName!: string | undefined | null

    @Index_()
    @DateTimeColumn_({nullable: false})
    timestamp!: Date

    @StringColumn_({nullable: false})
    txHash!: string
}
