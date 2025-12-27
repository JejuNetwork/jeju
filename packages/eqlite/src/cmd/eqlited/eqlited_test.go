// +build !testbinary


package main

import (
	"context"
	"os"
	"syscall"
	"testing"
	"time"

	. "github.com/smartystreets/goconvey/convey"

	"eqlite/src/conf"
	"eqlite/src/crypto/kms"
	"eqlite/src/proto"
	"eqlite/src/route"
	rpc "eqlite/src/rpc/mux"
	"eqlite/test"
	"eqlite/src/types"
	"eqlite/src/utils"
)

func TestEQLiteD(t *testing.T) {
	if os.Getenv("EQLITE_INTEGRATION_TEST") != "1" {
		t.Skip("Skipping integration test: set EQLITE_INTEGRATION_TEST=1 to run")
	}
	Convey("Test eqlited 3BPs", t, func() {
		var (
			ctx1, ctx2 context.Context
			ccl1, ccl2 context.CancelFunc
			err        error
		)
		start3BPs()
		defer stopNodes()
		So(len(nodeCmds), ShouldEqual, 3)

		ctx1, ccl1 = context.WithTimeout(context.Background(), 30*time.Second)
		defer ccl1()

		err = utils.WaitToConnect(ctx1, "127.0.0.1", []int{2122, 2121, 2120}, 10*time.Second)
		So(err, ShouldBeNil)

		// Initialize local client
		conf.GConf, err = conf.LoadConfig(FJ(testWorkingDir, "./node_c/config.yaml"))
		So(err, ShouldBeNil)
		route.InitKMS(conf.GConf.PubKeyStoreFile)
		err = kms.InitLocalKeyPair(conf.GConf.PrivateKeyFile, []byte{})
		So(err, ShouldBeNil)

		// Wait BP chain service to be ready
		ctx2, ccl2 = context.WithTimeout(context.Background(), 30*time.Second)
		defer ccl2()
		err = test.WaitBPChainService(ctx2, 3*time.Second)
		So(err, ShouldBeNil)

		// Wait for block producing
		time.Sleep(15 * time.Second)

		// Kill one BP follower
		err = nodeCmds[2].Cmd.Process.Signal(syscall.SIGTERM)
		So(err, ShouldBeNil)
		time.Sleep(15 * time.Second)

		// set current bp to leader bp
		for _, n := range conf.GConf.KnownNodes {
			if n.Role == proto.Leader {
				rpc.SetCurrentBP(n.ID)
				break
			}
		}

		// The other peers should be waiting
		var (
			req  = &types.FetchLastIrreversibleBlockReq{}
			resp = &types.FetchLastIrreversibleBlockResp{}

			lastBlockCount uint32
		)
		err = rpc.RequestBP(route.MCCFetchLastIrreversibleBlock.String(), req, resp)
		So(err, ShouldBeNil)
		lastBlockCount = resp.Count
		time.Sleep(15 * time.Second)
		err = rpc.RequestBP(route.MCCFetchLastIrreversibleBlock.String(), req, resp)
		So(err, ShouldBeNil)
		So(resp.Count, ShouldEqual, lastBlockCount)
	})
}
