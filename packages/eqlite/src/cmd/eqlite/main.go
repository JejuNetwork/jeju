

package main

import (
	"flag"
	"fmt"
	"os"

	"eqlite/src/cmd/eqlite/internal"
)

var (
	version = "unknown"
)

func init() {
	internal.EqliteCommands = []*internal.Command{
		internal.CmdGenerate,
		internal.CmdWallet,
		internal.CmdCreate,
		internal.CmdConsole,
		internal.CmdDrop,
		internal.CmdGrant,
		internal.CmdMirror,
		internal.CmdExplorer,
		internal.CmdAdapter,
		internal.CmdIDMiner,
		internal.CmdRPC,
		internal.CmdVersion,
		internal.CmdHelp,
	}
}

func main() {
	internal.Version = version

	flag.Usage = internal.MainUsage
	flag.Parse()

	args := flag.Args()
	if len(args) < 1 {
		internal.MainUsage()
	}

	if args[0] != "version" && args[0] != "help" {
		internal.PrintVersion(true)
	}

	for _, cmd := range internal.EqliteCommands {
		if cmd.Name() != args[0] {
			continue
		}
		if !cmd.Runnable() {
			continue
		}
		var allFlags flag.FlagSet
		allFlags.Usage = func() { cmd.Usage() }
		cmd.Flag.VisitAll(func(flag *flag.Flag) {
			allFlags.Var(flag.Value, flag.Name, flag.Usage)
		})
		cmd.CommonFlag.VisitAll(func(flag *flag.Flag) {
			allFlags.Var(flag.Value, flag.Name, flag.Usage)
		})
		cmd.DebugFlag.VisitAll(func(flag *flag.Flag) {
			allFlags.Var(flag.Value, flag.Name, flag.Usage)
		})
		allFlags.Parse(args[1:])
		args = allFlags.Args()
		cmd.Run(cmd, args)
		internal.Exit()
		return
	}
	fmt.Fprintf(os.Stderr, "eqlite %s: unknown command\nRun 'eqlite help' for usage.\n", args[0])
	internal.SetExitStatus(2)
	internal.Exit()
}
