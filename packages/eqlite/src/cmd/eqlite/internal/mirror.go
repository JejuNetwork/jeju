
package internal

import (
	"flag"

	"eqlite/src/client"
	"eqlite/src/sqlchain/mirror"
	"eqlite/src/utils"
)

var (
	mirrorDatabase string // mirror database id
	mirrorAddr     string // mirror server rpc addr

	mirrorService *mirror.Service
)

// CmdMirror is eqlite mirror command.
var CmdMirror = &Command{
	UsageLine: "eqlite mirror [common params] [-tmp-path path] [-bg-log-level level] dsn listen_address",
	Short:     "start a SQLChain database mirror server",
	Long: `
Mirror subscribes database updates and serves a read-only database mirror.
e.g.
    eqlite mirror dsn 127.0.0.1:9389
`,
	Flag:       flag.NewFlagSet("Mirror params", flag.ExitOnError),
	CommonFlag: flag.NewFlagSet("Common params", flag.ExitOnError),
	DebugFlag:  flag.NewFlagSet("Debug params", flag.ExitOnError),
}

func init() {
	CmdMirror.Run = runMirror

	addCommonFlags(CmdMirror)
	addConfigFlag(CmdMirror)
	addBgServerFlag(CmdMirror)
}

func startMirrorServer(mirrorDatabase string, mirrorAddr string) func() {
	var err error
	mirrorService, err = mirror.StartMirror(mirrorDatabase, mirrorAddr)
	if err != nil {
		ConsoleLog.WithError(err).Error("start mirror failed")
		SetExitStatus(1)
		return nil
	}

	ConsoleLog.Infof("mirror server started on %s", mirrorAddr)
	// TODO(): print sample command for eqlite to connect

	return func() {
		mirror.StopMirror(mirrorService)
		ConsoleLog.Info("mirror stopped")
	}
}

func runMirror(cmd *Command, args []string) {
	commonFlagsInit(cmd)

	if len(args) != 2 {
		ConsoleLog.Error("missing args, run `eqlite help mirror` for help")
		SetExitStatus(1)
		printCommandHelp(cmd)
		Exit()
	}

	configInit()
	bgServerInit()

	dsn := args[0]
	mirrorAddr = args[1]

	cfg, err := client.ParseDSN(dsn)
	if err != nil {
		// not a dsn/dbid
		ConsoleLog.WithField("db", dsn).WithError(err).Error("not a valid dsn")
		SetExitStatus(1)
		return
	}

	mirrorDatabase = cfg.DatabaseID

	cancelFunc := startMirrorServer(mirrorDatabase, mirrorAddr)
	ExitIfErrors()
	defer cancelFunc()

	ConsoleLog.Printf("Ctrl + C to stop mirror server on %s\n", mirrorAddr)
	<-utils.WaitForExit()
}
