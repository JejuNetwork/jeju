package types

import (
	"encoding/json"
	"sort"
)

// MarshalHashHelper provides a generic MarshalHash implementation
// using deterministic JSON encoding (sorted keys).
func MarshalHashHelper(v interface{}) ([]byte, error) {
	// Use json.Marshal which produces deterministic output for structs
	data, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	return data, nil
}

// MarshalHashMap marshals a map with sorted keys for deterministic output
func MarshalHashMap(m map[string]interface{}) ([]byte, error) {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	sorted := make(map[string]interface{}, len(m))
	for _, k := range keys {
		sorted[k] = m[k]
	}

	return json.Marshal(sorted)
}

