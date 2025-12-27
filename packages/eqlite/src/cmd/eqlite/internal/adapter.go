

package internal

import (
	"context"
	"flag"
	"time"

	"eqlite/src/sqlchain/adapter"
	"eqlite/src/utils"
)

var (
	adapterAddr          string // adapter listen addr
	adapterUseMirrorAddr string
)

// CmdAdapter is eqlite adapter command entity.
var CmdAdapter = &Command{
	UsageLine: "eqlite adapter [common params] [-tmp-path path] [-bg-log-level level] [-mirror addr] listen_address",
	Short:     "start a SQLChain adapter server",
	Long: `
Adapter serves a SQLChain adapter.
e.g.
    eqlite adapter 127.0.0.1:7784
`,
	Flag:       flag.NewFlagSet("Adapter params", flag.ExitOnError),
	CommonFlag: flag.NewFlagSet("Common params", flag.ExitOnError),
	DebugFlag:  flag.NewFlagSet("Debug params", flag.ExitOnError),
}

func init() {
	CmdAdapter.Run = runAdapter
	CmdAdapter.Flag.StringVar(&adapterUseMirrorAddr, "mirror", "", "Mirror server for adapter to query")

	addCommonFlags(CmdAdapter)
	addConfigFlag(CmdAdapter)
	addBgServerFlag(CmdAdapter)
}

func startAdapterServer(adapterAddr string, adapterUseMirrorAddr string) func() {
	adapterHTTPServer, err := adapter.NewHTTPAdapter(adapterAddr, configFile, adapterUseMirrorAddr)
	if err != nil {
		ConsoleLog.WithError(err).Error("init adapter failed")
		SetExitStatus(1)
		return nil
	}

	if err = adapterHTTPServer.Serve(); err != nil {
		ConsoleLog.WithError(err).Error("start adapter failed")
		SetExitStatus(1)
		return nil
	}

	ConsoleLog.Infof("adapter started on %s", adapterAddr)

	return func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second*5)
		defer cancel()
		adapterHTTPServer.Shutdown(ctx)
		ConsoleLog.Info("adapter stopped")
	}
}

func runAdapter(cmd *Command, args []string) {
	commonFlagsInit(cmd)

	if len(args) != 1 {
		ConsoleLog.Error("adapter command need listen address as param")
		SetExitStatus(1)
		printCommandHelp(cmd)
		Exit()
	}

	configInit()
	bgServerInit()

	adapterAddr = args[0]

	cancelFunc := startAdapterServer(adapterAddr, adapterUseMirrorAddr)
	ExitIfErrors()
	defer cancelFunc()

	ConsoleLog.Printf("Ctrl + C to stop adapter server on %s\n", adapterAddr)
	<-utils.WaitForExit()
}
