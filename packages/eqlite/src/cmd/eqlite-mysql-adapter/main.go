
package main

import (
	"flag"
	"fmt"
	"os"
	"runtime"

	"eqlite/src/client"
	"eqlite/src/crypto/asymmetric"
	"eqlite/src/utils"
	"eqlite/src/utils/log"
)

const name = "eqlite-mysql-adapter"

var (
	version    = "unknown"
	configFile string
	password   string

	listenAddr    string
	mysqlUser     string
	mysqlPassword string
	showVersion   bool
	logLevel      string
)

func init() {
	flag.StringVar(&configFile, "config", "~/.eqlite/config.yaml", "Config file for mysql adapter")
	flag.StringVar(&password, "password", "", "Master key password")
	flag.BoolVar(&asymmetric.BypassSignature, "bypass-signature", false,
		"Disable signature sign and verify, for testing")
	flag.BoolVar(&showVersion, "version", false, "Show version information and exit")

	flag.StringVar(&listenAddr, "listen", "127.0.0.1:4664", "Listen address for mysql adapter")
	flag.StringVar(&mysqlUser, "mysql-user", "root", "MySQL user for adapter server")
	flag.StringVar(&mysqlPassword, "mysql-password", "calvin", "MySQL password for adapter server")
	flag.StringVar(&logLevel, "log-level", "", "Service log level")
}

func main() {
	flag.Parse()
	log.SetStringLevel(logLevel, log.InfoLevel)
	if showVersion {
		fmt.Printf("%v %v %v %v %v\n",
			name, version, runtime.GOOS, runtime.GOARCH, runtime.Version())
		os.Exit(0)
	}

	configFile = utils.HomeDirExpand(configFile)

	flag.Visit(func(f *flag.Flag) {
		log.Infof("args %#v : %s", f.Name, f.Value)
	})

	// init client
	if err := client.Init(configFile, []byte(password)); err != nil {
		log.WithError(err).Fatal("init eqlite client failed")
		return
	}

	server, err := NewServer(listenAddr, mysqlUser, mysqlPassword)
	if err != nil {
		log.WithError(err).Fatal("init server failed")
		return
	}

	go server.Serve()

	log.Info("start mysql adapter")

	<-utils.WaitForExit()

	server.Shutdown()

	log.Info("stopped mysql adapter")
}
