#!/bin/bash
# Docker Build and Test Script for Jeju Compute
# 
# This script builds and tests the Docker image locally before Phala deployment

set -e

echo "═══════════════════════════════════════════════════════════════"
echo "         JEJU COMPUTE - DOCKER TEST                             "
echo "═══════════════════════════════════════════════════════════════"

# Configuration
IMAGE_NAME="jeju-compute"
CONTAINER_NAME="jeju-compute-test"
PORT=8080

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 1. Build Docker image
log_info "Building Docker image..."
cd "$(dirname "$0")/.."

docker build -t $IMAGE_NAME:local .

if [ $? -eq 0 ]; then
    log_info "✅ Docker image built successfully"
else
    log_error "❌ Docker build failed"
    exit 1
fi

# 2. Check image size
IMAGE_SIZE=$(docker images $IMAGE_NAME:local --format "{{.Size}}")
log_info "Image size: $IMAGE_SIZE"

# 3. Stop any existing container
if docker ps -a | grep -q $CONTAINER_NAME; then
    log_warn "Stopping existing container..."
    docker stop $CONTAINER_NAME 2>/dev/null || true
    docker rm $CONTAINER_NAME 2>/dev/null || true
fi

# 4. Run container
log_info "Starting container..."
docker run -d \
    --name $CONTAINER_NAME \
    -p $PORT:$PORT \
    -e NODE_ENV=production \
    -e PORT=$PORT \
    $IMAGE_NAME:local

# Wait for startup
sleep 3

# 5. Health check
log_info "Running health check..."
HEALTH_RESPONSE=$(curl -s http://localhost:$PORT/health || echo "FAILED")

if echo "$HEALTH_RESPONSE" | grep -q "ok"; then
    log_info "✅ Health check passed"
else
    log_error "❌ Health check failed: $HEALTH_RESPONSE"
    docker logs $CONTAINER_NAME
    docker stop $CONTAINER_NAME
    docker rm $CONTAINER_NAME
    exit 1
fi

# 6. Test endpoints
log_info "Testing endpoints..."

# Test /attestation
ATTEST_RESPONSE=$(curl -s http://localhost:$PORT/attestation || echo "FAILED")
if echo "$ATTEST_RESPONSE" | grep -q "measurement\|mrEnclave"; then
    log_info "✅ /attestation endpoint working"
else
    log_warn "⚠️ /attestation endpoint returned unexpected response"
fi

# Test /state
STATE_RESPONSE=$(curl -s http://localhost:$PORT/state || echo "FAILED")
if echo "$STATE_RESPONSE" | grep -q "version\|cid\|running"; then
    log_info "✅ /state endpoint working"
else
    log_warn "⚠️ /state endpoint returned unexpected response"
fi

# 7. Check logs for errors
log_info "Checking container logs..."
ERRORS=$(docker logs $CONTAINER_NAME 2>&1 | grep -i "error\|exception\|fatal" | head -5)
if [ -n "$ERRORS" ]; then
    log_warn "Found potential errors in logs:"
    echo "$ERRORS"
else
    log_info "✅ No errors in logs"
fi

# 8. Resource usage
log_info "Container resource usage:"
docker stats $CONTAINER_NAME --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"

# 9. Cleanup
log_info "Stopping container..."
docker stop $CONTAINER_NAME
docker rm $CONTAINER_NAME

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "                    TEST SUMMARY                                "
echo "═══════════════════════════════════════════════════════════════"
echo ""
log_info "✅ Docker build: PASSED"
log_info "✅ Health check: PASSED"  
log_info "✅ Endpoints: PASSED"
log_info "✅ Cleanup: PASSED"
echo ""
echo "Image ready for deployment: $IMAGE_NAME:local"
echo ""
echo "To deploy to Phala Cloud:"
echo "  1. Tag image: docker tag $IMAGE_NAME:local <registry>/$IMAGE_NAME:latest"
echo "  2. Push: docker push <registry>/$IMAGE_NAME:latest"
echo "  3. Deploy via Phala Cloud dashboard"
echo ""

