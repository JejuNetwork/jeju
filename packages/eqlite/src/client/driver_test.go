
package client

import (
	"context"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	. "github.com/smartystreets/goconvey/convey"

	"eqlite/src/crypto"
	"eqlite/src/crypto/asymmetric"
	"eqlite/src/crypto/kms"
	"eqlite/src/proto"
	"eqlite/src/route"
	"eqlite/src/types"
	"eqlite/src/utils"
	"eqlite/src/utils/log"
)

func TestInit(t *testing.T) {
	log.SetLevel(log.DebugLevel)
	// test init
	Convey("test init", t, func() {
		var stopTestService func()
		var confDir string
		var err error

		stopTestService, confDir, err = startTestService()
		log.Debugf("config dir: %s", confDir)
		So(err, ShouldBeNil)
		defer stopTestService()

		// already init ed
		err = Init(filepath.Join(confDir, "config.yaml"), []byte(""))
		So(err, ShouldNotBeNil)

		// fake driver not initialized
		atomic.StoreUint32(&driverInitialized, 0)
		err = Init(filepath.Join(confDir, "config.yaml"), []byte(""))
		So(err, ShouldBeNil)

		// test loaded block producer nodes
		bps := route.GetBPs()
		So(len(bps), ShouldBeGreaterThanOrEqualTo, 1)
		//So(bps[0].ToRawNodeID().ToNodeID(), ShouldResemble, (*conf.GConf.KnownNodes)[0].ID)

		stopPeersUpdater()
	})
}

func TestDefaultInit(t *testing.T) {
	log.SetLevel(log.DebugLevel)
	// test defaultInit
	Convey("test defaultInit", t, func() {
		var stopTestService func()
		var confDir string
		var err error

		// check and prepare ~/.eqlite
		homePath := utils.HomeDirExpand("~/.eqlite")
		if utils.Exist(homePath) {
			return
		}

		// no config err
		err = defaultInit()
		So(err, ShouldNotBeNil)

		err = os.Mkdir(homePath, 0755)
		So(err, ShouldBeNil)
		defer os.RemoveAll(homePath)

		stopTestService, confDir, err = startTestService()
		So(err, ShouldBeNil)
		defer stopTestService()

		// copy standalone conf
		confFile := filepath.Join(confDir, "config.yaml")
		privateKeyFile := filepath.Join(confDir, "private.key")
		homeConfig := filepath.Join(homePath, "config.yaml")
		homeKey := filepath.Join(homePath, "private.key")
		_, err = utils.CopyFile(confFile, homeConfig)
		So(err, ShouldBeNil)
		_, err = utils.CopyFile(privateKeyFile, homeKey)
		So(err, ShouldBeNil)

		// fake driver not initialized
		atomic.StoreUint32(&driverInitialized, 0)

		// no err
		err = defaultInit()
		So(err, ShouldBeNil)

		// clean
		stopPeersUpdater()
		atomic.StoreUint32(&driverInitialized, 0)
	})
}

func TestCreate(t *testing.T) {
	Convey("test create", t, func() {
		var stopTestService func()
		var err error
		var dsn string

		_, dsn, err = Create(ResourceMeta{})
		So(err, ShouldEqual, ErrNotInitialized)

		// fake driver initialized
		atomic.StoreUint32(&driverInitialized, 1)
		_, dsn, err = Create(ResourceMeta{})
		So(err, ShouldNotBeNil)
		// reset driver not initialized
		atomic.StoreUint32(&driverInitialized, 0)

		stopTestService, _, err = startTestService()
		So(err, ShouldBeNil)
		defer stopTestService()
		_, dsn, err = Create(ResourceMeta{})
		So(err, ShouldBeNil)
		dsnCfg, err := ParseDSN(dsn)
		So(err, ShouldBeNil)

		waitCtx, cancelWait := context.WithTimeout(context.Background(), time.Nanosecond)
		defer cancelWait()
		// should not use client.WaitDBCreation, sql.Open is not supported in this test case
		err = WaitBPDatabaseCreation(waitCtx, proto.DatabaseID(dsnCfg.DatabaseID), nil, 3*time.Second)
		So(err, ShouldResemble, context.DeadlineExceeded)

		// Calculate database ID
		var priv *asymmetric.PrivateKey
		priv, err = kms.GetLocalPrivateKey()
		So(err, ShouldBeNil)
		var addr proto.AccountAddress
		addr, err = crypto.PubKeyHash(priv.PubKey())
		So(err, ShouldBeNil)
		var dbID = string(proto.FromAccountAndNonce(addr, uint32(stubNextNonce)))

		recoveredCfg, err := ParseDSN(dsn)
		So(err, ShouldBeNil)
		So(recoveredCfg, ShouldResemble, &Config{
			DatabaseID: dbID,
			UseLeader:  true,
		})

		waitCtx2, cancelWait2 := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancelWait2()
		// should not use client.WaitDBCreation, sql.Open is not supported in this test case
		err = WaitBPDatabaseCreation(waitCtx2, proto.DatabaseID(dsnCfg.DatabaseID), nil, 3*time.Second)
		So(err, ShouldBeNil)
	})
}

func TestDrop(t *testing.T) {
	Convey("test drop", t, func() {
		var stopTestService func()
		var err error

		_, err = Drop("eqlite://db")
		So(err, ShouldEqual, ErrNotInitialized)

		stopTestService, _, err = startTestService()
		So(err, ShouldBeNil)
		defer stopTestService()
		_, err = Drop("eqlite://db")
		So(err, ShouldBeNil)

		_, err = Drop("invalid dsn")
		So(err, ShouldNotBeNil)
	})
}

func TestOpen(t *testing.T) {
	Convey("test Open", t, func() {
		var eqliteDriver eqliteDriver
		var err error

		// dsn invalid
		_, err = eqliteDriver.Open("invalid dsn")
		So(err, ShouldNotBeNil)

		if !utils.Exist(utils.HomeDirExpand(DefaultConfigFile)) {
			// not initialized(will run defaultInit once)
			_, err = eqliteDriver.Open("eqlite://db")
			log.Errorf("2nd time open %v", err)
			So(err, ShouldNotBeNil)
		}

		// reset driver not initialized
		atomic.StoreUint32(&driverInitialized, 0)
	})
}

// TestGetTokenBalance removed - token operations are now handled by EQLiteRegistry smart contract

func TestWaitDBCreation(t *testing.T) {
	Convey("test WaitDBCreation", t, func() {
		var stopTestService func()
		var err error
		var dsn string

		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		err = WaitDBCreation(ctx, "invalid dsn")
		So(err, ShouldNotBeNil)

		// use default init but failed
		err = WaitDBCreation(ctx, "eqlite://db")
		So(err, ShouldNotBeNil)

		stopTestService, _, err = startTestService()
		So(err, ShouldBeNil)
		defer stopTestService()
		defer stopPeersUpdater()

		err = WaitDBCreation(ctx, "eqlite://db")
		So(err, ShouldBeNil)

		_, dsn, err = Create(ResourceMeta{})
		So(err, ShouldBeNil)
		err = WaitDBCreation(ctx, dsn)
		So(err, ShouldNotBeNil)
	})
}

// TestTransferToken removed - token operations are now handled by EQLiteRegistry smart contract

func TestUpdatePermission(t *testing.T) {
	Convey("test UpdatePermission to a address", t, func() {
		var stopTestService func()
		var err error
		var user, chain proto.AccountAddress
		var perm types.UserPermission

		// driver not initialized
		_, err = UpdatePermission(user, chain, &perm)
		So(err, ShouldEqual, ErrNotInitialized)

		// fake driver initialized
		atomic.StoreUint32(&driverInitialized, 1)
		_, err = UpdatePermission(user, chain, &perm)
		So(err, ShouldNotBeNil)
		// reset driver not initialized
		atomic.StoreUint32(&driverInitialized, 0)

		stopTestService, _, err = startTestService()
		So(err, ShouldBeNil)
		defer stopTestService()

		// with mock bp, any params will be success
		_, err = UpdatePermission(user, chain, &perm)
		So(err, ShouldBeNil)
	})
}

func TestRunPeerListUpdater(t *testing.T) {
	Convey("test peersUpdaterRunning", t, func() {
		var stopTestService func()
		var err error

		err = runPeerListUpdater()
		So(err, ShouldNotBeNil)

		stopTestService, _, err = startTestService()
		So(err, ShouldBeNil)
		defer stopTestService()

		// normal case
		err = runPeerListUpdater()
		So(err, ShouldBeNil)

		// only one goroutine will be started
		err = runPeerListUpdater()
		So(err, ShouldBeNil)

		var priv *asymmetric.PrivateKey
		priv, err = kms.GetLocalPrivateKey()
		So(err, ShouldBeNil)
		dbID := proto.DatabaseID("db")

		_, err = getPeers(dbID, priv)
		So(err, ShouldBeNil)

		time.Sleep(1 * time.Second)
		stopPeersUpdater()
	})
}
