# CovenantSQL GCP Module

Deploys a CovenantSQL cluster on Google Cloud Platform using ARM64 (Tau T2A / Ampere Altra) instances by default for optimal cost efficiency.

## Features

- **ARM64 by default**: Uses Tau T2A instances (Ampere Altra) for ~40% cost savings
- **Managed Instance Group**: Auto-healing and rolling updates
- **Internal Load Balancer**: For client and HTTP API access
- **Cloud Logging/Monitoring**: Full observability integration

## Usage

```hcl
module "covenantsql" {
  source = "../../modules/covenantsql-gcp"

  project_id    = "my-gcp-project"
  environment   = "testnet"
  region        = "us-central1"
  zone          = "us-central1-a"
  
  network_name  = google_compute_network.main.name
  subnet_name   = google_compute_subnetwork.main.name
  
  node_count    = 3
  use_arm64     = true  # Default, uses t2a-standard-2
  
  # For ARM64, use a multi-arch image from your registry
  cql_image     = "gcr.io/my-project/covenantsql"
  cql_image_tag = "testnet-latest"
  
  allowed_source_ranges = ["10.0.0.0/8"]
  
  labels = {
    team = "platform"
  }
}
```

## ARM64 Image Requirement

When using ARM64 instances (`use_arm64 = true`), you must provide a container image that supports ARM64. Build the multi-arch image using:

```bash
cd packages/deployment
NETWORK=testnet bun run images:cql:push
```

Then push to GCR:

```bash
# Tag and push to GCR
docker tag jeju/covenantsql:testnet-latest gcr.io/YOUR_PROJECT/covenantsql:testnet-latest
docker push gcr.io/YOUR_PROJECT/covenantsql:testnet-latest
```

## Machine Types

| Variable | Default | Description |
|----------|---------|-------------|
| `machine_type_arm64` | `t2a-standard-2` | ARM64 Ampere Altra (2 vCPU, 8GB) |
| `machine_type_x86` | `e2-medium` | x86_64 fallback (2 vCPU, 4GB) |

## Ports

| Port | Purpose |
|------|---------|
| 4661 | Client connections |
| 4662 | Node-to-node communication |
| 4663 | Kayak consensus |
| 8546 | HTTP API |

## Outputs

| Output | Description |
|--------|-------------|
| `client_endpoint` | Internal IP:port for client connections |
| `http_endpoint` | HTTP API endpoint URL |
| `architecture` | CPU architecture (`arm64` or `x86_64`) |
| `machine_type` | Actual machine type used |
