/**
 * Feed Types
 */

import type { Timestamps } from './common'

export interface FeedUser {
  fid: number
  username: string
  displayName: string
  pfpUrl: string
}

export interface FeedPost extends Timestamps {
  hash: string
  threadHash: string
  author: FeedUser
  text: string
  embeds: { url: string }[]
  reactions: {
    likes: number
    recasts: number
  }
  replies: number
  channel: string | null
}
