import { z } from 'zod';
import type { Address, Hex } from 'viem';

// Hub API response schemas for external data validation

// Shared base schemas - exported for reuse
export const HexSchema = z.string().regex(/^0x[a-fA-F0-9]*$/) as z.ZodType<Hex>;
export const AddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/) as z.ZodType<Address>;

// User Data Types
export const UserDataTypeRaw = z.enum([
  'USER_DATA_TYPE_PFP',
  'USER_DATA_TYPE_DISPLAY',
  'USER_DATA_TYPE_BIO',
  'USER_DATA_TYPE_URL',
  'USER_DATA_TYPE_USERNAME',
  'USER_DATA_TYPE_LOCATION',
]);

export const UserDataTypeSchema = z.enum(['pfp', 'display', 'bio', 'url', 'username', 'location']);

export const USER_DATA_TYPE_MAP: Record<z.infer<typeof UserDataTypeRaw>, z.infer<typeof UserDataTypeSchema>> = {
  USER_DATA_TYPE_PFP: 'pfp',
  USER_DATA_TYPE_DISPLAY: 'display',
  USER_DATA_TYPE_BIO: 'bio',
  USER_DATA_TYPE_URL: 'url',
  USER_DATA_TYPE_USERNAME: 'username',
  USER_DATA_TYPE_LOCATION: 'location',
};

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
});

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
});

export const UserDataResponseSchema = z.object({
  messages: z.array(UserDataMessageSchema),
});

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
});

export const VerificationsResponseSchema = z.object({
  messages: z.array(VerificationMessageSchema),
});

// Cast ID
const CastIdSchema = z.object({
  fid: z.number(),
  hash: z.string(),
});

// Embed
const EmbedSchema = z.object({
  url: z.string().optional(),
  castId: CastIdSchema.optional(),
});

// Cast Add Body (shared between CastMessage and SingleCast)
const CastAddBodySchema = z.object({
  text: z.string(),
  parentCastId: CastIdSchema.optional(),
  parentUrl: z.string().optional(),
  embeds: z.array(EmbedSchema),
  mentions: z.array(z.number()),
  mentionsPositions: z.array(z.number()),
});

// Cast Message
export const CastMessageSchema = z.object({
  hash: z.string(),
  data: z.object({
    fid: z.number(),
    timestamp: z.number(),
    castAddBody: CastAddBodySchema,
  }),
});

export const CastsResponseSchema = z.object({
  messages: z.array(CastMessageSchema),
  nextPageToken: z.string().optional(),
});

// SingleCastResponseSchema reuses CastMessageSchema since they have the same shape
export const SingleCastResponseSchema = CastMessageSchema;

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
});

export const ReactionsResponseSchema = z.object({
  messages: z.array(ReactionMessageSchema),
  nextPageToken: z.string().optional(),
});

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
});

export const LinksResponseSchema = z.object({
  messages: z.array(LinkMessageSchema),
  nextPageToken: z.string().optional(),
});

// Username Proof
export const UsernameProofResponseSchema = z.object({
  proofs: z.array(z.object({
    fid: z.number(),
  })),
});

// Verification Lookup
export const VerificationLookupResponseSchema = z.object({
  messages: z.array(z.object({
    data: z.object({
      fid: z.number(),
    }),
  })),
});

// Hub Event
export const HubEventTypeSchema = z.enum([
  'HUB_EVENT_TYPE_MERGE_MESSAGE',
  'HUB_EVENT_TYPE_PRUNE_MESSAGE',
  'HUB_EVENT_TYPE_REVOKE_MESSAGE',
  'HUB_EVENT_TYPE_MERGE_ID_REGISTRY_EVENT',
  'HUB_EVENT_TYPE_MERGE_NAME_REGISTRY_EVENT',
]);

// Hub event body schemas for different event types
const MergeMessageBodySchema = z.object({
  message: z.object({
    data: z.object({
      fid: z.number(),
      timestamp: z.number(),
      type: z.string(),
    }).passthrough(),
    hash: z.string(),
    hashScheme: z.string().optional(),
    signature: z.string().optional(),
    signatureScheme: z.string().optional(),
    signer: z.string().optional(),
  }).optional(),
});

const IdRegistryEventBodySchema = z.object({
  idRegistryEvent: z.object({
    fid: z.number(),
    to: z.string(),
    type: z.string(),
    blockNumber: z.number(),
  }).optional(),
});

const NameRegistryEventBodySchema = z.object({
  nameRegistryEvent: z.object({
    fname: z.string(),
    to: z.string(),
    type: z.string(),
    blockNumber: z.number(),
  }).optional(),
});

// Union of all possible event body types
const HubEventBodySchema = z.union([
  MergeMessageBodySchema,
  IdRegistryEventBodySchema,
  NameRegistryEventBodySchema,
]);

export const HubEventSchema = z.object({
  id: z.number(),
  type: HubEventTypeSchema,
  body: HubEventBodySchema,
});

export const EventsResponseSchema = z.object({
  events: z.array(HubEventSchema),
});

// Export inferred types for use in client.ts
export type HubEventType = z.infer<typeof HubEventTypeSchema>;
export type HubEventBody = z.infer<typeof HubEventBodySchema>;

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
});

// Export type helpers
export type ParsedUserDataMessage = z.infer<typeof UserDataMessageSchema>;
export type ParsedCastMessage = z.infer<typeof CastMessageSchema>;
export type ParsedVerificationMessage = z.infer<typeof VerificationMessageSchema>;
export type ParsedReactionMessage = z.infer<typeof ReactionMessageSchema>;
export type ParsedLinkMessage = z.infer<typeof LinkMessageSchema>;
export type FrameActionPayload = z.infer<typeof FrameActionPayloadSchema>;
