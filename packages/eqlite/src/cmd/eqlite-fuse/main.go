
// This is a simple fuse filesystem that stores all metadata and data
// in cockroach.
//
// Inode relationships are stored in the `namespace` table, and inodes
// themselves in the `inode` table.
//
// Data blocks are stored in the `block` table, indexed by inode ID
// and block number.
//
// Basic functionality is implemented, including:
// - mk/rm directory
// - create/rm files
// - read/write files
// - rename
// - symlinks
//
// WARNING: concurrent access on a single mount is fine. However,
// behavior is undefined (read broken) when mounted more than once at the
// same time. Specifically, read/writes will not be seen right away and
// may work on out of date information.
//
// One caveat of the implemented features is that handles are not
// reference counted so if an inode is deleted, all open file descriptors
// pointing to it become invalid.
//
// Some TODOs (definitely not a comprehensive list):
// - support basic attributes (mode, timestamps)
// - support other types: hard links
// - add ref counting (and handle open/release)
// - sparse files: don't store empty blocks
// - sparse files 2: keep track of holes

package main

import (
	"database/sql"
	"flag"
	"fmt"
	"os"

	"bazil.org/fuse"
	"bazil.org/fuse/fs"
	_ "bazil.org/fuse/fs/fstestutil"

	"eqlite/src/client"
	"eqlite/src/utils"
	"eqlite/src/utils/log"
)

var usage = func() {
	_, _ = fmt.Fprintf(os.Stderr, "Usage of %s:\n", os.Args[0])
	_, _ = fmt.Fprintf(os.Stderr, "  %s -config <config> -dsn <dsn> -mount <mountpoint>\n\n", os.Args[0])
	flag.PrintDefaults()
}

func main() {
	var (
		configFile string
		dsn        string
		mountPoint string
		password   string
		readOnly   bool
	)
	flag.StringVar(&configFile, "config", "~/.eqlite/config.yaml", "Config file path")
	flag.StringVar(&mountPoint, "mount", "./", "Dir to mount")
	flag.StringVar(&dsn, "dsn", "", "Database url")
	flag.StringVar(&password, "password", "", "Master key password for eqlite")
	flag.BoolVar(&readOnly, "readonly", false, "Mount read only volume")
	flag.Usage = usage
	flag.Parse()

	log.SetLevel(log.InfoLevel)

	configFile = utils.HomeDirExpand(configFile)

	err := client.Init(configFile, []byte(password))
	if err != nil {
		log.Fatal(err)
	}

	cfg, err := client.ParseDSN(dsn)
	if err != nil {
		log.Fatal(err)
	}

	db, err := sql.Open("eqlite", cfg.FormatDSN())
	if err != nil {
		log.Fatal(err)
	}

	defer func() { _ = db.Close() }()

	if err := initSchema(db); err != nil {
		log.Fatal(err)
	}

	cfs := CFS{db}
	opts := make([]fuse.MountOption, 0, 5)
	opts = append(opts, fuse.FSName("EqliteFS"))
	opts = append(opts, fuse.Subtype("EqliteFS"))
	opts = append(opts, fuse.LocalVolume())
	opts = append(opts, fuse.VolumeName(cfg.DatabaseID))
	if readOnly {
		opts = append(opts, fuse.ReadOnly())
	}
	// Mount filesystem.
	c, err := fuse.Mount(
		mountPoint,
		opts...,
	)
	if err != nil {
		log.Fatal(err)
	}
	defer func() {
		_ = c.Close()
	}()

	log.Infof("DB: %s mount on %s succeed", dsn, mountPoint)

	go func() {
		<-utils.WaitForExit()
		if err := fuse.Unmount(mountPoint); err != nil {
			log.Printf("Signal received, but could not unmount: %s", err)
		}
	}()

	// Serve root.
	err = fs.Serve(c, cfs)
	if err != nil {
		log.Fatal(err)
	}

	// check if the mount process has an error to report
	<-c.Ready
	if err := c.MountError; err != nil {
		log.Fatal(err)
	}
}
