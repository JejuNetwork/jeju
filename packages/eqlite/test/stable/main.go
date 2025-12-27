package main

import (
	"crypto/rand"
	"database/sql"
	"flag"
	"fmt"
	"net/http"
	_ "net/http/pprof"
	"sync/atomic"
	"time"

	"eqlite/src/client"
	"eqlite/src/utils/log"
	"github.com/ivpusic/grpool"
)

const (
	tableNamePattern = "insert_table%v"
)

func createSqliteTestTable(db *sql.DB, tableName string) {
	tableDesc := fmt.Sprintf("CREATE TABLE `%s` (`k` INT, `v1` TEXT, PRIMARY KEY(`k`))", tableName)
	if _, err := db.Exec(tableDesc); err != nil {
		log.Fatal(err)
	}
}

func insertData(db *sql.DB, tableName string, dataCount int64, pool *grpool.Pool) {
	var i int64
	start := time.Now()
	log.Infof("LOG: %v start time %v\n", tableName, start.String())
	var errCount int32

	for i = 0; i < dataCount; i++ {
		var vals [1024]byte
		rand.Read(vals[:])
		data := string(vals[:])
		index := i
		pool.WaitCount(1)
		pool.JobQueue <- func() {
			defer pool.JobDone()
			_, err := db.Exec(
				fmt.Sprintf("INSERT INTO `%s` VALUES (?, ?)", tableName),
				index, data,
			)
			if err != nil {
				log.Errorf("Failed to insert data in database: %v %v\n", index, err)
				atomic.AddInt32(&errCount, 1)
			} else {
				atomic.StoreInt32(&errCount, 0)
			}
		}
		if i%10000 == 0 {
			log.Infof("%v Inserted: %v %v\n", time.Since(start), tableName, i)
		}
		if errCount > 10000 {
			log.Errorf("Error count reach max limit\n")
			break
		}
	}
	log.Infof("LOG: %v end time %v\n", tableName, time.Now().String())
}

func main() {
	log.SetLevel(log.InfoLevel)
	var config, password, dsn string

	flag.StringVar(&config, "config", "./conf/config.yaml", "config file path")
	flag.StringVar(&dsn, "dsn", "", "database url")
	flag.StringVar(&password, "password", "", "master key password for eqlite")
	flag.Parse()

	go func() {
		http.ListenAndServe("0.0.0.0:6061", nil)
	}()

	err := client.Init(config, []byte(password))
	if err != nil {
		log.Fatal(err)
	}

	db, err := sql.Open("eqlite", dsn)
	if err != nil {
		log.Fatal(err)
	}

	tableName := fmt.Sprintf(tableNamePattern, 0)
	_, err = db.Exec(fmt.Sprintf("DROP TABLE IF EXISTS %s;", tableName))
	if err != nil {
		log.Fatal(err)
	}

	createSqliteTestTable(db, tableName)

	pool := grpool.NewPool(8, 16)
	defer pool.Release()
	insertData(db, tableName, 500000000, pool)
	pool.WaitAll()

	err = db.Close()
	if err != nil {
		log.Fatal(err)
	}
}
