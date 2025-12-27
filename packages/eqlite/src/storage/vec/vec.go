package vec

import (
	"database/sql"
	"encoding/binary"
	"fmt"
	"math"
	"sync"

	sqlite3 "github.com/mattn/go-sqlite3"
)

const (
	// VecDriverName is the sqlite3 driver name with vec0 extension enabled.
	VecDriverName = "sqlite3-vec"

	// Vec0Extension is the extension module name.
	Vec0Extension = "vec0"
)

var (
	initOnce sync.Once
	initErr  error
)

// Init registers the sqlite3-vec driver with vector extension support.
// This must be called before opening any databases that need vector functionality.
// It is safe to call multiple times - initialization only happens once.
func Init() error {
	initOnce.Do(func() {
		initErr = registerVecDriver()
	})
	return initErr
}

// registerVecDriver registers the sqlite3-vec driver.
func registerVecDriver() error {
	sql.Register(VecDriverName, &sqlite3.SQLiteDriver{
		ConnectHook: func(c *sqlite3.SQLiteConn) error {
			// Register vec0 custom functions

			// vec_distance_l2 - Euclidean distance
			if err := c.RegisterFunc("vec_distance_l2", vecDistanceL2, true); err != nil {
				return fmt.Errorf("failed to register vec_distance_l2: %w", err)
			}

			// vec_distance_cosine - Cosine distance
			if err := c.RegisterFunc("vec_distance_cosine", vecDistanceCosine, true); err != nil {
				return fmt.Errorf("failed to register vec_distance_cosine: %w", err)
			}

			// vec_to_json - Convert binary vector to JSON array
			if err := c.RegisterFunc("vec_to_json", vecToJSON, true); err != nil {
				return fmt.Errorf("failed to register vec_to_json: %w", err)
			}

			// vec_from_json - Convert JSON array to binary vector
			if err := c.RegisterFunc("vec_from_json", vecFromJSON, true); err != nil {
				return fmt.Errorf("failed to register vec_from_json: %w", err)
			}

			// vec_length - Get vector dimension count
			if err := c.RegisterFunc("vec_length", vecLength, true); err != nil {
				return fmt.Errorf("failed to register vec_length: %w", err)
			}

			// vec_normalize - Normalize vector to unit length
			if err := c.RegisterFunc("vec_normalize", vecNormalize, true); err != nil {
				return fmt.Errorf("failed to register vec_normalize: %w", err)
			}

			// vec_add - Add two vectors
			if err := c.RegisterFunc("vec_add", vecAdd, true); err != nil {
				return fmt.Errorf("failed to register vec_add: %w", err)
			}

			// vec_sub - Subtract two vectors
			if err := c.RegisterFunc("vec_sub", vecSub, true); err != nil {
				return fmt.Errorf("failed to register vec_sub: %w", err)
			}

			// vec_slice - Extract slice of vector
			if err := c.RegisterFunc("vec_slice", vecSlice, true); err != nil {
				return fmt.Errorf("failed to register vec_slice: %w", err)
			}

			return nil
		},
	})

	return nil
}

// Float32ToBytes converts a slice of float32 values to bytes in little-endian format.
// This is the format expected by sqlite-vec.
func Float32ToBytes(vec []float32) []byte {
	buf := make([]byte, len(vec)*4)
	for i, v := range vec {
		binary.LittleEndian.PutUint32(buf[i*4:], math.Float32bits(v))
	}
	return buf
}

// BytesToFloat32 converts bytes in little-endian format to float32 values.
func BytesToFloat32(buf []byte) []float32 {
	if len(buf)%4 != 0 {
		return nil
	}
	vec := make([]float32, len(buf)/4)
	for i := range vec {
		bits := binary.LittleEndian.Uint32(buf[i*4:])
		vec[i] = math.Float32frombits(bits)
	}
	return vec
}

// vecDistanceL2 calculates Euclidean (L2) distance between two vectors.
func vecDistanceL2(a, b []byte) (float64, error) {
	vecA := BytesToFloat32(a)
	vecB := BytesToFloat32(b)

	if len(vecA) != len(vecB) {
		return 0, fmt.Errorf("vector dimension mismatch: %d vs %d", len(vecA), len(vecB))
	}

	var sum float64
	for i := range vecA {
		diff := float64(vecA[i]) - float64(vecB[i])
		sum += diff * diff
	}

	return math.Sqrt(sum), nil
}

// vecDistanceCosine calculates Cosine distance between two vectors.
// Returns 1 - cosine_similarity.
func vecDistanceCosine(a, b []byte) (float64, error) {
	vecA := BytesToFloat32(a)
	vecB := BytesToFloat32(b)

	if len(vecA) != len(vecB) {
		return 0, fmt.Errorf("vector dimension mismatch: %d vs %d", len(vecA), len(vecB))
	}

	var dot, normA, normB float64
	for i := range vecA {
		fA := float64(vecA[i])
		fB := float64(vecB[i])
		dot += fA * fB
		normA += fA * fA
		normB += fB * fB
	}

	if normA == 0 || normB == 0 {
		return 1, nil
	}

	similarity := dot / (math.Sqrt(normA) * math.Sqrt(normB))
	return 1 - similarity, nil
}

// vecToJSON converts binary vector to JSON array string.
func vecToJSON(data []byte) (string, error) {
	vec := BytesToFloat32(data)
	if vec == nil {
		return "[]", nil
	}

	result := "["
	for i, v := range vec {
		if i > 0 {
			result += ","
		}
		result += fmt.Sprintf("%g", v)
	}
	result += "]"
	return result, nil
}

// vecFromJSON converts JSON array string to binary vector.
func vecFromJSON(json string) ([]byte, error) {
	var vec []float32

	// Simple JSON array parser
	json = trimSpaces(json)
	if len(json) < 2 || json[0] != '[' || json[len(json)-1] != ']' {
		return nil, fmt.Errorf("invalid JSON array format")
	}

	inner := json[1 : len(json)-1]
	if inner == "" {
		return Float32ToBytes(vec), nil
	}

	// Parse comma-separated numbers
	start := 0
	for i := 0; i <= len(inner); i++ {
		if i == len(inner) || inner[i] == ',' {
			numStr := trimSpaces(inner[start:i])
			if numStr != "" {
				var val float64
				if _, err := fmt.Sscanf(numStr, "%f", &val); err != nil {
					return nil, fmt.Errorf("invalid number: %s", numStr)
				}
				vec = append(vec, float32(val))
			}
			start = i + 1
		}
	}

	return Float32ToBytes(vec), nil
}

func trimSpaces(s string) string {
	start, end := 0, len(s)
	for start < end && (s[start] == ' ' || s[start] == '\t' || s[start] == '\n' || s[start] == '\r') {
		start++
	}
	for end > start && (s[end-1] == ' ' || s[end-1] == '\t' || s[end-1] == '\n' || s[end-1] == '\r') {
		end--
	}
	return s[start:end]
}

// vecLength returns the dimension count of a vector.
func vecLength(data []byte) (int, error) {
	if len(data)%4 != 0 {
		return 0, fmt.Errorf("invalid vector data length")
	}
	return len(data) / 4, nil
}

// vecNormalize normalizes a vector to unit length.
func vecNormalize(data []byte) ([]byte, error) {
	vec := BytesToFloat32(data)
	if vec == nil {
		return nil, fmt.Errorf("invalid vector data")
	}

	var norm float64
	for _, v := range vec {
		norm += float64(v) * float64(v)
	}
	norm = math.Sqrt(norm)

	if norm == 0 {
		return data, nil
	}

	result := make([]float32, len(vec))
	for i, v := range vec {
		result[i] = float32(float64(v) / norm)
	}

	return Float32ToBytes(result), nil
}

// vecAdd adds two vectors element-wise.
func vecAdd(a, b []byte) ([]byte, error) {
	vecA := BytesToFloat32(a)
	vecB := BytesToFloat32(b)

	if len(vecA) != len(vecB) {
		return nil, fmt.Errorf("vector dimension mismatch: %d vs %d", len(vecA), len(vecB))
	}

	result := make([]float32, len(vecA))
	for i := range vecA {
		result[i] = vecA[i] + vecB[i]
	}

	return Float32ToBytes(result), nil
}

// vecSub subtracts two vectors element-wise.
func vecSub(a, b []byte) ([]byte, error) {
	vecA := BytesToFloat32(a)
	vecB := BytesToFloat32(b)

	if len(vecA) != len(vecB) {
		return nil, fmt.Errorf("vector dimension mismatch: %d vs %d", len(vecA), len(vecB))
	}

	result := make([]float32, len(vecA))
	for i := range vecA {
		result[i] = vecA[i] - vecB[i]
	}

	return Float32ToBytes(result), nil
}

// vecSlice extracts a slice of a vector.
func vecSlice(data []byte, start, length int) ([]byte, error) {
	vec := BytesToFloat32(data)
	if vec == nil {
		return nil, fmt.Errorf("invalid vector data")
	}

	if start < 0 || start >= len(vec) {
		return nil, fmt.Errorf("start index out of bounds: %d", start)
	}

	end := start + length
	if end > len(vec) {
		end = len(vec)
	}

	return Float32ToBytes(vec[start:end]), nil
}

// CreateVectorTable creates a vec0 virtual table for vector storage.
// dimensions specifies the vector size (e.g., 1536 for OpenAI embeddings).
// metricType can be "L2" (Euclidean) or "cosine".
func CreateVectorTable(db *sql.DB, tableName string, dimensions int, metricType string) error {
	metric := "L2"
	if metricType == "cosine" {
		metric = "cosine"
	}

	query := fmt.Sprintf(`
		CREATE VIRTUAL TABLE IF NOT EXISTS %s USING vec0(
			embedding FLOAT[%d] distance_metric=%s
		)
	`, tableName, dimensions, metric)

	_, err := db.Exec(query)
	return err
}

// InsertVector inserts a vector into a vec0 table.
func InsertVector(db *sql.DB, tableName string, rowID int64, vector []float32) error {
	query := fmt.Sprintf("INSERT INTO %s(rowid, embedding) VALUES (?, ?)", tableName)
	_, err := db.Exec(query, rowID, Float32ToBytes(vector))
	return err
}

// SearchNearest finds the k nearest neighbors to a query vector.
func SearchNearest(db *sql.DB, tableName string, queryVec []float32, k int) ([]SearchResult, error) {
	query := fmt.Sprintf(`
		SELECT rowid, distance
		FROM %s
		WHERE embedding MATCH ?
		ORDER BY distance
		LIMIT ?
	`, tableName)

	rows, err := db.Query(query, Float32ToBytes(queryVec), k)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []SearchResult
	for rows.Next() {
		var result SearchResult
		if err := rows.Scan(&result.RowID, &result.Distance); err != nil {
			return nil, err
		}
		results = append(results, result)
	}

	return results, rows.Err()
}

// SearchResult represents a vector search result.
type SearchResult struct {
	RowID    int64
	Distance float64
}

