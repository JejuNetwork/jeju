
package main

import (
	"context"
	"flag"
	"fmt"
	"net/http"
	"os"
	"runtime"
	"time"

	"sqlit/src/client"
	"sqlit/src/cmd/sqlit-proxy/config"
	"sqlit/src/crypto/asymmetric"
	"sqlit/src/crypto/kms"
	"sqlit/src/utils"
	"sqlit/src/utils/log"
)

const name = "sqlit-proxy"

var (
	version     = "unknown"
	listenAddr  string
	configFile  string
	password    string
	showVersion bool
	testMode    bool
)

func init() {
	flag.StringVar(&listenAddr, "listen", "", "API listen addr (will override settings in config file")
	flag.StringVar(&configFile, "config", "~/.sqlit/config.yaml", "Configuration file for sqlit")
	flag.StringVar(&password, "password", "", "Master key password for sqlit")
	flag.BoolVar(&asymmetric.BypassSignature, "bypass-signature", false,
		"Disable signature sign and verify, for testing")
	flag.BoolVar(&testMode, "test-mode", false,
		"Enable test mode to bypass node ID validation, for testing")
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

	// Enable test mode if requested
	if testMode {
		kms.Unittest = true
		log.Info("Test mode enabled - bypassing node ID validation")
	}

	// init client
	var err error
	if err = client.Init(configFile, []byte(password)); err != nil {
		log.WithError(err).Error("init sqlit client failed")
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

	ctx, cancel := context.WithTimeout(context.Background(), time.Second*5)
	defer cancel()

	_ = server.Shutdown(ctx)
	afterShutdown()
	log.Info("stopped proxy")
}
