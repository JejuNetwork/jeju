

package types

import (
	"eqlite/src/blockproducer/interfaces"
	"eqlite/src/crypto/hash"
	"eqlite/src/proto"
)

// AdviseNewBlockReq defines a request of the AdviseNewBlock RPC method.
type AdviseNewBlockReq struct {
	proto.Envelope
	Block *BPBlock
}

// AdviseNewBlockResp defines a response of the AdviseNewBlock RPC method.
type AdviseNewBlockResp struct {
	proto.Envelope
}

// FetchBlockReq defines a request of the FetchBlock RPC method.
type FetchBlockReq struct {
	proto.Envelope
	Height uint32
}

// FetchBlockResp defines a response of the FetchBlock RPC method.
type FetchBlockResp struct {
	proto.Envelope
	Height uint32
	Count  uint32
	Block  *BPBlock
}

// FetchLastIrreversibleBlockReq defines a request of the FetchLastIrreversibleBlock RPC method.
type FetchLastIrreversibleBlockReq struct {
	proto.Envelope
	Address proto.AccountAddress
}

// FetchLastIrreversibleBlockResp defines a response of the FetchLastIrreversibleBlock RPC method.
type FetchLastIrreversibleBlockResp struct {
	proto.Envelope
	Count     uint32
	Height    uint32
	Block     *BPBlock
	SQLChains []*SQLChainProfile
}

// FetchBlockByCountReq define a request of the FetchBlockByCount RPC method.
type FetchBlockByCountReq struct {
	proto.Envelope
	Count uint32
}

// FetchTxBillingReq defines a request of the FetchTxBilling RPC method.
type FetchTxBillingReq struct {
	proto.Envelope
}

// FetchTxBillingResp defines a response of the FetchTxBilling RPC method.
type FetchTxBillingResp struct {
	proto.Envelope
}

// NextAccountNonceReq defines a request of the NextAccountNonce RPC method.
type NextAccountNonceReq struct {
	proto.Envelope
	Addr proto.AccountAddress
}

// NextAccountNonceResp defines a response of the NextAccountNonce RPC method.
type NextAccountNonceResp struct {
	proto.Envelope
	Addr  proto.AccountAddress
	Nonce interfaces.AccountNonce
}

// AddTxReq defines a request of the AddTx RPC method.
type AddTxReq struct {
	proto.Envelope

	TTL uint32 // defines the broadcast TTL on BP network.
	Tx  interfaces.Transaction
}

// AddTxResp defines a response of the AddTx RPC method.
type AddTxResp struct {
	proto.Envelope
}

// SubReq defines a request of the Sub RPC method.
type SubReq struct {
	proto.Envelope
	Topic    string
	Callback string
}

// SubResp defines a response of the Sub RPC method.
type SubResp struct {
	proto.Envelope
	Result string
}

// OrderMakerReq defines a request of the order maker in database market.
type OrderMakerReq struct {
	proto.Envelope
}

// OrderTakerReq defines a request of the order taker in database market.
type OrderTakerReq struct {
	proto.Envelope
	DBMeta ResourceMeta
}

// OrderTakerResp defines a response of the order taker in database market.
type OrderTakerResp struct {
	proto.Envelope
}

// QueryAccountTokenBalanceReq defines a request of the QueryAccountTokenBalance RPC method.
type QueryAccountTokenBalanceReq struct {
	proto.Envelope
	Addr      proto.AccountAddress
	TokenType TokenType
}

// QueryAccountTokenBalanceResp defines a response of the QueryAccountTokenBalance RPC method.
type QueryAccountTokenBalanceResp struct {
	proto.Envelope
	Addr    proto.AccountAddress
	OK      bool
	Balance uint64
}

// QuerySQLChainProfileReq defines a request of the QuerySQLChainProfile RPC method.
type QuerySQLChainProfileReq struct {
	proto.Envelope
	DBID proto.DatabaseID
}

// QuerySQLChainProfileResp defines a response of the QuerySQLChainProfile RPC method.
type QuerySQLChainProfileResp struct {
	proto.Envelope
	Profile SQLChainProfile
}

// QueryTxStateReq defines a request of the QueryTxState RPC method.
type QueryTxStateReq struct {
	proto.Envelope
	Hash hash.Hash
}

// QueryTxStateResp defines a response of the QueryTxState RPC method.
type QueryTxStateResp struct {
	proto.Envelope
	Hash  hash.Hash
	State interfaces.TransactionState
}

// QueryAccountSQLChainProfilesReq defines a request of QueryAccountSQLChainProfiles RPC method.
type QueryAccountSQLChainProfilesReq struct {
	proto.Envelope
	Addr proto.AccountAddress
}

// QueryAccountSQLChainProfilesResp defines a response of QueryAccountSQLChainProfiles RPC method.
type QueryAccountSQLChainProfilesResp struct {
	proto.Envelope
	Addr     proto.AccountAddress
	Profiles []*SQLChainProfile
}
