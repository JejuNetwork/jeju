
package client

import (
	"database/sql"
	"os"
	"path/filepath"
	"runtime"
	"sync/atomic"

	pi "eqlite/src/blockproducer/interfaces"
	"eqlite/src/conf"
	"eqlite/src/consistent"
	"eqlite/src/crypto"
	"eqlite/src/crypto/asymmetric"
	"eqlite/src/crypto/hash"
	"eqlite/src/crypto/kms"
	"eqlite/src/proto"
	"eqlite/src/route"
	rpc "eqlite/src/rpc/mux"
	"eqlite/src/types"
	"eqlite/src/utils"
	"eqlite/src/utils/log"
	"eqlite/src/worker"
)

const (
	// PubKeyStorePath defines public cache store.
	PubKeyStorePath = "./public.keystore"
)

var (
	rootHash                      = hash.Hash{}
	stubNextNonce pi.AccountNonce = 1
)

// fake BPDB service.
type stubBPService struct{}

func (s *stubBPService) QueryAccountTokenBalance(req *types.QueryAccountTokenBalanceReq,
	resp *types.QueryAccountTokenBalanceResp) (err error) {
	resp.OK = req.TokenType.Listed()
	return
}

func (s *stubBPService) QuerySQLChainProfile(req *types.QuerySQLChainProfileReq,
	resp *types.QuerySQLChainProfileResp) (err error) {
	var nodeID proto.NodeID
	if nodeID, err = kms.GetLocalNodeID(); err != nil {
		return
	}
	resp.Profile = types.SQLChainProfile{
		Miners: []*types.MinerInfo{
			{
				NodeID: nodeID,
			},
		},
	}
	return
}

func (s *stubBPService) NextAccountNonce(_ *types.NextAccountNonceReq,
	resp *types.NextAccountNonceResp) (err error) {
	resp.Nonce = stubNextNonce
	return
}

func (s *stubBPService) AddTx(req *types.AddTxReq, resp *types.AddTxResp) (err error) {
	return
}

func (s *stubBPService) QueryTxState(
	req *types.QueryTxStateReq, resp *types.QueryTxStateResp) (err error,
) {
	resp.State = pi.TransactionStateConfirmed
	return
}

func startTestService() (stopTestService func(), tempDir string, err error) {
	var server *rpc.Server
	var cleanup func()
	if cleanup, tempDir, server, err = initNode(); err != nil {
		return
	}

	var rootDir string
	if rootDir, err = os.MkdirTemp("", "dbms_test_"); err != nil {
		return
	}

	cfg := &worker.DBMSConfig{
		RootDir:       rootDir,
		Server:        server,
		MaxReqTimeGap: worker.DefaultMaxReqTimeGap,
	}

	var dbms *worker.DBMS
	if dbms, err = worker.NewDBMS(cfg); err != nil {
		return
	}

	stopTestService = func() {
		if dbms != nil {
			dbms.Shutdown()
		}

		cleanup()

		// cleanup session pool
		rpc.GetSessionPoolInstance().Close()
	}

	// init
	if err = dbms.Init(); err != nil {
		return
	}

	// add database
	var req *types.UpdateService
	var res types.UpdateServiceResponse
	var peers *proto.Peers
	var block *types.Block

	dbID := proto.DatabaseID("db")

	// create sqlchain block
	block, err = types.CreateRandomBlock(rootHash, true)

	// get database peers
	if peers, err = genPeers(1); err != nil {
		return
	}

	// build create database request
	req = new(types.UpdateService)
	req.Header.Op = types.CreateDB
	req.Header.Instance = types.ServiceInstance{
		DatabaseID: dbID,
		Peers:      peers,
		ResourceMeta: types.ResourceMeta{
			IsolationLevel: int(sql.LevelReadUncommitted),
		},
		GenesisBlock: block,
	}
	if req.Header.Signee, err = kms.GetLocalPublicKey(); err != nil {
		return
	}
	var privateKey *asymmetric.PrivateKey
	if privateKey, err = kms.GetLocalPrivateKey(); err != nil {
		return
	}
	if err = req.Sign(privateKey); err != nil {
		return
	}

	// send create database request
	if err = testRequest(route.DBSDeploy, req, &res); err != nil {
		return
	}

	// update private key permission in dbms for query
	addr, err := crypto.PubKeyHash(privateKey.PubKey())
	if err != nil {
		return
	}
	permStat := &types.PermStat{
		Permission: types.UserPermissionFromRole(types.Admin),
		Status:     types.Normal,
	}
	err = dbms.UpdatePermission(dbID, proto.AccountAddress(addr), permStat)
	if err != nil {
		return
	}

	return
}

func initNode() (cleanupFunc func(), tempDir string, server *rpc.Server, err error) {
	if tempDir, err = os.MkdirTemp("", "db_test_"); err != nil {
		return
	}
	log.WithField("d", tempDir).Debug("created temp dir")

	// init conf
	_, testFile, _, _ := runtime.Caller(0)
	pubKeyStoreFile := filepath.Join(tempDir, PubKeyStorePath+"_dht")
	utils.RemoveAll(pubKeyStoreFile + "*")
	clientPubKeyStoreFile := filepath.Join(tempDir, PubKeyStorePath+"_c")
	utils.RemoveAll(clientPubKeyStoreFile + "*")
	dupConfFile := filepath.Join(tempDir, "config.yaml")
	confFile := filepath.Join(filepath.Dir(testFile), "../test/node_standalone/config.yaml")
	if err = utils.DupConf(confFile, dupConfFile); err != nil {
		return
	}
	privateKeyPath := filepath.Join(filepath.Dir(testFile), "../test/node_standalone/private.key")
	conf.GConf, _ = conf.LoadConfig(dupConfFile)
	log.Debugf("GConf: %#v", conf.GConf)
	_, err = utils.CopyFile(privateKeyPath, conf.GConf.PrivateKeyFile)
	if err != nil {
		log.WithFields(log.Fields{
			"from": privateKeyPath,
			"to":   conf.GConf.PrivateKeyFile,
		}).WithError(err).Fatal("copy private key failed")
		return
	}
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
	if err = server.RegisterService(route.BlockProducerRPCName, &stubBPService{}); err != nil {
		return
	}

	// init private key
	masterKey := []byte("")
	if err = server.InitRPCServer(conf.GConf.ListenAddr, privateKeyPath, masterKey); err != nil {
		return
	}

	// start server
	go server.Serve()

	// fake database init already processed
	atomic.StoreUint32(&driverInitialized, 1)

	cleanupFunc = func() {
		os.RemoveAll(tempDir)
		server.Listener.Close()
		server.Stop()
		// restore database init state
		atomic.StoreUint32(&driverInitialized, 0)
		kms.ResetLocalKeyStore()
	}
	return
}

func testRequest(method route.RemoteFunc, req interface{}, response interface{}) (err error) {
	// get node id
	var nodeID proto.NodeID
	if nodeID, err = kms.GetLocalNodeID(); err != nil {
		return
	}

	return rpc.NewCaller().CallNode(nodeID, method.String(), req, response)
}

func getKeys() (privKey *asymmetric.PrivateKey, pubKey *asymmetric.PublicKey, err error) {
	// get public key
	if pubKey, err = kms.GetLocalPublicKey(); err != nil {
		return
	}

	// get private key
	if privKey, err = kms.GetLocalPrivateKey(); err != nil {
		return
	}

	return
}

func genPeers(term uint64) (peers *proto.Peers, err error) {
	// get node id
	var nodeID proto.NodeID
	if nodeID, err = kms.GetLocalNodeID(); err != nil {
		return
	}

	// get private/public key
	var privateKey *asymmetric.PrivateKey

	if privateKey, _, err = getKeys(); err != nil {
		return
	}

	// generate peers and sign
	peers = &proto.Peers{
		PeersHeader: proto.PeersHeader{
			Term:    term,
			Leader:  nodeID,
			Servers: []proto.NodeID{nodeID},
		},
	}
	err = peers.Sign(privateKey)
	return
}
