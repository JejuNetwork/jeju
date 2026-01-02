
package cpuminer

import (
	"bytes"
	"encoding/binary"
	"errors"

	hsp "sqlit/src/marshalhash"
)

const (
	// Uint256Size is the Uint256 byte size.
	Uint256Size = 8 * 4
)

var (
	// ErrBytesLen is an error type
	ErrBytesLen = errors.New("byte length should be 32 for Uint256")
	// ErrEmptyIPv6Addr is an error type
	ErrEmptyIPv6Addr = errors.New("nil or zero length IPv6")
)

// Uint256 is an unsigned 256 bit integer.
type Uint256 struct {
	A uint64 // Bits 63..0.
	B uint64 // Bits 127..64.
	C uint64 // Bits 191..128.
	D uint64 // Bits 255..192.
}

// Inc makes i = i + 1.
func (i *Uint256) Inc() (ret *Uint256) {
	if i.A++; i.A == 0 {
		if i.B++; i.B == 0 {
			if i.C++; i.C == 0 {
				i.D++
			}
		}
	}
	return i
}

// Bytes converts Uint256 to []byte.
func (i *Uint256) Bytes() []byte {
	var binBuf bytes.Buffer
	// binary.Write to bytes.Buffer never fails for fixed-size types
	_ = binary.Write(&binBuf, binary.BigEndian, i)
	return binBuf.Bytes()
}

// MarshalHash marshals for hash.
func (i *Uint256) MarshalHash() (o []byte, err error) {
	return i.Bytes(), nil
}

// Msgsize returns an upper bound estimate of the number of bytes occupied by the serialized message.
func (i *Uint256) Msgsize() (s int) {
	return hsp.BytesPrefixSize + 32
}

// Uint256FromBytes converts []byte to Uint256.
func Uint256FromBytes(b []byte) (*Uint256, error) {
	if len(b) != 32 {
		return nil, ErrBytesLen
	}
	i := Uint256{}
	// binary.Read from bytes.Buffer never fails for exact-length fixed-size types
	_ = binary.Read(bytes.NewBuffer(b), binary.BigEndian, &i)
	return &i, nil
}
