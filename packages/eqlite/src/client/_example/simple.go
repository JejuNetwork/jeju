package main

import (
	"database/sql"
	"flag"
	"fmt"

	_ "eqlite/src/client"
	"eqlite/src/utils/log"
)

func main() {
	log.SetLevel(log.InfoLevel)
	var dsn string

	flag.StringVar(&dsn, "dsn", "", "Database url")
	flag.Parse()

	// If your EQLite config.yaml is not in ~/.eqlite/config.yaml
	// Uncomment and edit following code
	/*
			config := "/data/myconfig/config.yaml"
			password := "mypassword"
		    err := client.Init(config, []byte(password))
		    if err != nil {
		        log.Fatal(err)
		    }
	*/

	db, err := sql.Open("eqlite", dsn)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	_, err = db.Exec("DROP TABLE IF EXISTS testSimple;")
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec("CREATE TABLE testSimple ( indexedColumn, nonIndexedColumn );")
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec("CREATE INDEX testIndexedColumn ON testSimple ( indexedColumn );")
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec("INSERT INTO testSimple VALUES(?, ?);", 4, 400)
	if err != nil {
		log.Fatal(err)
	}

	row := db.QueryRow("SELECT nonIndexedColumn FROM testSimple LIMIT 1;")

	var result int
	err = row.Scan(&result)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("SELECT nonIndexedColumn FROM testSimple LIMIT 1; result %d\n", result)

}
