import { type Address, type Hex, isAddress, isHex } from 'viem'
import { z } from 'zod'

// Core Schemas

/** Hex string schema for viem compatibility */
export const HexSchema = z.custom<Hex>(
  (val): val is Hex => typeof val === 'string' && isHex(val),
  'Invalid hex string',
)

/** Address schema for viem compatibility */
export const AddressSchema = z.custom<Address>(
  (val): val is Address => typeof val === 'string' && isAddress(val),
  'Invalid Ethereum address',
)

// Hub API response schemas for external data validation

// User Data Types (internal schema for API responses)
const UserDataTypeRaw = z.enum([
  'USER_DATA_TYPE_PFP',
  'USER_DATA_TYPE_DISPLAY',
  'USER_DATA_TYPE_BIO',
  'USER_DATA_TYPE_URL',
  'USER_DATA_TYPE_USERNAME',
  'USER_DATA_TYPE_LOCATION',
])

type UserDataType = 'pfp' | 'display' | 'bio' | 'url' | 'username' | 'location'

export const USER_DATA_TYPE_MAP: Record<
  z.infer<typeof UserDataTypeRaw>,
  UserDataType
> = {
  USER_DATA_TYPE_PFP: 'pfp',
  USER_DATA_TYPE_DISPLAY: 'display',
  USER_DATA_TYPE_BIO: 'bio',
  USER_DATA_TYPE_URL: 'url',
  USER_DATA_TYPE_USERNAME: 'username',
  USER_DATA_TYPE_LOCATION: 'location',
}

// Hub Info Response
export const HubInfoResponseSchema = z
  .object({
    version: z.string().min(1),
    isSyncing: z.boolean(),
    nickname: z.string(),
    rootHash: z.string(),
    dbStats: z
      .object({
        numMessages: z.number().int().nonnegative(),
        numFidEvents: z.number().int().nonnegative(),
        numFnameEvents: z.number().int().nonnegative(),
      })
      .strict(),
    peerId: z.string().min(1),
    hubOperatorFid: z.number().int().nonnegative(),
  })
  .strict()

// User Data Message
export const UserDataMessageSchema = z.object({
  data: z.object({
    fid: z.number().int().positive(),
    timestamp: z.number().int().nonnegative(),
    userDataBody: z.object({
      type: UserDataTypeRaw,
      value: z.string(),
    }),
  }),
})

export const UserDataResponseSchema = z.object({
  messages: z.array(UserDataMessageSchema),
})

// Verification Message
export const VerificationMessageSchema = z.object({
  data: z.object({
    fid: z.number().int().positive(),
    timestamp: z.number().int().nonnegative(),
    verificationAddAddressBody: z.object({
      address: z.string().min(1),
      protocol: z.enum(['PROTOCOL_ETHEREUM', 'PROTOCOL_SOLANA']),
      chainId: z.number().int().nonnegative(),
    }),
  }),
})

export const VerificationsResponseSchema = z.object({
  messages: z.array(VerificationMessageSchema),
})

// Cast ID
const CastIdSchema = z.object({
  fid: z.number().int().positive(),
  hash: z.string().min(1),
})

// Embed
const EmbedSchema = z.object({
  url: z.string().optional(),
  castId: CastIdSchema.optional(),
})

// Cast Add Body (shared between CastMessage and SingleCast)
const CastAddBodySchema = z.object({
  text: z.string().max(320),
  parentCastId: CastIdSchema.optional(),
  parentUrl: z.string().url().optional(),
  embeds: z.array(EmbedSchema),
  mentions: z.array(z.number().int().positive()),
  mentionsPositions: z.array(z.number().int().nonnegative()),
})

// Cast Message
export const CastMessageSchema = z.object({
  hash: z.string().min(1),
  data: z.object({
    fid: z.number().int().positive(),
    timestamp: z.number().int().nonnegative(),
    castAddBody: CastAddBodySchema,
  }),
})

export const CastsResponseSchema = z.object({
  messages: z.array(CastMessageSchema),
  nextPageToken: z.string().optional(),
})

// SingleCastResponseSchema reuses CastMessageSchema since they have the same shape
export const SingleCastResponseSchema = CastMessageSchema

// Reaction Message
export const ReactionMessageSchema = z.object({
  data: z.object({
    fid: z.number().int().positive(),
    timestamp: z.number().int().nonnegative(),
    reactionBody: z.object({
      type: z.enum(['REACTION_TYPE_LIKE', 'REACTION_TYPE_RECAST']),
      targetCastId: CastIdSchema,
    }),
  }),
})

export const ReactionsResponseSchema = z.object({
  messages: z.array(ReactionMessageSchema),
  nextPageToken: z.string().optional(),
})

// Link Message
export const LinkMessageSchema = z.object({
  data: z.object({
    fid: z.number().int().positive(),
    timestamp: z.number().int().nonnegative(),
    linkBody: z.object({
      type: z.enum(['follow']),
      targetFid: z.number().int().positive(),
    }),
  }),
})

export const LinksResponseSchema = z.object({
  messages: z.array(LinkMessageSchema),
  nextPageToken: z.string().optional(),
})

// Username Proof
export const UsernameProofResponseSchema = z.object({
  proofs: z.array(
    z.object({
      fid: z.number().int().positive(),
    }),
  ),
})

// Verification Lookup
export const VerificationLookupResponseSchema = z.object({
  messages: z.array(
    z.object({
      data: z.object({
        fid: z.number().int().positive(),
      }),
    }),
  ),
})

// Hub Event
export const HubEventTypeSchema = z.enum([
  'HUB_EVENT_TYPE_MERGE_MESSAGE',
  'HUB_EVENT_TYPE_PRUNE_MESSAGE',
  'HUB_EVENT_TYPE_REVOKE_MESSAGE',
  'HUB_EVENT_TYPE_MERGE_ID_REGISTRY_EVENT',
  'HUB_EVENT_TYPE_MERGE_NAME_REGISTRY_EVENT',
])

// Hub event body schemas for different event types
const MergeMessageBodySchema = z.object({
  message: z
    .object({
      data: z
        .object({
          fid: z.number().int().positive(),
          timestamp: z.number().int().nonnegative(),
          type: z.string().min(1),
        })
        .passthrough(),
      hash: z.string().min(1),
      hashScheme: z.string().min(1).optional(),
      signature: z.string().min(1).optional(),
      signatureScheme: z.string().min(1).optional(),
      signer: z.string().min(1).optional(),
    })
    .optional(),
})

const IdRegistryEventBodySchema = z.object({
  idRegistryEvent: z
    .object({
      fid: z.number().int().positive(),
      to: z.string().min(1),
      type: z.string().min(1),
      blockNumber: z.number().int().nonnegative(),
    })
    .optional(),
})

const NameRegistryEventBodySchema = z.object({
  nameRegistryEvent: z
    .object({
      fname: z.string().min(1),
      to: z.string().min(1),
      type: z.string().min(1),
      blockNumber: z.number().int().nonnegative(),
    })
    .optional(),
})

// Union of all possible event body types
const HubEventBodySchema = z.union([
  MergeMessageBodySchema,
  IdRegistryEventBodySchema,
  NameRegistryEventBodySchema,
])

export const HubEventSchema = z.object({
  id: z.number().int().positive(),
  type: HubEventTypeSchema,
  body: HubEventBodySchema,
})

export const EventsResponseSchema = z.object({
  events: z.array(HubEventSchema),
})

// Export inferred types for use in client.ts
export type HubEventType = z.infer<typeof HubEventTypeSchema>
export type HubEventBody = z.infer<typeof HubEventBodySchema>

// Frame Action Payload
export const FrameActionPayloadSchema = z
  .object({
    untrustedData: z
      .object({
        fid: z.number().int().positive(),
        url: z.string().url(),
        messageHash: HexSchema,
        timestamp: z.number().int().positive(),
        network: z.number().int().nonnegative(),
        buttonIndex: z.number().int().min(1).max(4),
        inputText: z.string().max(256).optional(),
        state: z.string().optional(),
        transactionId: HexSchema.optional(),
        address: AddressSchema.optional(),
        castId: z
          .object({
            fid: z.number().int().positive(),
            hash: HexSchema,
          })
          .strict(),
      })
      .strict(),
    trustedData: z
      .object({
        messageBytes: HexSchema,
      })
      .strict(),
  })
  .strict()

// Hub Submitter Schemas

/** Hub info response for connectivity checks */
export const HubInfoSchema = z
  .object({
    version: z.string().min(1),
    isSyncing: z.boolean(),
    nickname: z.string(),
    rootHash: z.string(),
    dbStats: z
      .object({
        numMessages: z.number().int().nonnegative(),
        numFids: z.number().int().nonnegative(),
      })
      .strict(),
    peerId: z.string().min(1),
  })
  .strict()
export type HubInfo = z.infer<typeof HubInfoSchema>

/** Validate message response */
export const ValidateMessageResponseSchema = z
  .object({
    valid: z.boolean(),
  })
  .strict()
export type ValidateMessageResponse = z.infer<
  typeof ValidateMessageResponseSchema
>

// DC Client Schemas (for external API responses)

/** User data message for DC encryption key lookup */
export const DCUserDataMessageSchema = z.object({
  data: z
    .object({
      userDataBody: z
        .object({
          type: z.number(),
          value: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
})

/** User data response for DC encryption key lookup */
export const DCUserDataResponseSchema = z.object({
  messages: z.array(DCUserDataMessageSchema).optional(),
})
export type DCUserDataResponse = z.infer<typeof DCUserDataResponseSchema>

/** Signer event for DC signature verification */
export const DCSignerEventSchema = z.object({
  signerEventBody: z
    .object({
      key: z.string().optional(),
    })
    .optional(),
})

/** Signer events response for DC signature verification */
export const DCSignerEventsResponseSchema = z.object({
  events: z.array(DCSignerEventSchema).optional(),
})
export type DCSignerEventsResponse = z.infer<
  typeof DCSignerEventsResponseSchema
>

/** DC message schema for persistence */
const DCMessageSchema = z
  .object({
    id: z.string().min(1),
    conversationId: z.string().min(1),
    senderFid: z.number().int().positive(),
    recipientFid: z.number().int().positive(),
    text: z.string().min(1).max(2000),
    timestamp: z.number().int().positive(),
    signature: HexSchema,
    isRead: z.boolean().optional(),
  })
  .strict()

/** DC conversation schema for persistence */
const DCConversationSchema = z
  .object({
    id: z.string().min(1),
    participants: z.array(z.number().int().positive()).min(2).max(2),
    lastMessage: DCMessageSchema.optional(),
    unreadCount: z.number().int().nonnegative(),
    createdAt: z.number().int().positive(),
    updatedAt: z.number().int().positive(),
    isMuted: z.boolean().optional(),
    isArchived: z.boolean().optional(),
  })
  .strict()

/** DC persistence file format */
export const DCPersistenceDataSchema = z
  .object({
    conversations: z.array(DCConversationSchema),
    messages: z.record(z.string(), z.array(DCMessageSchema)),
  })
  .strict()
export type DCPersistenceData = z.infer<typeof DCPersistenceDataSchema>

// Export type helpers (only types used by client or external consumers)
export type ParsedCastMessage = z.infer<typeof CastMessageSchema>
export type FrameActionPayload = z.infer<typeof FrameActionPayloadSchema>
