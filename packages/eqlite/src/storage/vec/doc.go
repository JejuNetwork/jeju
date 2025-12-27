// Package vec provides sqlite-vec vector search extension integration for EQLite.
//
// sqlite-vec is a high-performance SQLite extension for vector similarity search.
// It supports:
// - FLOAT32 vectors up to 65,535 dimensions
// - INT8/BIT quantization for memory efficiency
// - K-nearest neighbor (KNN) queries
// - Approximate nearest neighbor (ANN) with partitioning
//
// Usage:
//
//	import (
//		"database/sql"
//		"eqlite/src/storage/vec"
//	)
//
//	// Initialize the extension (call once at startup)
//	vec.Init()
//
//	// Open database with vec0 support
//	db, err := sql.Open("sqlite3-vec", "mydb.db")
//
//	// Create vector table
//	db.Exec(`CREATE VIRTUAL TABLE embeddings USING vec0(
//		embedding FLOAT[1536]
//	)`)
//
//	// Insert vectors
//	db.Exec(`INSERT INTO embeddings(rowid, embedding) VALUES (1, ?)`, vecData)
//
//	// Query similar vectors
//	rows, _ := db.Query(`
//		SELECT rowid, distance
//		FROM embeddings
//		WHERE embedding MATCH ?
//		ORDER BY distance
//		LIMIT 10
//	`, queryVec)
//
// See https://github.com/asg017/sqlite-vec for more details.
package vec

