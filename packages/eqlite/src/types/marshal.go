package types

import (
	"encoding/json"
)

// MarshalHash implementations for types that need verifier.MarshalHasher interface
// These are auto-generated stubs using JSON marshaling for deterministic output.

// MarshalHash marshals AckHeader for hash computation
func (h *AckHeader) MarshalHash() ([]byte, error) { return json.Marshal(h) }
func (h *AckHeader) Msgsize() int                 { return 256 }

// MarshalHash marshals BaseAccount for hash computation
func (a *BaseAccount) MarshalHash() ([]byte, error) { return json.Marshal(a) }
func (a *BaseAccount) Msgsize() int                 { return 512 }

// MarshalHash marshals Header for hash computation
func (h *Header) MarshalHash() ([]byte, error) { return json.Marshal(h) }
func (h *Header) Msgsize() int                 { return 512 }

// MarshalHash marshals BPHeader for hash computation
func (h *BPHeader) MarshalHash() ([]byte, error) { return json.Marshal(h) }
func (h *BPHeader) Msgsize() int                 { return 512 }

// MarshalHash marshals CreateDatabaseHeader for hash computation
func (h *CreateDatabaseHeader) MarshalHash() ([]byte, error) { return json.Marshal(h) }
func (h *CreateDatabaseHeader) Msgsize() int                 { return 512 }

// MarshalHash marshals CreateDatabase for hash computation
func (h *CreateDatabase) MarshalHash() ([]byte, error) { return json.Marshal(h) }
func (h *CreateDatabase) Msgsize() int                 { return 512 }

// MarshalHash marshals CreateDatabaseRequestHeader for hash computation
func (h *CreateDatabaseRequestHeader) MarshalHash() ([]byte, error) { return json.Marshal(h) }
func (h *CreateDatabaseRequestHeader) Msgsize() int                 { return 256 }

// MarshalHash marshals CreateDatabaseResponseHeader for hash computation
func (h *CreateDatabaseResponseHeader) MarshalHash() ([]byte, error) { return json.Marshal(h) }
func (h *CreateDatabaseResponseHeader) Msgsize() int                 { return 256 }

// MarshalHash marshals DropDatabaseRequestHeader for hash computation
func (h *DropDatabaseRequestHeader) MarshalHash() ([]byte, error) { return json.Marshal(h) }
func (h *DropDatabaseRequestHeader) Msgsize() int                 { return 256 }

// MarshalHash marshals GetDatabaseRequestHeader for hash computation
func (h *GetDatabaseRequestHeader) MarshalHash() ([]byte, error) { return json.Marshal(h) }
func (h *GetDatabaseRequestHeader) Msgsize() int                 { return 256 }

// MarshalHash marshals GetDatabaseResponseHeader for hash computation
func (h *GetDatabaseResponseHeader) MarshalHash() ([]byte, error) { return json.Marshal(h) }
func (h *GetDatabaseResponseHeader) Msgsize() int                 { return 256 }

// MarshalHash marshals InitServiceResponseHeader for hash computation
func (h *InitServiceResponseHeader) MarshalHash() ([]byte, error) { return json.Marshal(h) }
func (h *InitServiceResponseHeader) Msgsize() int                 { return 512 }

// MarshalHash marshals IssueKeys for hash computation
func (h *IssueKeys) MarshalHash() ([]byte, error) { return json.Marshal(h) }
func (h *IssueKeys) Msgsize() int                 { return 512 }

// MarshalHash marshals IssueKeysHeader for hash computation
func (h *IssueKeysHeader) MarshalHash() ([]byte, error) { return json.Marshal(h) }
func (h *IssueKeysHeader) Msgsize() int                 { return 512 }

// MarshalHash marshals ProvideService for hash computation
func (h *ProvideService) MarshalHash() ([]byte, error) { return json.Marshal(h) }
func (h *ProvideService) Msgsize() int                 { return 512 }

// MarshalHash marshals ProvideServiceHeader for hash computation
func (h *ProvideServiceHeader) MarshalHash() ([]byte, error) { return json.Marshal(h) }
func (h *ProvideServiceHeader) Msgsize() int                 { return 512 }

// MarshalHash marshals RequestHeader for hash computation
func (h *RequestHeader) MarshalHash() ([]byte, error) { return json.Marshal(h) }
func (h *RequestHeader) Msgsize() int                 { return 512 }

// MarshalHash marshals RequestPayload for hash computation
func (h *RequestPayload) MarshalHash() ([]byte, error) { return json.Marshal(h) }
func (h *RequestPayload) Msgsize() int                 { return 1024 }

// MarshalHash marshals ResponseHeader for hash computation
func (h *ResponseHeader) MarshalHash() ([]byte, error) { return json.Marshal(h) }
func (h *ResponseHeader) Msgsize() int                 { return 512 }

// MarshalHash marshals ResponsePayload for hash computation
func (h *ResponsePayload) MarshalHash() ([]byte, error) { return json.Marshal(h) }
func (h *ResponsePayload) Msgsize() int                 { return 1024 }

// MarshalHash marshals UpdateBilling for hash computation
func (h *UpdateBilling) MarshalHash() ([]byte, error) { return json.Marshal(h) }
func (h *UpdateBilling) Msgsize() int                 { return 512 }

// MarshalHash marshals UpdateBillingHeader for hash computation
func (h *UpdateBillingHeader) MarshalHash() ([]byte, error) { return json.Marshal(h) }
func (h *UpdateBillingHeader) Msgsize() int                 { return 512 }

// MarshalHash marshals UpdatePermission for hash computation
func (h *UpdatePermission) MarshalHash() ([]byte, error) { return json.Marshal(h) }
func (h *UpdatePermission) Msgsize() int                 { return 256 }

// MarshalHash marshals UpdatePermissionHeader for hash computation
func (h *UpdatePermissionHeader) MarshalHash() ([]byte, error) { return json.Marshal(h) }
func (h *UpdatePermissionHeader) Msgsize() int                 { return 256 }

// MarshalHash marshals UpdateServiceHeader for hash computation
func (h *UpdateServiceHeader) MarshalHash() ([]byte, error) { return json.Marshal(h) }
func (h *UpdateServiceHeader) Msgsize() int                 { return 256 }

