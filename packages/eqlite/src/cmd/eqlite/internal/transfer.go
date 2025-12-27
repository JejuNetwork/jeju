

package internal

import (
	"flag"
	"fmt"
)

// CmdTransfer is eqlite transfer command entity.
var CmdTransfer = &Command{
	UsageLine: "eqlite transfer",
	Short:     "transfer tokens (deprecated - use EQLiteRegistry contract)",
	Long: `
DEPRECATED: Token transfers are now handled by the EQLiteRegistry smart contract on Ethereum.

To transfer JEJU tokens, please use the Jeju Network's web interface or interact
directly with the EQLiteRegistry contract on Ethereum.

For staking and database provisioning, see the EQLiteRegistry contract documentation.
`,
	Flag:       flag.NewFlagSet("Transfer params", flag.ExitOnError),
	CommonFlag: flag.NewFlagSet("Common params", flag.ExitOnError),
	DebugFlag:  flag.NewFlagSet("Debug params", flag.ExitOnError),
}

func init() {
	CmdTransfer.Run = runTransfer

	addCommonFlags(CmdTransfer)
}

func runTransfer(cmd *Command, args []string) {
	commonFlagsInit(cmd)

	fmt.Println("DEPRECATED: Token transfers are now handled by the EQLiteRegistry smart contract.")
	fmt.Println("")
	fmt.Println("To transfer JEJU tokens or manage staking, please use:")
	fmt.Println("  - Jeju Network web interface")
	fmt.Println("  - Direct interaction with the EQLiteRegistry contract on Ethereum")
	fmt.Println("")
	fmt.Println("For more information, see the EQLiteRegistry contract documentation.")

	SetExitStatus(1)
}
