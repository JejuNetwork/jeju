# Jeju EQLite (EQLite) Multi-Stage Build
#
# Builds EQLite from the internal packages/eqlite source code.
# Produces: eqlited, eqlite-minerd, eqlite (CLI), eqlite-adapter
#
# Build:
#   docker build -t jeju-eqlite:latest -f eqlite-internal.Dockerfile ../../eqlite
#
# Run:
#   docker run -e EQLITE_ROLE=miner jeju-eqlite:latest

ARG GO_VERSION=1.21

# ============================================================================
# Stage 1: Builder
# ============================================================================
FROM golang:${GO_VERSION}-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    make \
    gcc \
    libc6-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Copy go.mod and go.sum first for better caching
COPY go.mod go.sum ./
RUN go mod download

# Copy source
COPY . .

# Build all binaries
ENV CGO_ENABLED=1
ENV GOOS=linux

RUN make clean 2>/dev/null || true
RUN go build -ldflags="-s -w" -o bin/eqlited ./cmd/eqlited
RUN go build -ldflags="-s -w" -o bin/eqlite-minerd ./cmd/eqlite-minerd
RUN go build -ldflags="-s -w" -o bin/eqlite ./cmd/eqlite
RUN go build -ldflags="-s -w" -o bin/eqlite-adapter ./cmd/eqlite-proxy 2>/dev/null || echo "eqlite-adapter build optional"

# Create entrypoint script
RUN cat > bin/docker-entry.sh << 'EOF'
#!/bin/sh
set -e

# Determine which binary to run based on EQLITE_ROLE
case "${EQLITE_ROLE}" in
  blockproducer|bp)
    BINARY="eqlited"
    ;;
  miner)
    BINARY="eqlite-minerd"
    ;;
  adapter|proxy)
    BINARY="eqlite-adapter"
    if [ ! -f "/app/eqlite-adapter" ]; then
      BINARY="eqlite"
      EXTRA_ARGS="adapter"
    fi
    ;;
  *)
    echo "Unknown EQLITE_ROLE: ${EQLITE_ROLE}"
    echo "Valid roles: blockproducer, miner, adapter"
    exit 1
    ;;
esac

# Build config path
CONFIG_FILE="${EQLITE_CONF:-/config/config.yaml}"

echo "Starting EQLite ${EQLITE_ROLE} with config: ${CONFIG_FILE}"
exec /app/${BINARY} -config "${CONFIG_FILE}" ${EXTRA_ARGS} "$@"
EOF
RUN chmod +x bin/docker-entry.sh

# ============================================================================
# Stage 2: Runtime
# ============================================================================
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r eqlite && useradd -r -g eqlite eqlite

WORKDIR /app

# Copy binaries from builder
COPY --from=builder /build/bin/eqlited /app/
COPY --from=builder /build/bin/eqlite-minerd /app/
COPY --from=builder /build/bin/eqlite /app/
COPY --from=builder /build/bin/docker-entry.sh /app/

# Copy adapter if it was built
COPY --from=builder /build/bin/eqlite-adapter* /app/ 2>/dev/null || true

# Create directories
RUN mkdir -p /config /data /logs && \
    chown -R eqlite:eqlite /app /config /data /logs

# Default environment
ENV EQLITE_ROLE=miner
ENV EQLITE_CONF=/config/config.yaml

# Ports:
# 4661: Client connections
# 4662: Node-to-node RPC
# 4663: Kayak consensus
# 8546: HTTP API
EXPOSE 4661 4662 4663 8546

VOLUME ["/config", "/data", "/logs"]

USER eqlite

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget -q --spider http://localhost:8546/v1/status || exit 1

ENTRYPOINT ["/app/docker-entry.sh"]



