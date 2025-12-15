#!/bin/sh
# IPFS Node Initialization Script for Jeju

set -e

# Initialize IPFS if not already initialized
if [ ! -f /data/ipfs/config ]; then
    ipfs init --profile=server
fi

# Configure IPFS for local development
ipfs config Addresses.API "/ip4/0.0.0.0/tcp/5001"
ipfs config Addresses.Gateway "/ip4/0.0.0.0/tcp/8080"

# Enable CORS for API
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Origin '["*"]'
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Methods '["GET", "POST", "PUT", "DELETE"]'
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Headers '["Authorization", "X-Requested-With", "Range", "Content-Range"]'
ipfs config --json API.HTTPHeaders.Access-Control-Expose-Headers '["Location", "Ipfs-Hash"]'
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Credentials '["true"]'

# Enable gateway writable (for local dev)
ipfs config --json Gateway.Writable true

# Configure garbage collection
ipfs config --json Datastore.StorageMax '"10GB"'
ipfs config --json Datastore.GCPeriod '"1h"'

# Configure swarm for local network
ipfs config --json Swarm.DisableNatPortMap true
ipfs config --json Swarm.EnableRelayHop false

# Enable pubsub for real-time features
ipfs config --json Pubsub.Enabled true
ipfs config --json Pubsub.Router '"gossipsub"'

echo "IPFS node configured for Jeju development"
