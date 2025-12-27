

package internal

import (
	"flag"

	"eqlite/src/client"
)

// CmdDrop is eqlite drop command entity.
var CmdDrop = &Command{
	UsageLine: "eqlite drop [common params] [-wait-tx-confirm] dsn",
	Short:     "drop a database by dsn or database id",
	Long: `
Drop drops a EQLite database by DSN or database ID.
e.g.
    eqlite drop eqlite://4119ef997dedc585bfbcfae00ab6b87b8486fab323a8e107ea1fd4fc4f7eba5c

Since EQLite is built on top of blockchains, you may want to wait for the transaction
confirmation before the drop operation takes effect.
e.g.
    eqlite drop -wait-tx-confirm eqlite://4119ef997dedc585bfbcfae00ab6b87b8486fab323a8e107ea1fd4fc4f7eba5c
`,
	Flag:       flag.NewFlagSet("Drop params", flag.ExitOnError),
	CommonFlag: flag.NewFlagSet("Common params", flag.ExitOnError),
	DebugFlag:  flag.NewFlagSet("Debug params", flag.ExitOnError),
}

func init() {
	CmdDrop.Run = runDrop

	addCommonFlags(CmdDrop)
	addConfigFlag(CmdDrop)
	addWaitFlag(CmdDrop)
}

func runDrop(cmd *Command, args []string) {
	commonFlagsInit(cmd)

	if len(args) != 1 {
		ConsoleLog.Error("drop command need EQLite dsn or database_id string as param")
		SetExitStatus(1)
		printCommandHelp(cmd)
		Exit()
	}

	configInit()

	dsn := args[0]

	// drop database
	if _, err := client.ParseDSN(dsn); err != nil {
		// not a dsn/dbid
		ConsoleLog.WithField("db", dsn).WithError(err).Error("not a valid dsn")
		SetExitStatus(1)
		return
	}

	txHash, err := client.Drop(dsn)
	if err != nil {
		// drop database failed
		ConsoleLog.WithField("db", dsn).WithError(err).Error("drop database failed")
		SetExitStatus(1)
		return
	}

	if waitTxConfirmation {
		err = wait(txHash)
		if err != nil {
			ConsoleLog.WithField("db", dsn).WithError(err).Error("drop database failed")
			SetExitStatus(1)
			return
		}
	}

	// drop database success
	ConsoleLog.Infof("drop database %#v success", dsn)
}
