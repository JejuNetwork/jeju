
// Package testnet contains the paraemters of the EQLite TestNet.
package testnet

import (
	yaml "gopkg.in/yaml.v2"

	"eqlite/src/conf"
	"eqlite/src/utils/log"
)

const (
	// EQLiteConfigYAML is the config string in YAML format of the EQLite TestNet.
	EQLiteConfigYAML = `
SQLChainPeriod: 60s
DNSSeed:
  Domain: "testnet.gridb.io"
  BPCount: 6
`
	// EQLiteMinerYAML is the config string in YAML format of the EQLite TestNet for miner.
	EQLiteMinerYAML = `
BillingBlockCount: 60
BPPeriod: 10s
BPTick: 3s
SQLChainTick: 10s
SQLChainTTL: 10
ChainBusPeriod: 10s
MinProviderDeposit: 1000000
Miner:
  RootDir: './data'
  MaxReqTimeGap: '5m'
  ProvideServiceInterval: '10s'
`
)

// GetTestNetConfig parses and returns the EQLite TestNet config.
func GetTestNetConfig() (config *conf.Config) {
	var err error
	config = &conf.Config{}
	if err = yaml.Unmarshal([]byte(EQLiteConfigYAML), config); err != nil {
		log.WithError(err).Fatal("failed to unmarshal testnet config")
	}
	return
}

// SetMinerConfig set testnet common config for miner.
func SetMinerConfig(config *conf.Config) {
	if config == nil {
		return
	}
	var err error
	if err = yaml.Unmarshal([]byte(EQLiteMinerYAML), config); err != nil {
		log.WithError(err).Fatal("failed to unmarshal testnet miner config")
	}
}
