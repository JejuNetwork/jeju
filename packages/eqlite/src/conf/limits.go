
package conf

import "time"

const (
	// MaxPendingTxsPerAccount defines the limit of pending transactions of one account.
	MaxPendingTxsPerAccount = 1000
	// MaxTransactionsPerBlock defines the limit of transactions per block.
	MaxTransactionsPerBlock = 10000
	// MaxRPCPoolPhysicalConnection defines max physical connection for one node pair.
	MaxRPCPoolPhysicalConnection = 1024
	// MaxRPCMuxPoolPhysicalConnection defines max underlying physical connection of mux component
	// for one node pair.
	MaxRPCMuxPoolPhysicalConnection = 2
)

// These limits will not cause inconsistency within certain range.
const (
	// MaxTxBroadcastTTL defines the TTL limit of a AddTx request broadcasting within the
	// block producers.
	MaxTxBroadcastTTL = 1
	MaxCachedBlock    = 1000
	TCPDialTimeout    = 10 * time.Second
)
