import {
  BigIntColumn as BigIntColumn_,
  BooleanColumn as BooleanColumn_,
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  IntColumn as IntColumn_,
  ManyToOne as ManyToOne_,
  OneToMany as OneToMany_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'
import { ComputeProvider } from './computeProvider.model'
import { ComputeRental } from './computeRental.model'

@Entity_()
export class ComputeResource {
  constructor(props?: Partial<ComputeResource>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @ManyToOne_(() => ComputeProvider, { nullable: true })
  provider!: ComputeProvider

  @Index_()
  @StringColumn_({ nullable: false })
  resourceId!: string

  @IntColumn_({ nullable: false })
  gpuCount!: number

  @IntColumn_({ nullable: false })
  cpuCores!: number

  @IntColumn_({ nullable: false })
  memoryGB!: number

  @BigIntColumn_({ nullable: false })
  pricePerHour!: bigint

  @Index_()
  @BooleanColumn_({ nullable: false })
  isAvailable!: boolean

  @Index_()
  @DateTimeColumn_({ nullable: false })
  createdAt!: Date

  @OneToMany_(
    () => ComputeRental,
    (e) => e.resource,
  )
  rentals!: ComputeRental[]
}
