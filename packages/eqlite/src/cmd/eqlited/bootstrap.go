
package main

import (
	"fmt"
	"syscall"
	"time"

	"github.com/pkg/errors"
	"golang.org/x/term"

	"eqlite/src/api"
	bp "eqlite/src/blockproducer"
	"eqlite/src/conf"
	"eqlite/src/crypto/kms"
	"eqlite/src/proto"
	"eqlite/src/route"
	rpc "eqlite/src/rpc/mux"
	"eqlite/src/types"
	"eqlite/src/utils"
	"eqlite/src/utils/log"
)

const (
	dhtGossipTimeout = time.Second * 20
)

func runNode(nodeID proto.NodeID, listenAddr string) (err error) {
	genesis, err := loadGenesis()
	if err != nil {
		return
	}

	var masterKey []byte
	if !conf.GConf.UseTestMasterKey {
		// read master key
		fmt.Print("Type in Master key to continue: ")
		masterKey, err = term.ReadPassword(int(syscall.Stdin))
		if err != nil {
			fmt.Printf("Failed to read Master Key: %v", err)
		}
		fmt.Println("")
	}

	err = kms.InitLocalKeyPair(conf.GConf.PrivateKeyFile, masterKey)
	if err != nil {
		log.WithError(err).Error("init local key pair failed")
		return
	}

	// init nodes
	log.WithField("node", nodeID).Info("init peers")
	_, peers, thisNode, err := initNodePeers(nodeID, conf.GConf.PubKeyStoreFile)
	if err != nil {
		log.WithError(err).Error("init nodes and peers failed")
		return
	}

	mode := bp.BPMode
	if wsapiAddr != "" {
		mode = bp.APINodeMode
	}

	if mode == bp.APINodeMode {
		if err = rpc.RegisterNodeToBP(30 * time.Second); err != nil {
			log.WithError(err).Fatal("register node to BP")
			return
		}
	}

	var server *rpc.Server

	// create server
	log.WithField("addr", listenAddr).Info("create server")
	if server, err = createServer(
		conf.GConf.PrivateKeyFile, conf.GConf.PubKeyStoreFile, masterKey, listenAddr); err != nil {
		log.WithError(err).Error("create server failed")
		return
	}

	// start server
	go func() {
		server.Serve()
	}()
	defer func() {
		server.Listener.Close()
		server.Stop()
	}()

	if mode == bp.BPMode {
		// init storage
		log.Info("init storage")
		var st *LocalStorage
		if st, err = initStorage(conf.GConf.DHTFileName); err != nil {
			log.WithError(err).Error("init storage failed")
			return err
		}

		// init dht node server
		log.Info("init consistent runtime")
		kvServer := NewKVServer(thisNode.ID, peers, st, dhtGossipTimeout)
		dht, err := route.NewDHTService(conf.GConf.DHTFileName, kvServer, true)
		if err != nil {
			log.WithError(err).Error("init consistent hash failed")
			return err
		}
		defer kvServer.Stop()

		// set consistent handler to local storage
		kvServer.storage.consistent = dht.Consistent

		// register gossip service rpc
		gossipService := NewGossipService(kvServer)
		log.Info("register dht gossip service rpc")
		err = server.RegisterService(route.DHTGossipRPCName, gossipService)
		if err != nil {
			log.WithError(err).Error("register dht gossip service failed")
			return err
		}

		// register dht service rpc
		log.Info("register dht service rpc")
		err = server.RegisterService(route.DHTRPCName, dht)
		if err != nil {
			log.WithError(err).Error("register dht service failed")
			return err
		}
	}

	// init main chain service
	log.Info("register main chain service rpc")
	chainConfig := &bp.Config{
		Mode:           mode,
		Genesis:        genesis,
		DataFile:       conf.GConf.BP.ChainFileName,
		Server:         server,
		Peers:          peers,
		NodeID:         nodeID,
		Period:         conf.GConf.BPPeriod,
		Tick:           conf.GConf.BPTick,
		BlockCacheSize: 1000,
	}
	chain, err := bp.NewChain(chainConfig)
	if err != nil {
		log.WithError(err).Error("init chain failed")
		return err
	}
	chain.Start()
	defer chain.Stop()

	log.Info(conf.StartSucceedMessage)

	// start json-rpc server
	if mode == bp.APINodeMode {
		log.Info("wsapi: start service")
		go func() {
			if err := api.Serve(wsapiAddr, conf.GConf.BP.ChainFileName); err != nil {
				log.WithError(err).Error("wsapi: start service")
			}
		}()
	}

	<-utils.WaitForExit()
	return
}

func createServer(privateKeyPath, pubKeyStorePath string, masterKey []byte, listenAddr string) (server *rpc.Server, err error) {
	server = rpc.NewServer()

	if err = server.InitRPCServer(listenAddr, privateKeyPath, masterKey); err != nil {
		err = errors.Wrap(err, "init rpc server failed")
	}

	return
}

func loadGenesis() (genesis *types.BPBlock, err error) {
	genesisInfo := conf.GConf.BP.BPGenesis
	log.WithField("config", genesisInfo).Info("load genesis config")

	genesis = &types.BPBlock{
		SignedHeader: types.BPSignedHeader{
			BPHeader: types.BPHeader{
				Version:   genesisInfo.Version,
				Timestamp: genesisInfo.Timestamp,
			},
		},
	}

	// Note: Token balances are now managed by the EQLiteRegistry smart contract.
	// Genesis block only contains account addresses, not balances.
	for _, ba := range genesisInfo.BaseAccounts {
		log.WithFields(log.Fields{
			"address": ba.Address.String(),
		}).Debug("setting one account fixture in genesis block")
		genesis.Transactions = append(genesis.Transactions, types.NewBaseAccount(
			&types.Account{
				Address: proto.AccountAddress(ba.Address),
			}))
	}

	// Rewrite genesis merkle and block hash
	if err = genesis.SetHash(); err != nil {
		return
	}
	return
}
