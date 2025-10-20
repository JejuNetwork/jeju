import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, BigIntColumn as BigIntColumn_, BytesColumn as BytesColumn_, ManyToOne as ManyToOne_, Index as Index_, StringColumn as StringColumn_, DateTimeColumn as DateTimeColumn_} from "@subsquid/typeorm-store"
import {ReportType} from "./_reportType"
import {ReportSeverity} from "./_reportSeverity"
import {IPFSFile} from "./ipfsFile.model"
import {ReportStatus} from "./_reportStatus"

@Entity_()
export class ModerationReport {
    constructor(props?: Partial<ModerationReport>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @BigIntColumn_({nullable: false})
    reportId!: bigint

    @BigIntColumn_({nullable: false})
    targetAgentId!: bigint

    @BytesColumn_({nullable: false})
    reporter!: Uint8Array

    @Column_("varchar", {length: 13, nullable: false})
    reportType!: ReportType

    @Column_("varchar", {length: 8, nullable: false})
    severity!: ReportSeverity

    @Index_()
    @ManyToOne_(() => IPFSFile, {nullable: true})
    evidenceIPFS!: IPFSFile | undefined | null

    @StringColumn_({nullable: false})
    details!: string

    @Column_("varchar", {length: 12, nullable: false})
    status!: ReportStatus

    @DateTimeColumn_({nullable: false})
    createdAt!: Date
}
