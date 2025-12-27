// Package marshalhash provides msgpack encoding functions with deterministic ordering
// for use in hash computations. This is a drop-in replacement for HashStablePack/marshalhash.
package marshalhash

import (
	"encoding/binary"
	"math"
	"reflect"
	"sort"
	"time"
)

// Msgpack format constants
const (
	mfixstr   = 0xa0
	mstr8     = 0xd9
	mstr16    = 0xda
	mstr32    = 0xdb
	mbin8     = 0xc4
	mbin16    = 0xc5
	mbin32    = 0xc6
	mfixarray = 0x90
	marray16  = 0xdc
	marray32  = 0xdd
	mfixmap   = 0x80
	mmap16    = 0xde
	mmap32    = 0xdf
	mnil      = 0xc0
	mfalse    = 0xc2
	mtrue     = 0xc3
	mfloat32  = 0xca
	mfloat64  = 0xcb
	muint8    = 0xcc
	muint16   = 0xcd
	muint32   = 0xce
	muint64   = 0xcf
	mint8     = 0xd0
	mint16    = 0xd1
	mint32    = 0xd2
	mint64    = 0xd3
	mfixext8  = 0xd7
)

// TimeExtensionByte is the msgpack extension type for time (0xff = -1 as signed byte)
const TimeExtensionByte byte = 0xff

// Size constants for msgpack encoding (maximum sizes)
const (
	// BytesPrefixSize is the max size of a bytes prefix (bin32)
	BytesPrefixSize = 5
	// StringPrefixSize is the max size of a string prefix (str32)
	StringPrefixSize = 5
	// ArrayHeaderSize is the max size of an array header (array32)
	ArrayHeaderSize = 5
	// Int8Size is the size of an int8
	Int8Size = 2
	// Int16Size is the size of an int16
	Int16Size = 3
	// Int32Size is the size of an int32
	Int32Size = 5
	// Int64Size is the size of an int64
	Int64Size = 9
	// IntSize is the max size of an int
	IntSize = 9
	// Uint8Size is the size of a uint8
	Uint8Size = 2
	// Uint16Size is the size of a uint16
	Uint16Size = 3
	// Uint32Size is the size of a uint32
	Uint32Size = 5
	// Uint64Size is the size of a uint64
	Uint64Size = 9
	// Float32Size is the size of a float32
	Float32Size = 5
	// Float64Size is the size of a float64
	Float64Size = 9
	// NilSize is the size of nil
	NilSize = 1
	// BoolSize is the size of a bool
	BoolSize = 1
	// TimeSize is the size of a time value (fixext8)
	TimeSize = 10
)

// ByteSize returns the size needed to encode a single byte
func ByteSize(b byte) int {
	if b < 128 {
		return 1
	}
	return 2
}

// GuessSize returns an estimated size for an interface value
func GuessSize(i interface{}) int {
	if i == nil {
		return 1
	}
	switch v := i.(type) {
	case bool:
		return 1
	case int, int8, int16, int32, int64:
		return 9
	case uint, uint8, uint16, uint32, uint64:
		return 9
	case float32:
		return 5
	case float64:
		return 9
	case string:
		return StringPrefixSize + len(v)
	case []byte:
		return BytesPrefixSize + len(v)
	case time.Time:
		return TimeSize
	default:
		return 32 // conservative estimate
	}
}

// Require ensures the slice has enough capacity
func Require(b []byte, sz int) []byte {
	if cap(b)-len(b) >= sz {
		return b
	}
	newCap := cap(b) * 2
	if newCap < len(b)+sz {
		newCap = len(b) + sz
	}
	newB := make([]byte, len(b), newCap)
	copy(newB, b)
	return newB
}

// AppendNil appends a nil value
func AppendNil(b []byte) []byte {
	return append(b, mnil)
}

// AppendBool appends a boolean value
func AppendBool(b []byte, v bool) []byte {
	if v {
		return append(b, mtrue)
	}
	return append(b, mfalse)
}

// AppendByte appends a single byte
func AppendByte(b []byte, v byte) []byte {
	if v < 128 {
		return append(b, v)
	}
	return append(b, muint8, v)
}

// AppendInt appends a signed integer (accepts int for compatibility)
func AppendInt(b []byte, v int) []byte {
	return appendInt64(b, int64(v))
}

// AppendInt64 appends an int64
func AppendInt64(b []byte, v int64) []byte {
	return appendInt64(b, v)
}

func appendInt64(b []byte, v int64) []byte {
	if v >= 0 {
		return appendUint64(b, uint64(v))
	}
	if v >= -32 {
		return append(b, byte(v))
	}
	if v >= math.MinInt8 {
		return append(b, mint8, byte(v))
	}
	if v >= math.MinInt16 {
		o := make([]byte, 3)
		o[0] = mint16
		binary.BigEndian.PutUint16(o[1:], uint16(v))
		return append(b, o...)
	}
	if v >= math.MinInt32 {
		o := make([]byte, 5)
		o[0] = mint32
		binary.BigEndian.PutUint32(o[1:], uint32(v))
		return append(b, o...)
	}
	o := make([]byte, 9)
	o[0] = mint64
	binary.BigEndian.PutUint64(o[1:], uint64(v))
	return append(b, o...)
}

// Int encodes a signed integer (convenience wrapper)
func Int(v int64) ([]byte, error) {
	return appendInt64(nil, v), nil
}

// AppendUint appends an unsigned integer (accepts uint64)
func AppendUint(b []byte, v uint64) []byte {
	return appendUint64(b, v)
}

// AppendUint64 appends a uint64
func AppendUint64(b []byte, v uint64) []byte {
	return appendUint64(b, v)
}

// AppendUint32 appends a uint32
func AppendUint32(b []byte, v uint32) []byte {
	return appendUint64(b, uint64(v))
}

// AppendInt32 appends an int32
func AppendInt32(b []byte, v int32) []byte {
	return appendInt64(b, int64(v))
}

// AppendFloat64 appends a float64 value
func AppendFloat64(b []byte, v float64) []byte {
	return AppendFloat(b, v)
}

func appendUint64(b []byte, v uint64) []byte {
	if v < 128 {
		return append(b, byte(v))
	}
	if v <= math.MaxUint8 {
		return append(b, muint8, byte(v))
	}
	if v <= math.MaxUint16 {
		o := make([]byte, 3)
		o[0] = muint16
		binary.BigEndian.PutUint16(o[1:], uint16(v))
		return append(b, o...)
	}
	if v <= math.MaxUint32 {
		o := make([]byte, 5)
		o[0] = muint32
		binary.BigEndian.PutUint32(o[1:], uint32(v))
		return append(b, o...)
	}
	o := make([]byte, 9)
	o[0] = muint64
	binary.BigEndian.PutUint64(o[1:], v)
	return append(b, o...)
}

// Uint encodes an unsigned integer (convenience wrapper)
func Uint(v uint64) ([]byte, error) {
	return appendUint64(nil, v), nil
}

// AppendFloat appends a float64 value
func AppendFloat(b []byte, v float64) []byte {
	o := make([]byte, 9)
	o[0] = mfloat64
	binary.BigEndian.PutUint64(o[1:], math.Float64bits(v))
	return append(b, o...)
}

// Float encodes a float64 (convenience wrapper)
func Float(v float64) ([]byte, error) {
	return AppendFloat(nil, v), nil
}

// AppendString appends a string value
func AppendString(b []byte, s string) []byte {
	n := len(s)
	if n < 32 {
		b = append(b, byte(mfixstr|n))
	} else if n <= math.MaxUint8 {
		b = append(b, mstr8, byte(n))
	} else if n <= math.MaxUint16 {
		b = append(b, mstr16)
		b = append(b, byte(n>>8), byte(n))
	} else {
		b = append(b, mstr32)
		b = append(b, byte(n>>24), byte(n>>16), byte(n>>8), byte(n))
	}
	return append(b, s...)
}

// AppendBytes appends a byte slice
func AppendBytes(b []byte, data []byte) []byte {
	n := len(data)
	if n <= math.MaxUint8 {
		b = append(b, mbin8, byte(n))
	} else if n <= math.MaxUint16 {
		b = append(b, mbin16)
		b = append(b, byte(n>>8), byte(n))
	} else {
		b = append(b, mbin32)
		b = append(b, byte(n>>24), byte(n>>16), byte(n>>8), byte(n))
	}
	return append(b, data...)
}

// AppendArrayHeader appends an array header
func AppendArrayHeader(b []byte, n uint32) []byte {
	if n < 16 {
		return append(b, byte(mfixarray|n))
	}
	if n <= math.MaxUint16 {
		return append(b, marray16, byte(n>>8), byte(n))
	}
	return append(b, marray32, byte(n>>24), byte(n>>16), byte(n>>8), byte(n))
}

// AppendTime appends a time value using msgpack ext format
func AppendTime(b []byte, t time.Time) []byte {
	// Use fixext8 format with extension type -1 (time)
	b = append(b, mfixext8, TimeExtensionByte)

	// Encode as seconds and nanoseconds (8 bytes total)
	secs := t.Unix()
	nsecs := t.Nanosecond()

	buf := make([]byte, 8)
	binary.BigEndian.PutUint32(buf[0:4], uint32(nsecs))
	binary.BigEndian.PutUint32(buf[4:8], uint32(secs))

	return append(b, buf...)
}

// AppendIntf appends an interface value with deterministic map ordering
func AppendIntf(b []byte, v interface{}) ([]byte, error) {
	if v == nil {
		return AppendNil(b), nil
	}

	switch val := v.(type) {
	case bool:
		return AppendBool(b, val), nil
	case int:
		return AppendInt(b, val), nil
	case int8:
		return AppendInt(b, int(val)), nil
	case int16:
		return AppendInt(b, int(val)), nil
	case int32:
		return AppendInt(b, int(val)), nil
	case int64:
		return AppendInt64(b, val), nil
	case uint:
		return AppendUint(b, uint64(val)), nil
	case uint8:
		return AppendUint(b, uint64(val)), nil
	case uint16:
		return AppendUint(b, uint64(val)), nil
	case uint32:
		return AppendUint(b, uint64(val)), nil
	case uint64:
		return AppendUint(b, val), nil
	case float32:
		return AppendFloat(b, float64(val)), nil
	case float64:
		return AppendFloat(b, val), nil
	case string:
		return AppendString(b, val), nil
	case []byte:
		return AppendBytes(b, val), nil
	case time.Time:
		return AppendTime(b, val), nil
	case []interface{}:
		b = AppendArrayHeader(b, uint32(len(val)))
		var err error
		for _, elem := range val {
			b, err = AppendIntf(b, elem)
			if err != nil {
				return nil, err
			}
		}
		return b, nil
	case map[string]interface{}:
		return appendMapSorted(b, val)
	default:
		// Use reflection for other types
		return appendReflect(b, reflect.ValueOf(v))
	}
}

// appendMapSorted appends a map with keys sorted for deterministic output
func appendMapSorted(b []byte, m map[string]interface{}) ([]byte, error) {
	n := len(m)
	if n < 16 {
		b = append(b, byte(mfixmap|n))
	} else if n <= math.MaxUint16 {
		b = append(b, mmap16, byte(n>>8), byte(n))
	} else {
		b = append(b, mmap32, byte(n>>24), byte(n>>16), byte(n>>8), byte(n))
	}

	// Sort keys for deterministic ordering
	keys := make([]string, 0, n)
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var err error
	for _, k := range keys {
		b = AppendString(b, k)
		b, err = AppendIntf(b, m[k])
		if err != nil {
			return nil, err
		}
	}
	return b, nil
}

// appendReflect handles reflection-based encoding
func appendReflect(b []byte, v reflect.Value) ([]byte, error) {
	if !v.IsValid() {
		return AppendNil(b), nil
	}

	switch v.Kind() {
	case reflect.Ptr, reflect.Interface:
		if v.IsNil() {
			return AppendNil(b), nil
		}
		return appendReflect(b, v.Elem())
	case reflect.Slice:
		if v.IsNil() {
			return AppendNil(b), nil
		}
		if v.Type().Elem().Kind() == reflect.Uint8 {
			return AppendBytes(b, v.Bytes()), nil
		}
		b = AppendArrayHeader(b, uint32(v.Len()))
		var err error
		for i := 0; i < v.Len(); i++ {
			b, err = appendReflect(b, v.Index(i))
			if err != nil {
				return nil, err
			}
		}
		return b, nil
	case reflect.Array:
		b = AppendArrayHeader(b, uint32(v.Len()))
		var err error
		for i := 0; i < v.Len(); i++ {
			b, err = appendReflect(b, v.Index(i))
			if err != nil {
				return nil, err
			}
		}
		return b, nil
	default:
		return AppendIntf(b, v.Interface())
	}
}
