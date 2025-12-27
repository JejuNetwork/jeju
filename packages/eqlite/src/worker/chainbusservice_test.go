

package worker

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sync/atomic"
	"testing"
	"time"

	. "github.com/smartystreets/goconvey/convey"

	"eqlite/src/blockproducer/interfaces"
	"eqlite/src/conf"
	"eqlite/src/consistent"
	"eqlite/src/crypto"
	"eqlite/src/crypto/asymmetric"
	"eqlite/src/crypto/kms"
	"eqlite/src/proto"
	"eqlite/src/route"
	rpc "eqlite/src/rpc/mux"
	"eqlite/src/utils"
)

func TestNewBusService(t *testing.T) {
	Convey("Create a BusService with mock bp", t, func() {
		var (
			err     error
			cleanup func()
		)
		cleanup, _, err = initNodeChainBusService()
		So(err, ShouldBeNil)

		var (
			privKey           *asymmetric.PrivateKey
			pubKey            *asymmetric.PublicKey
			addr              proto.AccountAddress
			testCheckInterval = 30 * time.Second
			count             uint32
		)
		privKey, err = kms.GetLocalPrivateKey()
		So(err, ShouldBeNil)
		pubKey = privKey.PubKey()
		addr, err = crypto.PubKeyHash(pubKey)
		So(err, ShouldBeNil)
		ctx, cancelFunc := context.WithCancel(context.Background())
		defer cancelFunc()
		bs := NewBusService(ctx, addr, testCheckInterval)
		topic := fmt.Sprintf("/%s/", testOddBlocks.Transactions[0].GetTransactionType().String())
		err = bs.Subscribe(topic, func(tx interfaces.Transaction, c uint32) {
			atomic.AddUint32(&count, 1)
		})
		So(err, ShouldBeNil)
		bs.extractTxs(&testEventBlocks, 1)
		So(count, ShouldEqual, len(testEventBlocks.Transactions))

		bs.Start()

		time.Sleep(4 * time.Second)

		c := atomic.LoadUint32(&bs.blockCount)
		if c%2 == 0 {
			dbMap := bs.GetCurrentDBMapping()
			for _, profile := range testEventProfiles {
				// test RequestSQLProfile
				p, ok := bs.RequestSQLProfile(profile.ID)
				So(ok, ShouldBeTrue)
				So(p, ShouldResemble, profile)

				// test GetCurrentDBMapping
				p, ok = dbMap[profile.ID]
				So(ok, ShouldBeTrue)
				So(profile, ShouldResemble, p)

				// test RequestPermStat
				permStat, ok := bs.RequestPermStat(profile.ID, testAddr)
				So(ok, ShouldBeTrue)
				So(permStat.Status, ShouldEqual, profile.Users[0].Status)
				So(permStat.Permission, ShouldResemble, profile.Users[0].Permission)
				permStat, ok = bs.RequestPermStat(profile.ID, testNotExistAddr)
			}
			p, ok := bs.RequestSQLProfile(testNotExistID)
			So(ok, ShouldBeFalse)
			So(p, ShouldBeNil)
		} else {
			dbMap := bs.GetCurrentDBMapping()
			for _, profile := range testOddProfiles {
				p, ok := bs.RequestSQLProfile(profile.ID)
				So(ok, ShouldBeTrue)
				So(p, ShouldResemble, profile)

				// test GetCurrentDBMapping
				p, ok = dbMap[profile.ID]
				So(ok, ShouldBeTrue)
				So(profile, ShouldResemble, p)

				// test RequestPermStat
				permStat, ok := bs.RequestPermStat(profile.ID, testAddr)
				So(ok, ShouldBeTrue)
				So(permStat.Status, ShouldEqual, profile.Users[0].Status)
				So(permStat.Permission, ShouldResemble, profile.Users[0].Permission)
				permStat, ok = bs.RequestPermStat(profile.ID, testNotExistAddr)
			}
			p, ok := bs.RequestSQLProfile(testNotExistID)
			So(ok, ShouldBeFalse)
			So(p, ShouldBeNil)
		}

		b, err := bs.fetchBlockByCount(1)
		So(err, ShouldBeNil)
		So(len(b.Transactions), ShouldEqual, len(testOddBlocks.Transactions))
		b, err = bs.fetchBlockByCount(0)
		So(err, ShouldBeNil)
		So(len(b.Transactions), ShouldEqual, len(testEventBlocks.Transactions))
		b, err = bs.fetchBlockByCount(10000)
		So(err.Error(), ShouldEqual, ErrNotExists.Error())
		So(b, ShouldBeNil)

		bs.Stop()

		cleanup()
	})
}

func initNodeChainBusService() (cleanupFunc func(), server *rpc.Server, err error) {
	var d string
	if d, err = os.MkdirTemp("", "db_test_"); err != nil {
		return
	}

	// init conf
	_, testFile, _, _ := runtime.Caller(0)
	pubKeyStoreFile := filepath.Join(d, PubKeyStorePath)
	utils.RemoveAll(pubKeyStoreFile + "*")
	clientPubKeyStoreFile := filepath.Join(d, PubKeyStorePath+"_c")
	utils.RemoveAll(clientPubKeyStoreFile + "*")
	dupConfFile := filepath.Join(d, "config.yaml")
	confFile := filepath.Join(filepath.Dir(testFile), "../test/node_standalone/config.yaml")
	if err = utils.DupConf(confFile, dupConfFile); err != nil {
		return
	}
	privateKeyPath := filepath.Join(filepath.Dir(testFile), "../test/node_standalone/private.key")

	conf.GConf, _ = conf.LoadConfig(dupConfFile)
	// reset the once
	route.Once.Reset()
	route.InitKMS(clientPubKeyStoreFile)

	var dht *route.DHTService

	// init dht
	dht, err = route.NewDHTService(pubKeyStoreFile, new(consistent.KMSStorage), true)
	if err != nil {
		return
	}

	// init rpc
	if server, err = rpc.NewServerWithService(rpc.ServiceMap{route.DHTRPCName: dht}); err != nil {
		return
	}

	// register fake chain service
	s := &stubBPService{}
	s.Init()
	if err = server.RegisterService(route.BlockProducerRPCName, s); err != nil {
		return
	}

	// init private key
	masterKey := []byte("")
	if err = server.InitRPCServer(conf.GConf.ListenAddr, privateKeyPath, masterKey); err != nil {
		return
	}

	// start server
	go server.Serve()

	cleanupFunc = func() {
		os.RemoveAll(d)
		server.Listener.Close()
		server.Stop()
		// clear the connection pool
		rpc.GetSessionPoolInstance().Close()
	}

	return
}
