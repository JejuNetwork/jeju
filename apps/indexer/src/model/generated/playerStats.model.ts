import {
  DateTimeColumn as DateTimeColumn_,
  Entity as Entity_,
  Index as Index_,
  IntColumn as IntColumn_,
  PrimaryColumn as PrimaryColumn_,
  StringColumn as StringColumn_,
} from '@subsquid/typeorm-store'

@Entity_()
export class PlayerStats {
  constructor(props?: Partial<PlayerStats>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_({ unique: true })
  @StringColumn_({ nullable: false })
  player!: string

  @IntColumn_({ nullable: false })
  totalSkillEvents!: number

  @IntColumn_({ nullable: false })
  totalDeaths!: number

  @IntColumn_({ nullable: false })
  totalKills!: number

  @IntColumn_({ nullable: false })
  totalAchievements!: number

  @IntColumn_({ nullable: false })
  highestSkillLevel!: number

  @StringColumn_({ nullable: true })
  highestSkillName!: string | undefined | null

  @Index_()
  @DateTimeColumn_({ nullable: false })
  lastActive!: Date
}
