
package main

import (
	"expvar"
	"fmt"
	"syscall"
	"time"

	"golang.org/x/term"

	"eqlite/src/conf"
	"eqlite/src/crypto/kms"
	"eqlite/src/route"
	"eqlite/src/rpc"
	"eqlite/src/rpc/mux"
	"eqlite/src/utils"
	"eqlite/src/utils/log"
)

const (
	mwMinerAddr         = "service:miner:addr"
	mwMinerExternalAddr = "service:miner:addr:external"
	mwMinerNodeID       = "service:miner:node"
	mwMinerWallet       = "service:miner:wallet"
	mwMinerDiskRoot     = "service:miner:disk:root"
)

func initNode() (server *mux.Server, direct *rpc.Server, err error) {
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

	if err = kms.InitLocalKeyPair(conf.GConf.PrivateKeyFile, masterKey); err != nil {
		log.WithError(err).Error("init local key pair failed")
		return
	}

	log.Info("init routes")

	// init kms routing
	route.InitKMS(conf.GConf.PubKeyStoreFile)

	err = mux.RegisterNodeToBP(30 * time.Second)
	if err != nil {
		log.Fatalf("register node to BP failed: %v", err)
	}

	// init server
	utils.RemoveAll(conf.GConf.PubKeyStoreFile + "*")
	if server, err = createServer(
		conf.GConf.PrivateKeyFile, masterKey, conf.GConf.ListenAddr); err != nil {
		log.WithError(err).Error("create server failed")
		return
	}
	if direct, err = createDirectServer(
		conf.GConf.PrivateKeyFile, masterKey, conf.GConf.ListenDirectAddr); err != nil {
		log.WithError(err).Error("create direct server failed")
		return
	}

	return
}

func createServer(privateKeyPath string, masterKey []byte, listenAddr string) (server *mux.Server, err error) {
	server = mux.NewServer()
	err = server.InitRPCServer(listenAddr, privateKeyPath, masterKey)
	return
}

func createDirectServer(privateKeyPath string, masterKey []byte, listenAddr string) (server *rpc.Server, err error) {
	if listenAddr == "" {
		return nil, nil
	}
	server = rpc.NewServer()
	err = server.InitRPCServer(listenAddr, privateKeyPath, masterKey)
	return
}

func initMetrics() {
	if conf.GConf != nil {
		expvar.NewString(mwMinerAddr).Set(conf.GConf.ListenAddr)
		expvar.NewString(mwMinerExternalAddr).Set(conf.GConf.ExternalListenAddr)
		expvar.NewString(mwMinerNodeID).Set(string(conf.GConf.ThisNodeID))
		expvar.NewString(mwMinerWallet).Set(conf.GConf.WalletAddress)

		if conf.GConf.Miner != nil {
			expvar.NewString(mwMinerDiskRoot).Set(conf.GConf.Miner.RootDir)
		}
	}
}
