import { type Address, type Hex, isAddress, isHex } from 'viem'
import { z } from 'zod'

// ============================================================================
// Core Schemas
// ============================================================================

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
export const HubInfoResponseSchema = z.object({
  version: z.string(),
  isSyncing: z.boolean(),
  nickname: z.string(),
  rootHash: z.string(),
  dbStats: z.object({
    numMessages: z.number(),
    numFidEvents: z.number(),
    numFnameEvents: z.number(),
  }),
  peerId: z.string(),
  hubOperatorFid: z.number(),
})

// User Data Message
export const UserDataMessageSchema = z.object({
  data: z.object({
    fid: z.number(),
    timestamp: z.number(),
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
    fid: z.number(),
    timestamp: z.number(),
    verificationAddAddressBody: z.object({
      address: z.string(),
      protocol: z.enum(['PROTOCOL_ETHEREUM', 'PROTOCOL_SOLANA']),
      chainId: z.number(),
    }),
  }),
})

export const VerificationsResponseSchema = z.object({
  messages: z.array(VerificationMessageSchema),
})

// Cast ID
const CastIdSchema = z.object({
  fid: z.number(),
  hash: z.string(),
})

// Embed
const EmbedSchema = z.object({
  url: z.string().optional(),
  castId: CastIdSchema.optional(),
})

// Cast Add Body (shared between CastMessage and SingleCast)
const CastAddBodySchema = z.object({
  text: z.string(),
  parentCastId: CastIdSchema.optional(),
  parentUrl: z.string().optional(),
  embeds: z.array(EmbedSchema),
  mentions: z.array(z.number()),
  mentionsPositions: z.array(z.number()),
})

// Cast Message
export const CastMessageSchema = z.object({
  hash: z.string(),
  data: z.object({
    fid: z.number(),
    timestamp: z.number(),
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
    fid: z.number(),
    timestamp: z.number(),
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
    fid: z.number(),
    timestamp: z.number(),
    linkBody: z.object({
      type: z.string(),
      targetFid: z.number(),
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
      fid: z.number(),
    }),
  ),
})

// Verification Lookup
export const VerificationLookupResponseSchema = z.object({
  messages: z.array(
    z.object({
      data: z.object({
        fid: z.number(),
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
          fid: z.number(),
          timestamp: z.number(),
          type: z.string(),
        })
        .passthrough(),
      hash: z.string(),
      hashScheme: z.string().optional(),
      signature: z.string().optional(),
      signatureScheme: z.string().optional(),
      signer: z.string().optional(),
    })
    .optional(),
})

const IdRegistryEventBodySchema = z.object({
  idRegistryEvent: z
    .object({
      fid: z.number(),
      to: z.string(),
      type: z.string(),
      blockNumber: z.number(),
    })
    .optional(),
})

const NameRegistryEventBodySchema = z.object({
  nameRegistryEvent: z
    .object({
      fname: z.string(),
      to: z.string(),
      type: z.string(),
      blockNumber: z.number(),
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
  id: z.number(),
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
export const FrameActionPayloadSchema = z.object({
  untrustedData: z.object({
    fid: z.number(),
    url: z.string(),
    messageHash: HexSchema,
    timestamp: z.number(),
    network: z.number(),
    buttonIndex: z.number(),
    inputText: z.string().optional(),
    state: z.string().optional(),
    transactionId: HexSchema.optional(),
    address: AddressSchema.optional(),
    castId: z.object({
      fid: z.number(),
      hash: HexSchema,
    }),
  }),
  trustedData: z.object({
    messageBytes: HexSchema,
  }),
})

// ============================================================================
// Hub Submitter Schemas
// ============================================================================

/** Hub info response for connectivity checks */
export const HubInfoSchema = z.object({
  version: z.string(),
  isSyncing: z.boolean(),
  nickname: z.string(),
  rootHash: z.string(),
  dbStats: z.object({
    numMessages: z.number(),
    numFids: z.number(),
  }),
  peerId: z.string(),
})
export type HubInfo = z.infer<typeof HubInfoSchema>

/** Validate message response */
export const ValidateMessageResponseSchema = z.object({
  valid: z.boolean(),
})
export type ValidateMessageResponse = z.infer<
  typeof ValidateMessageResponseSchema
>

// ============================================================================
// DC Client Schemas (for external API responses)
// ============================================================================

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

/** DC persistence file format */
export const DCPersistenceDataSchema = z.object({
  conversations: z.array(
    z.object({
      id: z.string(),
      participants: z.array(z.number()),
      lastMessage: z
        .object({
          id: z.string(),
          conversationId: z.string(),
          senderFid: z.number(),
          recipientFid: z.number(),
          text: z.string(),
          timestamp: z.number(),
          signature: HexSchema,
          isRead: z.boolean().optional(),
        })
        .optional(),
      unreadCount: z.number(),
      createdAt: z.number(),
      updatedAt: z.number(),
      isMuted: z.boolean().optional(),
      isArchived: z.boolean().optional(),
    }),
  ),
  messages: z.record(
    z.string(),
    z.array(
      z.object({
        id: z.string(),
        conversationId: z.string(),
        senderFid: z.number(),
        recipientFid: z.number(),
        text: z.string(),
        timestamp: z.number(),
        signature: HexSchema,
        isRead: z.boolean().optional(),
      }),
    ),
  ),
})
export type DCPersistenceData = z.infer<typeof DCPersistenceDataSchema>

// Export type helpers (only types used by client or external consumers)
export type ParsedCastMessage = z.infer<typeof CastMessageSchema>
export type FrameActionPayload = z.infer<typeof FrameActionPayloadSchema>
