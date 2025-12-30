# Jeju SQLit Multi-Stage Build
#
# Builds SQLit from the internal packages/sqlit source code.
# Produces: sqlitd, sqlit-minerd, sqlit (CLI), sqlit-proxy
#
# Build:
#   docker compose -f sqlit-internal.compose.yaml build
#
# Run:
#   docker run -e SQLIT_ROLE=miner jeju-sqlit:latest

# ============================================================================
# Stage 1: Builder - Uses same setup as packages/sqlit/docker/builder.Dockerfile
# ============================================================================
FROM golang:1.23-alpine AS builder

# Install build dependencies (including ICU for sqlite_icu)
RUN apk add --no-cache \
    git \
    make \
    gcc \
    g++ \
    musl-dev \
    sqlite-dev \
    linux-headers \
    ca-certificates \
    icu-dev

# Set Go environment
ENV CGO_ENABLED=1
ENV GOOS=linux
ENV GO111MODULE=on

# Use same working directory as original sqlit Makefile expects
WORKDIR /go/src/sqlit

# Copy go.mod and go.sum first for better caching
COPY go.mod go.sum ./
RUN go mod download

# Copy all source code
COPY . .

# Build using the Makefile (same as `make build-release`)
RUN make clean 2>/dev/null || true && make -j$(nproc) build-release

# Create entrypoint script in builder stage
RUN cat > bin/docker-entry.sh << 'ENTRYEOF'
#!/bin/sh
set -e

# Determine which binary to run based on SQLIT_ROLE
case "${SQLIT_ROLE}" in
  blockproducer|bp)
    BINARY="sqlitd"
    ;;
  miner)
    BINARY="sqlit-minerd"
    ;;
  adapter|proxy)
    if [ -f "/app/sqlit-proxy" ]; then
      BINARY="sqlit-proxy"
    else
      BINARY="sqlit"
      EXTRA_ARGS="adapter"
    fi
    ;;
  explorer)
    BINARY="sqlit"
    EXTRA_ARGS="explorer"
    ;;
  mysql-adapter)
    BINARY="sqlit-mysql-adapter"
    ;;
  *)
    echo "Unknown SQLIT_ROLE: ${SQLIT_ROLE}"
    echo "Valid roles: blockproducer, miner, adapter, explorer, mysql-adapter"
    exit 1
    ;;
esac

# Build config path
CONFIG_FILE="${SQLIT_CONF:-/config/config.yaml}"

echo "Starting SQLit ${SQLIT_ROLE} with config: ${CONFIG_FILE}"
exec /app/${BINARY} -config "${CONFIG_FILE}" ${EXTRA_ARGS} "$@"
ENTRYEOF
RUN chmod +x bin/docker-entry.sh

# ============================================================================
# Stage 2: Runtime - Minimal Alpine image
# ============================================================================
FROM alpine:3.22

# Include ICU libs for dynamic linking and other runtime dependencies
RUN apk --no-cache add ca-certificates icu-libs musl libgcc libstdc++ sqlite-libs wget netcat-openbsd

WORKDIR /app

# Copy core binaries from builder (these are always built)
COPY --from=builder /go/src/sqlit/bin/sqlitd /app/
COPY --from=builder /go/src/sqlit/bin/sqlit-minerd /app/
COPY --from=builder /go/src/sqlit/bin/sqlit /app/
COPY --from=builder /go/src/sqlit/bin/sqlit-proxy /app/
COPY --from=builder /go/src/sqlit/bin/docker-entry.sh /app/

# Create directories
RUN mkdir -p /config /data /logs && chmod 755 /app/docker-entry.sh

# Default environment
ENV SQLIT_ROLE=miner
ENV SQLIT_CONF=/config/config.yaml

# Ports:
# 4661: Client connections / Adapter HTTP
# 4662: Node-to-node RPC
# 4663: Kayak consensus
# 8546: HTTP API / WebSocket
EXPOSE 4661 4662 4663 8546

VOLUME ["/config", "/data", "/logs"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget -q --spider http://localhost:8546/v1/status || exit 1

ENTRYPOINT ["/app/docker-entry.sh"]
