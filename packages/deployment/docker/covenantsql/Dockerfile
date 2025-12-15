# CovenantSQL Multi-Architecture Build
# Builds for both amd64 and arm64 architectures
#
# Build locally (single platform):
#   docker buildx build --platform linux/arm64 -t covenantsql:latest --load .
#
# Build multi-arch and push:
#   docker buildx build --platform linux/amd64,linux/arm64 -t $ECR_REPO:latest --push .

ARG GO_VERSION=1.21

# Build stage - use Debian for glibc compatibility (required for sqlite3)
FROM golang:${GO_VERSION}-bookworm AS builder

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    make \
    gcc \
    libc6-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Clone CovenantSQL source
ARG CQL_VERSION=v0.8.1
RUN git clone --depth 1 --branch ${CQL_VERSION} https://github.com/CovenantSQL/CovenantSQL.git . || \
    git clone --depth 1 https://github.com/CovenantSQL/CovenantSQL.git .

# Download Go modules first (separate layer for better caching)
# Use multiple proxies for reliability
ENV GOPROXY=https://proxy.golang.org,https://goproxy.io,direct
ENV GOFLAGS="-mod=mod"
RUN go mod download || (sleep 5 && go mod download) || (sleep 10 && go mod download)

# Build output directory
RUN mkdir -p /out

# Build with CGO enabled (required for secp256k1 and sqlite3)
# Build each binary separately for better cache utilization
RUN CGO_ENABLED=1 go build -ldflags="-s -w" -o /out/cql ./cmd/cql
RUN CGO_ENABLED=1 go build -ldflags="-s -w" -o /out/cqld ./cmd/cqld
RUN CGO_ENABLED=1 go build -ldflags="-s -w" -o /out/cql-minerd ./cmd/cql-minerd || \
    (sleep 5 && CGO_ENABLED=1 go build -ldflags="-s -w" -o /out/cql-minerd ./cmd/cql-minerd)
RUN CGO_ENABLED=1 go build -ldflags="-s -w" -o /out/cql-fuse ./cmd/cql-fuse 2>/dev/null || echo "cql-fuse build skipped"

# Runtime stage - use slim Debian for smaller image with glibc
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r cql && useradd -r -g cql cql

# Copy binaries
COPY --from=builder /out/cql /usr/local/bin/
COPY --from=builder /out/cqld /usr/local/bin/
COPY --from=builder /out/cql-minerd /usr/local/bin/

# Create directories
RUN mkdir -p /config /data /logs && \
    chown -R cql:cql /config /data /logs

# Expose ports
# 4661: Client connections
# 4662: Node-to-node communication
# 4663: Kayak consensus
# 8546: HTTP API
# 9100: Metrics
EXPOSE 4661 4662 4663 8546 9100

# Volume mounts
VOLUME ["/config", "/data", "/logs"]

USER cql

WORKDIR /data

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -sf http://localhost:8546/v1/health || exit 1

ENTRYPOINT ["cqld"]
CMD ["-config", "/config/config.yaml"]
