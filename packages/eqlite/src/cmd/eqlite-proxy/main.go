
package main

import (
	"context"
	"flag"
	"fmt"
	"net/http"
	"os"
	"runtime"
	"time"

	"eqlite/src/client"
	"eqlite/src/cmd/eqlite-proxy/config"
	"eqlite/src/crypto/asymmetric"
	"eqlite/src/utils"
	"eqlite/src/utils/log"
)

const name = "eqlite-proxy"

var (
	version     = "unknown"
	listenAddr  string
	configFile  string
	password    string
	showVersion bool
)

func init() {
	flag.StringVar(&listenAddr, "listen", "", "API listen addr (will override settings in config file")
	flag.StringVar(&configFile, "config", "~/.eqlite/config.yaml", "Configuration file for eqlite")
	flag.StringVar(&password, "password", "", "Master key password for eqlite")
	flag.BoolVar(&asymmetric.BypassSignature, "bypass-signature", false,
		"Disable signature sign and verify, for testing")
	flag.BoolVar(&showVersion, "version", false, "Show version information and exit")
}

func main() {
	log.SetLevel(log.DebugLevel)
	flag.Parse()
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
	var err error
	if err = client.Init(configFile, []byte(password)); err != nil {
		log.WithError(err).Error("init eqlite client failed")
		os.Exit(-1)
		return
	}

	// load proxy config from same config file
	var cfg *config.Config

	if cfg, err = config.LoadConfig(listenAddr, configFile); err != nil {
		log.WithError(err).Error("read config failed")
		os.Exit(-1)
		return
	}

	// init server
	var (
		server        *http.Server
		afterShutdown func()
	)
	if server, afterShutdown, err = initServer(cfg); err != nil {
		log.WithError(err).Error("init server failed")
		os.Exit(-1)
		return
	}

	go func() {
		_ = server.ListenAndServe()
	}()

	log.Info("started proxy")

	<-utils.WaitForExit()

	// stop faucet api
	ctx, cancel := context.WithTimeout(context.Background(), time.Second*5)
	defer cancel()

	_ = server.Shutdown(ctx)
	afterShutdown()
	log.Info("stopped proxy")
}
