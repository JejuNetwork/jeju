package vec

import (
	"database/sql"
	"math"
	"os"
	"testing"
)

func TestFloat32Conversion(t *testing.T) {
	original := []float32{1.0, 2.5, -3.14, 0.0, 100.25}
	bytes := Float32ToBytes(original)
	recovered := BytesToFloat32(bytes)

	if len(recovered) != len(original) {
		t.Fatalf("length mismatch: got %d, want %d", len(recovered), len(original))
	}

	for i := range original {
		if recovered[i] != original[i] {
			t.Errorf("value mismatch at %d: got %f, want %f", i, recovered[i], original[i])
		}
	}
}

func TestVecDistanceL2(t *testing.T) {
	a := Float32ToBytes([]float32{0, 0, 0})
	b := Float32ToBytes([]float32{3, 4, 0})

	dist, err := vecDistanceL2(a, b)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expected := 5.0
	if math.Abs(dist-expected) > 0.0001 {
		t.Errorf("L2 distance: got %f, want %f", dist, expected)
	}
}

func TestVecDistanceCosine(t *testing.T) {
	a := Float32ToBytes([]float32{1, 0, 0})
	b := Float32ToBytes([]float32{1, 0, 0})

	dist, err := vecDistanceCosine(a, b)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if math.Abs(dist) > 0.0001 {
		t.Errorf("cosine distance for identical vectors: got %f, want 0", dist)
	}

	// Orthogonal vectors
	c := Float32ToBytes([]float32{1, 0, 0})
	d := Float32ToBytes([]float32{0, 1, 0})

	dist, err = vecDistanceCosine(c, d)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if math.Abs(dist-1.0) > 0.0001 {
		t.Errorf("cosine distance for orthogonal vectors: got %f, want 1", dist)
	}
}

func TestVecToJSON(t *testing.T) {
	vec := Float32ToBytes([]float32{1.5, 2.25, -3.0})
	json, err := vecToJSON(vec)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expected := "[1.5,2.25,-3]"
	if json != expected {
		t.Errorf("JSON output: got %s, want %s", json, expected)
	}
}

func TestVecFromJSON(t *testing.T) {
	json := "[1.5, 2.25, -3.0]"
	bytes, err := vecFromJSON(json)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	vec := BytesToFloat32(bytes)
	expected := []float32{1.5, 2.25, -3.0}

	if len(vec) != len(expected) {
		t.Fatalf("length mismatch: got %d, want %d", len(vec), len(expected))
	}

	for i := range expected {
		if math.Abs(float64(vec[i]-expected[i])) > 0.0001 {
			t.Errorf("value at %d: got %f, want %f", i, vec[i], expected[i])
		}
	}
}

func TestVecNormalize(t *testing.T) {
	vec := Float32ToBytes([]float32{3, 4, 0})
	normalized, err := vecNormalize(vec)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	result := BytesToFloat32(normalized)
	expected := []float32{0.6, 0.8, 0}

	for i := range expected {
		if math.Abs(float64(result[i]-expected[i])) > 0.0001 {
			t.Errorf("value at %d: got %f, want %f", i, result[i], expected[i])
		}
	}
}

func TestVecAdd(t *testing.T) {
	a := Float32ToBytes([]float32{1, 2, 3})
	b := Float32ToBytes([]float32{4, 5, 6})

	sum, err := vecAdd(a, b)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	result := BytesToFloat32(sum)
	expected := []float32{5, 7, 9}

	for i := range expected {
		if result[i] != expected[i] {
			t.Errorf("value at %d: got %f, want %f", i, result[i], expected[i])
		}
	}
}

func TestVecSub(t *testing.T) {
	a := Float32ToBytes([]float32{5, 7, 9})
	b := Float32ToBytes([]float32{1, 2, 3})

	diff, err := vecSub(a, b)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	result := BytesToFloat32(diff)
	expected := []float32{4, 5, 6}

	for i := range expected {
		if result[i] != expected[i] {
			t.Errorf("value at %d: got %f, want %f", i, result[i], expected[i])
		}
	}
}

func TestVecSlice(t *testing.T) {
	vec := Float32ToBytes([]float32{1, 2, 3, 4, 5})
	slice, err := vecSlice(vec, 1, 3)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	result := BytesToFloat32(slice)
	expected := []float32{2, 3, 4}

	if len(result) != len(expected) {
		t.Fatalf("length mismatch: got %d, want %d", len(result), len(expected))
	}

	for i := range expected {
		if result[i] != expected[i] {
			t.Errorf("value at %d: got %f, want %f", i, result[i], expected[i])
		}
	}
}

func TestVecLength(t *testing.T) {
	vec := Float32ToBytes([]float32{1, 2, 3, 4, 5})
	length, err := vecLength(vec)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if length != 5 {
		t.Errorf("length: got %d, want 5", length)
	}
}

func TestVecDriverInit(t *testing.T) {
	// Initialize the driver
	err := Init()
	if err != nil {
		t.Fatalf("failed to init vec driver: %v", err)
	}

	// Create temp file for database
	tmpFile, err := os.CreateTemp("", "vec_test_*.db")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	tmpFile.Close()
	defer os.Remove(tmpFile.Name())

	// Open database with vec driver
	db, err := sql.Open(VecDriverName, tmpFile.Name()+"?_journal_mode=WAL")
	if err != nil {
		t.Fatalf("failed to open database: %v", err)
	}
	defer db.Close()

	// Test vec_distance_l2 function
	var dist float64
	err = db.QueryRow(`
		SELECT vec_distance_l2(
			X'000000000000803f0000004000000040',
			X'000000000000803f0000004000000040'
		)
	`).Scan(&dist)
	if err != nil {
		t.Fatalf("failed to query vec_distance_l2: %v", err)
	}

	if dist != 0 {
		t.Errorf("distance for identical vectors: got %f, want 0", dist)
	}
}

func TestCreateVectorTableAndSearch(t *testing.T) {
	// Initialize the driver
	err := Init()
	if err != nil {
		t.Fatalf("failed to init vec driver: %v", err)
	}

	// Create temp file for database
	tmpFile, err := os.CreateTemp("", "vec_search_test_*.db")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	tmpFile.Close()
	defer os.Remove(tmpFile.Name())

	// Open database with vec driver
	db, err := sql.Open(VecDriverName, tmpFile.Name()+"?_journal_mode=WAL")
	if err != nil {
		t.Fatalf("failed to open database: %v", err)
	}
	defer db.Close()

	// Create regular table to store vectors (vec0 virtual table requires native extension)
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS embeddings (
			id INTEGER PRIMARY KEY,
			embedding BLOB NOT NULL
		)
	`)
	if err != nil {
		t.Fatalf("failed to create table: %v", err)
	}

	// Insert test vectors
	testVectors := [][]float32{
		{1.0, 0.0, 0.0},
		{0.0, 1.0, 0.0},
		{0.0, 0.0, 1.0},
		{0.5, 0.5, 0.0},
	}

	for i, vec := range testVectors {
		_, err = db.Exec("INSERT INTO embeddings(id, embedding) VALUES (?, ?)", i+1, Float32ToBytes(vec))
		if err != nil {
			t.Fatalf("failed to insert vector %d: %v", i+1, err)
		}
	}

	// Query using vec_distance_l2 function
	query := []float32{1.0, 0.0, 0.0}
	rows, err := db.Query(`
		SELECT id, vec_distance_l2(embedding, ?) as dist
		FROM embeddings
		ORDER BY dist
		LIMIT 2
	`, Float32ToBytes(query))
	if err != nil {
		t.Fatalf("failed to query: %v", err)
	}
	defer rows.Close()

	var results []struct {
		ID   int
		Dist float64
	}
	for rows.Next() {
		var r struct {
			ID   int
			Dist float64
		}
		if err := rows.Scan(&r.ID, &r.Dist); err != nil {
			t.Fatalf("failed to scan: %v", err)
		}
		results = append(results, r)
	}

	if len(results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(results))
	}

	// First result should be the identical vector with distance 0
	if results[0].ID != 1 {
		t.Errorf("first result ID: got %d, want 1", results[0].ID)
	}
	if results[0].Dist != 0 {
		t.Errorf("first result distance: got %f, want 0", results[0].Dist)
	}
}

