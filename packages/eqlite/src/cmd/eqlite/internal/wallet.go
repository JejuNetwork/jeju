

package internal

import (
	"flag"
	"fmt"
	"strings"

	"eqlite/src/client"
	"eqlite/src/conf"
	"eqlite/src/crypto"
	"eqlite/src/crypto/asymmetric"
	"eqlite/src/crypto/kms"
	"eqlite/src/proto"
	"eqlite/src/route"
	"eqlite/src/rpc/mux"
	"eqlite/src/types"
)

var (
	databaseID string
)

// CmdWallet is eqlite wallet command entity.
var CmdWallet = &Command{
	UsageLine: "eqlite wallet [common params] [-dsn dsn]",
	Short:     "get the wallet address and database info of current account",
	Long: `
Wallet gets the EQLite wallet address and database information of the current account.
Note: Token balances are now managed by the EQLiteRegistry smart contract on Ethereum.
e.g.
    eqlite wallet

    eqlite wallet -dsn "eqlite://4119ef997dedc585bfbcfae00ab6b87b8486fab323a8e107ea1fd4fc4f7eba5c"
`,
	Flag:       flag.NewFlagSet("Wallet params", flag.ExitOnError),
	CommonFlag: flag.NewFlagSet("Common params", flag.ExitOnError),
	DebugFlag:  flag.NewFlagSet("Debug params", flag.ExitOnError),
}

func init() {
	CmdWallet.Run = runWallet

	addCommonFlags(CmdWallet)
	addConfigFlag(CmdWallet)

	CmdWallet.Flag.StringVar(&databaseID, "dsn", "", "Show specified database info")
}

func showDatabaseInfo(dsn string) {
	dsnCfg, err := client.ParseDSN(dsn)
	if err != nil {
		ConsoleLog.WithError(err).Error("parse database dsn failed")
		SetExitStatus(1)
		return
	}

	var (
		req    = new(types.QuerySQLChainProfileReq)
		resp   = new(types.QuerySQLChainProfileResp)
		pubKey *asymmetric.PublicKey
		addr   proto.AccountAddress
	)

	req.DBID = proto.DatabaseID(dsnCfg.DatabaseID)

	if err = mux.RequestBP(route.MCCQuerySQLChainProfile.String(), req, resp); err != nil {
		ConsoleLog.WithError(err).Error("query database chain profile failed")
		SetExitStatus(1)
		return
	}

	if pubKey, err = kms.GetLocalPublicKey(); err != nil {
		ConsoleLog.WithError(err).Error("query database chain profile failed")
		SetExitStatus(1)
		return
	}

	if addr, err = crypto.PubKeyHash(pubKey); err != nil {
		ConsoleLog.WithError(err).Error("query database chain profile failed")
		SetExitStatus(1)
		return
	}

	for _, user := range resp.Profile.Users {
		if user.Address == addr && user.Permission != nil && user.Permission.Role != types.Void {
			fmt.Printf("Database ID: %s\n", req.DBID)
			fmt.Printf("Owner: %s\n", resp.Profile.Owner)
			fmt.Printf("Your permission: %s\n", user.Permission.Role.String())
			fmt.Printf("Status: %v\n", user.Status)
			fmt.Println("\nNote: Token balances and staking are managed by the EQLiteRegistry smart contract.")
			return
		}
	}

	ConsoleLog.Error("no permission to the database")
	SetExitStatus(1)
}

func showAllDatabaseInfo() {
	var (
		req    = new(types.QueryAccountSQLChainProfilesReq)
		resp   = new(types.QueryAccountSQLChainProfilesResp)
		pubKey *asymmetric.PublicKey
		err    error
	)

	if pubKey, err = kms.GetLocalPublicKey(); err != nil {
		ConsoleLog.WithError(err).Error("query database chain profile failed")
		SetExitStatus(1)
		return
	}

	if req.Addr, err = crypto.PubKeyHash(pubKey); err != nil {
		ConsoleLog.WithError(err).Error("query database chain profile failed")
		SetExitStatus(1)
		return
	}

	if err = mux.RequestBP(route.MCCQueryAccountSQLChainProfiles.String(), req, resp); err != nil {
		if strings.Contains(err.Error(), "can't find method") {
			// old version block producer
			ConsoleLog.WithError(err).Warning("query account database profiles is not supported in old version block producer")
			return
		}

		ConsoleLog.WithError(err).Error("query account database profiles failed")
		SetExitStatus(1)
		return
	}

	if len(resp.Profiles) == 0 {
		fmt.Println("Found no related databases.")
		return
	}

	fmt.Printf("Your Databases:\n\n")
	fmt.Printf("%-64s\tPermission\tStatus\n", "DatabaseID")

	for _, p := range resp.Profiles {
		for _, user := range p.Users {
			if user.Address == req.Addr && user.Permission != nil && user.Permission.Role != types.Void {
				fmt.Printf("%s\t%s\t%d\n",
					p.ID, user.Permission.Role.String(), user.Status)
			}
		}
	}

	fmt.Println("\nNote: Token balances and staking are managed by the EQLiteRegistry smart contract.")
}

func runWallet(cmd *Command, args []string) {
	commonFlagsInit(cmd)
	configInit()

	fmt.Printf("\n\nWallet address: %s\n", conf.GConf.WalletAddress)
	fmt.Println("\nNote: Token balances are managed by the EQLiteRegistry smart contract on Ethereum.")
	fmt.Println("Use the Jeju Network explorer or contract interface to check your token balance.")

	if databaseID != "" {
		showDatabaseInfo(databaseID)
	} else {
		showAllDatabaseInfo()
	}
}
