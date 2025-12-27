

package internal

import (
	"flag"
	"net/http"

	"eqlite/src/sqlchain/observer"
	"eqlite/src/utils"
)

var (
	explorerAddr string // Explorer addr

	explorerService    *observer.Service
	explorerHTTPServer *http.Server
)

// CmdExplorer is eqlite explorer command.
var CmdExplorer = &Command{
	UsageLine: "eqlite explorer [common params] [-tmp-path path] [-bg-log-level level] listen_address",
	Short:     "start a SQLChain explorer server",
	Long: `
Explorer serves a SQLChain web explorer.
e.g.
    eqlite explorer 127.0.0.1:8546
`,
	Flag:       flag.NewFlagSet("Explorer params", flag.ExitOnError),
	CommonFlag: flag.NewFlagSet("Common params", flag.ExitOnError),
	DebugFlag:  flag.NewFlagSet("Debug params", flag.ExitOnError),
}

func init() {
	CmdExplorer.Run = runExplorer

	addCommonFlags(CmdExplorer)
	addConfigFlag(CmdExplorer)
	addBgServerFlag(CmdExplorer)
}

func startExplorerServer(explorerAddr string) func() {
	var err error
	explorerService, explorerHTTPServer, err = observer.StartObserver(explorerAddr, Version)
	if err != nil {
		ConsoleLog.WithError(err).Error("start explorer failed")
		SetExitStatus(1)
		return nil
	}

	ConsoleLog.Infof("explorer server started on %s", explorerAddr)

	return func() {
		_ = observer.StopObserver(explorerService, explorerHTTPServer)
		ConsoleLog.Info("explorer stopped")
	}
}

func runExplorer(cmd *Command, args []string) {
	commonFlagsInit(cmd)

	if len(args) != 1 {
		ConsoleLog.Error("explorer command need listen address as param")
		SetExitStatus(1)
		printCommandHelp(cmd)
		Exit()
	}

	configInit()
	bgServerInit()

	if len(args) != 1 {
		ConsoleLog.Error("explorer command need listen address as param")
		SetExitStatus(1)
		return
	}
	explorerAddr = args[0]

	cancelFunc := startExplorerServer(explorerAddr)
	ExitIfErrors()
	defer cancelFunc()

	ConsoleLog.Printf("Ctrl + C to stop explorer server on %s\n", explorerAddr)
	<-utils.WaitForExit()
}
