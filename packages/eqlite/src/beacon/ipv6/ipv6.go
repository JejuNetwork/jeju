// Package ipv6 provides utilities for encoding and decoding arbitrary data
// into IPv6 addresses for DNS-based peer discovery.
package ipv6

import (
	"encoding/binary"
	"fmt"
	"net"
	"sort"
	"strings"

	"github.com/pkg/errors"
)

const (
	// IPv6ByteLen is the length of an IPv6 address in bytes
	IPv6ByteLen = 16
	// DataBytesPerIP is the number of data bytes per IPv6 address (first 2 bytes are index)
	DataBytesPerIP = 14
)

// LookupFunc is the function signature for DNS lookups
type LookupFunc func(host string) ([]net.IP, error)

// ToIPv6 encodes arbitrary data into a slice of IPv6 addresses.
// Each IPv6 address contains 14 bytes of data (bytes 2-15) with a 2-byte index prefix.
func ToIPv6(data []byte) ([]string, error) {
	if len(data) == 0 {
		return nil, errors.New("empty data")
	}

	numIPs := (len(data) + DataBytesPerIP - 1) / DataBytesPerIP
	result := make([]string, numIPs)

	for i := 0; i < numIPs; i++ {
		ip := make([]byte, IPv6ByteLen)
		// First 2 bytes are the index (big-endian)
		binary.BigEndian.PutUint16(ip[0:2], uint16(i))

		// Copy up to 14 bytes of data
		start := i * DataBytesPerIP
		end := start + DataBytesPerIP
		if end > len(data) {
			end = len(data)
		}
		copy(ip[2:], data[start:end])

		result[i] = net.IP(ip).String()
	}

	return result, nil
}

// FromDomain retrieves and decodes data from IPv6 DNS records.
// It uses the provided lookup function to resolve the domain.
func FromDomain(domain string, lookup LookupFunc) ([]byte, error) {
	ips, err := lookup(domain)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to lookup %s", domain)
	}

	if len(ips) == 0 {
		return nil, errors.Errorf("no IP addresses found for %s", domain)
	}

	// Filter for IPv6 addresses only
	var ipv6Addrs []net.IP
	for _, ip := range ips {
		if ip.To4() == nil && ip.To16() != nil {
			ipv6Addrs = append(ipv6Addrs, ip.To16())
		}
	}

	if len(ipv6Addrs) == 0 {
		return nil, errors.Errorf("no IPv6 addresses found for %s", domain)
	}

	// Sort by index (first 2 bytes)
	sort.Slice(ipv6Addrs, func(i, j int) bool {
		idxI := binary.BigEndian.Uint16(ipv6Addrs[i][0:2])
		idxJ := binary.BigEndian.Uint16(ipv6Addrs[j][0:2])
		return idxI < idxJ
	})

	// Extract data from each IP
	var result []byte
	for _, ip := range ipv6Addrs {
		result = append(result, ip[2:IPv6ByteLen]...)
	}

	// Trim trailing zeros (padding)
	result = trimTrailingZeros(result)

	return result, nil
}

// trimTrailingZeros removes trailing zero bytes from the data
func trimTrailingZeros(data []byte) []byte {
	i := len(data)
	for i > 0 && data[i-1] == 0 {
		i--
	}
	return data[:i]
}

// ParseIPv6 parses an IPv6 string into index and data components
func ParseIPv6(ipStr string) (index uint16, data []byte, err error) {
	ip := net.ParseIP(strings.TrimSpace(ipStr))
	if ip == nil {
		return 0, nil, errors.Errorf("invalid IP: %s", ipStr)
	}

	ip16 := ip.To16()
	if ip16 == nil {
		return 0, nil, errors.Errorf("not an IPv6 address: %s", ipStr)
	}

	index = binary.BigEndian.Uint16(ip16[0:2])
	data = make([]byte, DataBytesPerIP)
	copy(data, ip16[2:IPv6ByteLen])

	return index, data, nil
}

// FormatIPv6 formats data with an index into an IPv6 address string
func FormatIPv6(index uint16, data []byte) string {
	ip := make([]byte, IPv6ByteLen)
	binary.BigEndian.PutUint16(ip[0:2], index)

	copyLen := DataBytesPerIP
	if len(data) < copyLen {
		copyLen = len(data)
	}
	copy(ip[2:], data[:copyLen])

	return net.IP(ip).String()
}

// String returns a human-readable representation of the encoded data
func String(data []byte) string {
	ips, err := ToIPv6(data)
	if err != nil {
		return fmt.Sprintf("error: %v", err)
	}
	return strings.Join(ips, ", ")
}

