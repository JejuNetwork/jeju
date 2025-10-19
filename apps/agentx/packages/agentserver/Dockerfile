# First stage - build stagehand server
FROM node:20-slim AS stagehand-builder

# Install build dependencies only (Playwright will be installed at runtime)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /stagehand

# Copy stagehand server source
COPY packages/plugin-stagehand/stagehand-server/package*.json ./
RUN npm ci

COPY packages/plugin-stagehand/stagehand-server/ ./
RUN npm run build

# Try to build the binary, but don't fail if it doesn't work
# Note: Playwright will be installed at runtime if needed
RUN npm run build:sea || echo "Binary build failed, will use Node.js fallback"

# Final stage - debian-based production image
FROM debian:12-slim

# Install runtime dependencies including Node.js for stagehand fallback
RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    dumb-init \
    postgresql-client \
    procps \
    xvfb \
    x11vnc \
    ffmpeg \
    xterm \
    fluxbox \
    tmux \
    htop \
    x11-utils \
    x11-xserver-utils \
    net-tools \
    chromium \
    chromium-driver \
    fonts-liberation \
    libappindicator3-1 \
    nodejs \
    npm \
    # Additional dependencies
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libxkbcommon0 \
    libatspi2.0-0 \
    libgdk-pixbuf2.0-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    xdg-utils \
    # ONNX Runtime dependencies
    wget \
    libgomp1 \
    # Sharp dependencies
    libvips42 \
    libvips-dev \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -g 1001 eliza \
    && useradd -u 1001 -g eliza -m eliza

# Download and install ONNX Runtime based on target architecture
RUN ARCH=$(uname -m) && \
    echo "Installing ONNX Runtime for architecture: $ARCH" && \
    if [ "$ARCH" = "aarch64" ]; then \
        echo "Installing ONNX Runtime for ARM64..." && \
        wget -q https://github.com/microsoft/onnxruntime/releases/download/v1.14.0/onnxruntime-linux-aarch64-1.14.0.tgz && \
        tar -xzf onnxruntime-linux-aarch64-1.14.0.tgz && \
        cp -v onnxruntime-linux-aarch64-1.14.0/lib/*.so* /usr/local/lib/ && \
        rm -rf onnxruntime-linux-aarch64-1.14.0*; \
    elif [ "$ARCH" = "x86_64" ]; then \
        echo "Installing ONNX Runtime for x86_64..." && \
        wget -q https://github.com/microsoft/onnxruntime/releases/download/v1.14.0/onnxruntime-linux-x64-1.14.0.tgz && \
        tar -xzf onnxruntime-linux-x64-1.14.0.tgz && \
        cp -v onnxruntime-linux-x64-1.14.0/lib/*.so* /usr/local/lib/ && \
        rm -rf onnxruntime-linux-x64-1.14.0*; \
    else \
        echo "Unsupported architecture: $ARCH"; \
        exit 1; \
    fi && \
    echo "ONNX Runtime libraries installed:" && \
    ls -la /usr/local/lib/libonnx* 2>/dev/null || echo "No ONNX libraries found yet" && \
    ldconfig

# Set working directory
WORKDIR /app

# Add cache busting argument
ARG CACHE_BUST=1
ARG TARGETARCH=arm64
RUN echo "Target architecture: ${TARGETARCH}"
RUN echo "Cache bust: ${CACHE_BUST}"

# Copy the prebuilt binary for the correct architecture
# Using a more explicit approach to ensure proper path resolution
COPY packages/agentserver/dist-binaries/server-linux-arm64 ./server-arm64
COPY packages/agentserver/dist-binaries/server-linux-amd64 ./server-amd64
RUN if [ "${TARGETARCH}" = "arm64" ]; then mv ./server-arm64 ./server && rm -f ./server-amd64; else mv ./server-amd64 ./server && rm -f ./server-arm64; fi

# Copy scripts and configuration
COPY packages/agentserver/scripts/health-check.sh ./health-check.sh
COPY packages/agentserver/vnc-autostart.sh ./vnc-autostart.sh
COPY packages/agentserver/verify-display.sh ./verify-display.sh
COPY packages/agentserver/stagehand-wrapper.sh ./stagehand-wrapper.sh
RUN chmod +x ./server ./health-check.sh ./vnc-autostart.sh ./verify-display.sh ./stagehand-wrapper.sh && \
    chown eliza:eliza ./server ./health-check.sh ./vnc-autostart.sh ./verify-display.sh ./stagehand-wrapper.sh

# Create directories with correct permissions
RUN mkdir -p /app/data /app/logs /app/knowledge /home/eliza/.vnc && \
    chown -R eliza:eliza /app /home/eliza

# Copy the docker startup script
COPY --chown=eliza:eliza packages/agentserver/docker-startup.sh ./docker-startup.sh
RUN chmod +x ./docker-startup.sh

# Copy public folder for web UI
COPY --chown=eliza:eliza packages/agentserver/public ./public

# Install sharp module for ARM64 architecture
# This is needed because the compiled binary doesn't include native modules
RUN mkdir -p /app/node_modules && \
    cd /app && \
    npm init -y --scope=@elizaos && \
    npm install sharp@0.34.3 --platform=linux --arch=arm64 --no-save && \
    # Create a symlink so the binary can find node_modules
    ln -sf /app/node_modules /node_modules && \
    chown -R eliza:eliza /app/node_modules

# Copy stagehand server from builder stage
# First create directories
RUN mkdir -p /app/stagehand-server/dist /usr/local/bin

# Copy the built JavaScript files
COPY --from=stagehand-builder --chown=eliza:eliza /stagehand/dist /app/stagehand-server/dist/
COPY --from=stagehand-builder --chown=eliza:eliza /stagehand/package*.json /app/stagehand-server/

# Copy node_modules for the stagehand server
COPY --from=stagehand-builder --chown=eliza:eliza /stagehand/node_modules /app/stagehand-server/node_modules/

# Create downloads directory for Stagehand with proper permissions
RUN mkdir -p /app/stagehand-server/downloads && chown -R eliza:eliza /app/stagehand-server

# Ensure node_modules has write permissions for Stagehand to create directories at runtime
RUN chmod -R 755 /app/stagehand-server/node_modules

# Create downloads directory where Stagehand expects it
RUN mkdir -p /app/stagehand-server/node_modules/@browserbasehq/stagehand/downloads && \
    chown -R eliza:eliza /app/stagehand-server/node_modules/@browserbasehq

# Playwright browsers will be installed at runtime if needed
# COPY --from=stagehand-builder --chown=eliza:eliza /root/.cache/ms-playwright /home/eliza/.cache/ms-playwright

# Try to copy the binary if it was built successfully
# We use a script approach since COPY doesn't support || operator
RUN --mount=type=bind,from=stagehand-builder,source=/stagehand,target=/tmp/stagehand \
    if [ -f /tmp/stagehand/binaries/stagehand-server-linux ]; then \
        cp /tmp/stagehand/binaries/stagehand-server-linux /usr/local/bin/stagehand-server-linux && \
        chown eliza:eliza /usr/local/bin/stagehand-server-linux; \
    else \
        echo "No binary found, using Node.js fallback"; \
    fi

# Make binary executable if it exists
RUN if [ -f /usr/local/bin/stagehand-server-linux ]; then \
        chmod +x /usr/local/bin/stagehand-server-linux && \
        ln -sf /usr/local/bin/stagehand-server-linux /usr/local/bin/stagehand-server-orig; \
    else \
        echo "#!/bin/bash" > /usr/local/bin/stagehand-server-orig && \
        echo "cd /app/stagehand-server && node dist/index.js" >> /usr/local/bin/stagehand-server-orig && \
        chmod +x /usr/local/bin/stagehand-server-orig; \
    fi

# Set up our wrapper script as the main stagehand-server
RUN ln -sf /app/stagehand-wrapper.sh /usr/local/bin/stagehand-server && \
    chmod +x /usr/local/bin/stagehand-server

# Create the virtual display startup script
RUN echo '#!/bin/bash\n\
echo "[DISPLAY] Checking if X virtual framebuffer is already running..."\n\
if pgrep Xvfb > /dev/null; then\n\
    echo "[DISPLAY] Xvfb is already running (PID: $(pgrep Xvfb))"\n\
else\n\
    echo "[DISPLAY] Starting X virtual framebuffer..."\n\
    Xvfb :99 -screen 0 1280x720x24 -nolisten tcp &\n\
    sleep 3\n\
fi\n\
\n\
export DISPLAY=:99\n\
\n\
if pgrep fluxbox > /dev/null; then\n\
    echo "[DISPLAY] Window manager is already running (PID: $(pgrep fluxbox))"\n\
else\n\
    echo "[DISPLAY] Starting window manager..."\n\
    fluxbox &\n\
    sleep 2\n\
fi\n\
\n\
if pgrep x11vnc > /dev/null; then\n\
    echo "[DISPLAY] VNC server is already running (PID: $(pgrep x11vnc))"\n\
else\n\
    echo "[DISPLAY] Starting VNC server on port 5900..."\n\
    x11vnc -display :99 -nopw -listen 0.0.0.0 -xkb -ncache 10 -forever -shared &\n\
    echo "[DISPLAY] VNC server started, accessible on port 5900"\n\
fi\n\
\n\
echo "[DISPLAY] Display services ready, starting main process..."\n\
exec "$@"' > /app/start-with-display.sh && \
    chmod +x /app/start-with-display.sh && \
    chown eliza:eliza /app/start-with-display.sh

# Create necessary directories with proper ownership (as root)
RUN mkdir -p /app/downloads && chown -R eliza:eliza /app/downloads

# Switch to eliza user
USER eliza

# Set environment variables
ENV NODE_ENV=production \
    PORT=7777 \
    LOG_LEVEL=info \
    DOCKER_CONTAINER=true \
    POSTGRES_URL="postgresql://eliza:eliza_secure_pass@eliza-postgres:5432/eliza" \
    DATABASE_URL="postgresql://eliza:eliza_secure_pass@eliza-postgres:5432/eliza" \
    OLLAMA_BASE_URL="http://eliza-ollama:11434" \
    OLLAMA_API_ENDPOINT="http://eliza-ollama:11434/api" \
    KNOWLEDGE_PATH="/app/knowledge" \
    RESET_DB=false \
    DISPLAY=:99 \
    XVFB_SCREEN_SIZE=1280x720x24 \
    STAGEHAND_SERVER_PORT=8080 \
    BROWSER_HEADLESS=true \
    PLAYWRIGHT_BROWSERS_PATH=/home/eliza/.cache/ms-playwright \
    LD_LIBRARY_PATH=/usr/local/lib:$LD_LIBRARY_PATH \
    NODE_PATH=/app/node_modules \
    STAGEHAND_DOWNLOADS_PATH=/app/downloads \
    BUN_INSTALL_CACHE_DIR=/home/eliza/.bun/cache

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD ["./health-check.sh"]

# Expose ports
EXPOSE 7777 5900

# Use dumb-init with virtual display wrapper
ENTRYPOINT ["dumb-init", "--", "/app/start-with-display.sh"]
CMD ["./docker-startup.sh"]