package jeju

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"eqlite/src/conf"
	"eqlite/src/crypto/asymmetric"
	"eqlite/src/crypto/hash"
	"eqlite/src/crypto/kms"
	"eqlite/src/proto"
)

// Network represents a Jeju network environment.
type Network string

const (
	// Localnet is for local development.
	Localnet Network = "localnet"
	// Testnet is for testing.
	Testnet Network = "testnet"
	// Mainnet is for production.
	Mainnet Network = "mainnet"
)

// JejuConfig holds Jeju-specific configuration.
type JejuConfig struct {
	// Network is the Jeju network to connect to.
	Network Network `json:"network"`

	// NodeRole is the role of this node (block_producer or miner).
	NodeRole string `json:"nodeRole"`

	// TEE configuration
	TEE TEEConfig `json:"tee"`

	// Staking configuration
	Staking StakingConfig `json:"staking"`

	// L2 RPC endpoint for on-chain operations.
	L2RPCEndpoint string `json:"l2RpcEndpoint"`

	// EQLite Registry contract address.
	RegistryAddress string `json:"registryAddress"`
}

// TEEConfig holds TEE-related configuration.
type TEEConfig struct {
	// Enabled indicates if TEE is required.
	Enabled bool `json:"enabled"`

	// Platform is the TEE platform (intel_tdx, amd_sev, simulator).
	Platform string `json:"platform"`

	// AttestationEndpoint is the TEE attestation service endpoint.
	AttestationEndpoint string `json:"attestationEndpoint,omitempty"`
}

// StakingConfig holds staking-related configuration.
type StakingConfig struct {
	// StakeAmount is the amount staked for this node (in wei).
	StakeAmount string `json:"stakeAmount"`

	// OperatorAddress is the Ethereum address of the operator.
	OperatorAddress string `json:"operatorAddress"`

	// PrivateKeyPath is the path to the operator's private key.
	PrivateKeyPath string `json:"privateKeyPath,omitempty"`
}

// NetworkEndpoints holds endpoint configuration for each network.
type NetworkEndpoints struct {
	BlockProducerEndpoint string `json:"blockProducerEndpoint"`
	MinerEndpoint         string `json:"minerEndpoint"`
	RegistryAddress       string `json:"registryAddress"`
	L2RPCEndpoint         string `json:"l2RpcEndpoint"`
}

// DefaultEndpoints returns the default endpoints for each network.
var DefaultEndpoints = map[Network]NetworkEndpoints{
	Localnet: {
		BlockProducerEndpoint: "http://localhost:4661",
		MinerEndpoint:         "http://localhost:4661",
		RegistryAddress:       "0x0000000000000000000000000000000000000000",
		L2RPCEndpoint:         "http://localhost:9545",
	},
	Testnet: {
		BlockProducerEndpoint: "https://eqlite-bp.testnet.jejunetwork.org",
		MinerEndpoint:         "https://eqlite-miner.testnet.jejunetwork.org",
		RegistryAddress:       "", // To be deployed
		L2RPCEndpoint:         "https://rpc.testnet.jejunetwork.org",
	},
	Mainnet: {
		BlockProducerEndpoint: "https://eqlite-bp.jejunetwork.org",
		MinerEndpoint:         "https://eqlite-miner.jejunetwork.org",
		RegistryAddress:       "", // To be deployed
		L2RPCEndpoint:         "https://rpc.jejunetwork.org",
	},
}

// LoadJejuConfig loads Jeju configuration from a file or environment.
func LoadJejuConfig(configPath string) (*JejuConfig, error) {
	// Try to load from file
	if configPath != "" {
		data, err := os.ReadFile(configPath)
		if err != nil {
			return nil, fmt.Errorf("failed to read config file: %w", err)
		}

		var cfg JejuConfig
		if err := json.Unmarshal(data, &cfg); err != nil {
			return nil, fmt.Errorf("failed to parse config: %w", err)
		}

		return &cfg, nil
	}

	// Load from environment
	network := Network(os.Getenv("JEJU_NETWORK"))
	if network == "" {
		network = Localnet
	}

	nodeRole := os.Getenv("EQLITE_NODE_ROLE")
	if nodeRole == "" {
		nodeRole = "miner"
	}

	endpoints := DefaultEndpoints[network]

	return &JejuConfig{
		Network:         network,
		NodeRole:        nodeRole,
		L2RPCEndpoint:   getEnvOrDefault("JEJU_L2_RPC_ENDPOINT", endpoints.L2RPCEndpoint),
		RegistryAddress: getEnvOrDefault("EQLITE_REGISTRY_ADDRESS", endpoints.RegistryAddress),
		TEE: TEEConfig{
			Enabled:             os.Getenv("TEE_ENABLED") == "true",
			Platform:            getEnvOrDefault("TEE_PLATFORM", "simulator"),
			AttestationEndpoint: os.Getenv("TEE_ATTESTATION_ENDPOINT"),
		},
		Staking: StakingConfig{
			StakeAmount:     getEnvOrDefault("EQLITE_STAKE_AMOUNT", "10000000000000000000000"), // 10k tokens
			OperatorAddress: os.Getenv("EQLITE_OPERATOR_ADDRESS"),
			PrivateKeyPath:  os.Getenv("EQLITE_OPERATOR_KEY_PATH"),
		},
	}, nil
}

// ToEQLiteConfig converts Jeju config to EQLite config.
func (j *JejuConfig) ToEQLiteConfig(workingDir string) (*conf.Config, error) {
	endpoints := DefaultEndpoints[j.Network]

	// Generate a node ID based on operator address
	nodeID := generateNodeID(j.Staking.OperatorAddress)

	config := &conf.Config{
		WorkingRoot:        workingDir,
		PrivateKeyFile:     filepath.Join(workingDir, "private.key"),
		PubKeyStoreFile:    filepath.Join(workingDir, "public.keystore"),
		DHTFileName:        filepath.Join(workingDir, "dht.db"),
		ListenAddr:         "0.0.0.0:4661",
		ThisNodeID:         nodeID,
		StartupSyncHoles:   true,
		BPPeriod:           10 * time.Second,
		BPTick:             1 * time.Second,
		SQLChainPeriod:     2 * time.Second,
		SQLChainTick:       500 * time.Millisecond,
		SQLChainTTL:        10,
		MinProviderDeposit: 0, // Handled by Jeju contracts
	}

	// Configure based on role
	if j.NodeRole == "block_producer" {
		config.BP = &conf.BPInfo{
			ChainFileName: filepath.Join(workingDir, "chain.db"),
			BPGenesis: conf.BPGenesisInfo{
				Version:   2,
				Timestamp: time.Now().UTC(),
			},
		}
	} else {
		config.Miner = &conf.MinerInfo{
			RootDir:                filepath.Join(workingDir, "data"),
			MaxReqTimeGap:          5 * time.Minute,
			ProvideServiceInterval: 10 * time.Second,
			DiskUsageInterval:      1 * time.Minute,
		}
	}

	// Add known nodes from network config
	config.KnownNodes = []proto.Node{
		{
			ID:   nodeID,
			Addr: endpoints.BlockProducerEndpoint,
		},
	}

	return config, nil
}

// GetEndpoints returns the endpoints for this configuration's network.
func (j *JejuConfig) GetEndpoints() NetworkEndpoints {
	return DefaultEndpoints[j.Network]
}

// IsProduction returns true if this is a production network.
func (j *JejuConfig) IsProduction() bool {
	return j.Network == Mainnet
}

// RequiresTEE returns true if TEE is required for this network.
func (j *JejuConfig) RequiresTEE() bool {
	// TEE is required for testnet and mainnet
	return j.Network == Testnet || j.Network == Mainnet
}

func generateNodeID(operatorAddress string) proto.NodeID {
	// Generate a deterministic node ID from operator address
	if operatorAddress == "" {
		operatorAddress = "0x0000000000000000000000000000000000000000"
	}

	h := hash.THashH([]byte(operatorAddress))
	return proto.NodeID(h.String())
}

func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// GenerateKeyPair generates a new key pair for a EQLite node.
func GenerateKeyPair(outputDir string) (*asymmetric.PrivateKey, error) {
	priv, _, err := asymmetric.GenSecp256k1KeyPair()
	if err != nil {
		return nil, fmt.Errorf("failed to generate key pair: %w", err)
	}

	// Ensure output directory exists
	if err := os.MkdirAll(outputDir, 0700); err != nil {
		return nil, fmt.Errorf("failed to create output directory: %w", err)
	}

	// Save private key (using empty master key for unencrypted storage)
	privPath := filepath.Join(outputDir, "private.key")
	if err := kms.SavePrivateKey(privPath, priv, nil); err != nil {
		return nil, fmt.Errorf("failed to save private key: %w", err)
	}

	return priv, nil
}

