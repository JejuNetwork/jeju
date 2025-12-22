import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, StringColumn as StringColumn_, Index as Index_, JSONColumn as JSONColumn_, ManyToOne as ManyToOne_, OneToOne as OneToOne_, JoinColumn as JoinColumn_, DateTimeColumn as DateTimeColumn_} from "@subsquid/typeorm-store"
import {Account} from "./account.model"
import {Block} from "./block.model"
import {Transaction} from "./transaction.model"
import {Log} from "./log.model"

/**
 * ABI-decoded event argument value types
 * These are the possible types from Ethereum ABI decoding
 */
export type DecodedArgValue = 
  | string           // address, bytes, string
  | bigint           // uint/int types
  | boolean          // bool
  | null             // null values
  | DecodedArgValue[]; // arrays and tuples

/**
 * Decoded event arguments as key-value pairs
 * Keys are parameter names from the ABI, values are decoded primitives
 */
export type DecodedEventArgs = Record<string, DecodedArgValue>;

@Entity_()
export class DecodedEvent {
    constructor(props?: Partial<DecodedEvent>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @StringColumn_({nullable: false})
    eventSignature!: string

    @Index_()
    @StringColumn_({nullable: false})
    eventName!: string

    @JSONColumn_({nullable: false})
    args!: DecodedEventArgs

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    address!: Account

    @Index_()
    @ManyToOne_(() => Block, {nullable: true})
    block!: Block

    @Index_()
    @ManyToOne_(() => Transaction, {nullable: true})
    transaction!: Transaction

    @Index_({unique: true})
    @OneToOne_(() => Log, {nullable: true})
    @JoinColumn_()
    log!: Log

    @Index_()
    @DateTimeColumn_({nullable: false})
    timestamp!: Date
}
