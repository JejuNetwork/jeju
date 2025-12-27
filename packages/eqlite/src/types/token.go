
package types

//go:generate hsp

// TokenType represents the token used for transactions.
// All token operations are now handled by the EQLiteRegistry smart contract on Ethereum.
type TokenType int32

const (
	// Ether represents JEJU tokens handled by smart contracts.
	Ether TokenType = 0
)

// String returns the token name.
func (t TokenType) String() string {
	return "Ether"
}

// FromString returns the token type from string.
func FromString(t string) TokenType {
	return Ether
}

// Listed returns true as Ether is always supported.
func (t *TokenType) Listed() bool {
	return true
}
