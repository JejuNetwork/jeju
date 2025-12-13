import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, StringColumn as StringColumn_, Index as Index_, BigIntColumn as BigIntColumn_, BooleanColumn as BooleanColumn_, IntColumn as IntColumn_, DateTimeColumn as DateTimeColumn_, OneToMany as OneToMany_} from "@subsquid/typeorm-store"
import {OracleCommitteeMember} from "./oracleCommitteeMember.model"
import {OracleAttestation} from "./oracleAttestation.model"

@Entity_()
export class OracleOperator {
    constructor(props?: Partial<OracleOperator>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_({unique: true})
    @StringColumn_({nullable: false})
    address!: string

    @Index_()
    @BigIntColumn_({nullable: true})
    identityId!: bigint | undefined | null

    @Index_()
    @BooleanColumn_({nullable: false})
    isActive!: boolean

    @Index_()
    @BooleanColumn_({nullable: false})
    isJailed!: boolean

    @BigIntColumn_({nullable: false})
    stakedAmount!: bigint

    @BigIntColumn_({nullable: false})
    delegatedAmount!: bigint

    @BigIntColumn_({nullable: false})
    totalSlashed!: bigint

    @IntColumn_({nullable: false})
    reportsSubmitted!: number

    @IntColumn_({nullable: false})
    reportsAccepted!: number

    @IntColumn_({nullable: false})
    disputesAgainst!: number

    @IntColumn_({nullable: false})
    disputesLost!: number

    @IntColumn_({nullable: false})
    participationScore!: number

    @IntColumn_({nullable: false})
    accuracyScore!: number

    @IntColumn_({nullable: false})
    uptimeScore!: number

    @BigIntColumn_({nullable: false})
    totalEarnings!: bigint

    @BigIntColumn_({nullable: false})
    pendingRewards!: bigint

    @Index_()
    @DateTimeColumn_({nullable: false})
    registeredAt!: Date

    @Index_()
    @DateTimeColumn_({nullable: false})
    lastActiveAt!: Date

    @OneToMany_(() => OracleCommitteeMember, e => e.operator)
    committees!: OracleCommitteeMember[]

    @OneToMany_(() => OracleAttestation, e => e.operator)
    attestations!: OracleAttestation[]
}
