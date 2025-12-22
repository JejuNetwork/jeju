/**
 * Action Resolver - Maps GitHub Actions to Jeju equivalents
 */

import type { Action } from './types';

interface ActionMapping {
  jejuAction: string;
  inputMapping?: Record<string, string>;
  outputMapping?: Record<string, string>;
}

const ACTION_MAPPINGS: Record<string, ActionMapping> = {
  'actions/checkout': { jejuAction: 'jeju/checkout' },
  'actions/setup-node': { jejuAction: 'jeju/setup-node', inputMapping: { 'node-version': 'version' } },
  'actions/setup-python': { jejuAction: 'jeju/setup-python', inputMapping: { 'python-version': 'version' } },
  'actions/setup-go': { jejuAction: 'jeju/setup-go', inputMapping: { 'go-version': 'version' } },
  'actions/cache': { jejuAction: 'jeju/cache' },
  'actions/upload-artifact': { jejuAction: 'jeju/artifact-upload' },
  'actions/download-artifact': { jejuAction: 'jeju/artifact-download' },
  'docker/setup-buildx-action': { jejuAction: 'jeju/setup-buildx' },
  'docker/login-action': { jejuAction: 'jeju/docker-login' },
  'docker/build-push-action': { jejuAction: 'jeju/docker-build' },
};

export function resolveAction(uses: string): { action: Action; isNative: boolean } | null {
  const [actionRef, _version] = uses.split('@');
  const mapping = ACTION_MAPPINGS[actionRef];

  if (mapping) {
    const nativeAction = NATIVE_ACTIONS[mapping.jejuAction];
    if (nativeAction) {
      return { action: nativeAction, isNative: true };
    }
  }

  return null;
}

export function parseActionRef(uses: string): { owner: string; repo: string; path?: string; ref: string } {
  const [actionPath, ref] = uses.split('@');
  const parts = actionPath.split('/');

  if (parts.length === 2) {
    return { owner: parts[0], repo: parts[1], ref: ref || 'main' };
  }

  return { owner: parts[0], repo: parts[1], path: parts.slice(2).join('/'), ref: ref || 'main' };
}

export const NATIVE_ACTIONS: Record<string, Action> = {
  'jeju/checkout': {
    name: 'Checkout',
    description: 'Checkout a repository from Jeju Git',
    inputs: {
      ref: { description: 'Branch/tag/commit to checkout' },
      path: { description: 'Relative path under workspace' },
      repository: { description: 'Repository to checkout (owner/repo)' },
      'fetch-depth': { description: 'Number of commits to fetch. 0 = all history', default: '1' },
    },
    runs: {
      using: 'composite',
      steps: [
        {
          stepId: 'checkout',
          name: 'Checkout repository',
          run: `
set -e
REPO_URL="\${JEJU_GIT_URL:-http://localhost:4030/git}/\${{ github.repository }}"
REF="\${{ inputs.ref || github.sha }}"
DEPTH="\${{ inputs.fetch-depth || '1' }}"
PATH_DIR="\${{ inputs.path || '.' }}"

if [ "$DEPTH" = "0" ]; then
  git clone "$REPO_URL" "$PATH_DIR"
else
  git clone --depth "$DEPTH" "$REPO_URL" "$PATH_DIR"
fi
cd "$PATH_DIR"
git checkout "$REF" 2>/dev/null || git checkout -b "$REF" "origin/$REF"
echo "Checked out $REF"
`,
        },
      ],
    },
  },

  'jeju/setup-node': {
    name: 'Setup Node.js',
    description: 'Set up Node.js environment',
    inputs: {
      version: { description: 'Node.js version', default: '20' },
      'registry-url': { description: 'NPM registry URL' },
      cache: { description: 'Package manager to cache (npm, yarn, pnpm)' },
    },
    runs: {
      using: 'composite',
      steps: [
        {
          stepId: 'setup',
          name: 'Install Node.js',
          run: `
set -e
VERSION="\${{ inputs.version }}"
if command -v node &> /dev/null; then
  CURRENT=$(node -v | tr -d 'v')
  if [[ "$CURRENT" == "$VERSION"* ]]; then
    echo "Node.js $CURRENT already installed"
    exit 0
  fi
fi

curl -fsSL https://deb.nodesource.com/setup_$VERSION.x | bash -
apt-get install -y nodejs || apk add --no-cache nodejs npm

if [ -n "\${{ inputs.registry-url }}" ]; then
  npm config set registry "\${{ inputs.registry-url }}"
fi
echo "node-version=$(node -v)" >> $GITHUB_OUTPUT
`,
        },
      ],
    },
  },

  'jeju/setup-bun': {
    name: 'Setup Bun',
    description: 'Set up Bun runtime',
    inputs: {
      version: { description: 'Bun version', default: 'latest' },
    },
    runs: {
      using: 'composite',
      steps: [
        {
          stepId: 'setup',
          name: 'Install Bun',
          run: `
set -e
VERSION="\${{ inputs.version }}"
if command -v bun &> /dev/null && [ "$VERSION" = "latest" ]; then
  echo "Bun $(bun -v) already installed"
  exit 0
fi
curl -fsSL https://bun.sh/install | bash -s "bun-v$VERSION"
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
echo "bun-version=$(bun -v)" >> $GITHUB_OUTPUT
`,
        },
      ],
    },
  },

  'jeju/setup-python': {
    name: 'Setup Python',
    description: 'Set up Python environment',
    inputs: {
      version: { description: 'Python version', default: '3.11' },
      cache: { description: 'Package manager to cache (pip, pipenv, poetry)' },
    },
    runs: {
      using: 'composite',
      steps: [
        {
          stepId: 'setup',
          name: 'Install Python',
          run: `
set -e
VERSION="\${{ inputs.version }}"
if command -v python3 &> /dev/null; then
  CURRENT=$(python3 -V | cut -d' ' -f2)
  if [[ "$CURRENT" == "$VERSION"* ]]; then
    echo "Python $CURRENT already installed"
    exit 0
  fi
fi
apt-get update && apt-get install -y python$VERSION python3-pip || apk add --no-cache python3 py3-pip
echo "python-version=$(python3 -V)" >> $GITHUB_OUTPUT
`,
        },
      ],
    },
  },

  'jeju/setup-go': {
    name: 'Setup Go',
    description: 'Set up Go environment',
    inputs: {
      version: { description: 'Go version', default: '1.22' },
      cache: { description: 'Enable caching', default: 'true' },
    },
    runs: {
      using: 'composite',
      steps: [
        {
          stepId: 'setup',
          name: 'Install Go',
          run: `
set -e
VERSION="\${{ inputs.version }}"
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
curl -fsSL "https://go.dev/dl/go$VERSION.linux-$ARCH.tar.gz" | tar -C /usr/local -xzf -
export PATH="/usr/local/go/bin:$PATH"
echo "go-version=$(go version)" >> $GITHUB_OUTPUT
`,
        },
      ],
    },
  },

  'jeju/cache': {
    name: 'Cache',
    description: 'Cache dependencies using DWS storage',
    inputs: {
      path: { description: 'Paths to cache', required: true },
      key: { description: 'Cache key', required: true },
      'restore-keys': { description: 'Fallback keys for restore' },
    },
    outputs: {
      'cache-hit': { description: 'Whether cache was restored' },
    },
    runs: {
      using: 'composite',
      steps: [
        {
          stepId: 'restore',
          name: 'Restore cache',
          run: `
set -e
CACHE_KEY="\${{ inputs.key }}"
CACHE_PATH="\${{ inputs.path }}"
DWS_URL="\${DWS_URL:-http://localhost:4030}"

CACHE_CID=$(curl -sf "$DWS_URL/storage/cache/$CACHE_KEY" 2>/dev/null | jq -r '.cid // empty' || true)

if [ -n "$CACHE_CID" ]; then
  echo "Cache hit: $CACHE_KEY"
  mkdir -p "$CACHE_PATH"
  curl -sf "$DWS_URL/storage/download/$CACHE_CID" | tar -xzf - -C "$CACHE_PATH"
  echo "cache-hit=true" >> $GITHUB_OUTPUT
else
  if [ -n "\${{ inputs.restore-keys }}" ]; then
    IFS=',' read -ra KEYS <<< "\${{ inputs.restore-keys }}"
    for KEY in "\${KEYS[@]}"; do
      CACHE_CID=$(curl -sf "$DWS_URL/storage/cache/$KEY" 2>/dev/null | jq -r '.cid // empty' || true)
      if [ -n "$CACHE_CID" ]; then
        echo "Partial cache hit: $KEY"
        mkdir -p "$CACHE_PATH"
        curl -sf "$DWS_URL/storage/download/$CACHE_CID" | tar -xzf - -C "$CACHE_PATH"
        echo "cache-hit=true" >> $GITHUB_OUTPUT
        exit 0
      fi
    done
  fi
  echo "Cache miss: $CACHE_KEY"
  echo "cache-hit=false" >> $GITHUB_OUTPUT
fi
`,
        },
      ],
    },
    post: {
      steps: [
        {
          stepId: 'save',
          name: 'Save cache',
          run: `
set -e
CACHE_KEY="\${{ inputs.key }}"
CACHE_PATH="\${{ inputs.path }}"
DWS_URL="\${DWS_URL:-http://localhost:4030}"

if [ -d "$CACHE_PATH" ]; then
  TMPFILE=$(mktemp)
  tar -czf "$TMPFILE" -C "$CACHE_PATH" .
  curl -sf -X POST "$DWS_URL/storage/upload" -F "file=@$TMPFILE" -F "key=$CACHE_KEY" > /dev/null
  rm -f "$TMPFILE"
  echo "Cache saved: $CACHE_KEY"
fi
`,
        },
      ],
    },
  },

  'jeju/artifact-upload': {
    name: 'Upload Artifact',
    description: 'Upload build artifacts to DWS storage',
    inputs: {
      name: { description: 'Artifact name', required: true },
      path: { description: 'Path to upload', required: true },
      'retention-days': { description: 'Days to retain', default: '7' },
      'if-no-files-found': { description: 'Behavior if no files found', default: 'warn' },
    },
    runs: {
      using: 'composite',
      steps: [
        {
          stepId: 'upload',
          name: 'Upload artifact',
          run: `
set -e
NAME="\${{ inputs.name }}"
ARTIFACT_PATH="\${{ inputs.path }}"
RETENTION="\${{ inputs.retention-days }}"
DWS_URL="\${DWS_URL:-http://localhost:4030}"
RUN_ID="\${{ github.run_id }}"

if [ ! -e "$ARTIFACT_PATH" ]; then
  if [ "\${{ inputs.if-no-files-found }}" = "error" ]; then
    echo "Error: No files found at $ARTIFACT_PATH"
    exit 1
  fi
  echo "Warning: No files found at $ARTIFACT_PATH"
  exit 0
fi

TMPFILE=$(mktemp)
if [ -d "$ARTIFACT_PATH" ]; then
  tar -czf "$TMPFILE" -C "$ARTIFACT_PATH" .
else
  tar -czf "$TMPFILE" -C "$(dirname $ARTIFACT_PATH)" "$(basename $ARTIFACT_PATH)"
fi

RESULT=$(curl -sf -X POST "$DWS_URL/ci/artifacts" \
  -F "file=@$TMPFILE" \
  -F "name=$NAME" \
  -F "runId=$RUN_ID" \
  -F "retention=$RETENTION")

rm -f "$TMPFILE"
echo "Artifact uploaded: $NAME"
echo "artifact-id=$(echo $RESULT | jq -r '.artifactId')" >> $GITHUB_OUTPUT
`,
        },
      ],
    },
  },

  'jeju/artifact-download': {
    name: 'Download Artifact',
    description: 'Download artifacts from DWS storage',
    inputs: {
      name: { description: 'Artifact name', required: true },
      path: { description: 'Download path', default: '.' },
      'run-id': { description: 'Run ID to download from' },
    },
    runs: {
      using: 'composite',
      steps: [
        {
          stepId: 'download',
          name: 'Download artifact',
          run: `
set -e
NAME="\${{ inputs.name }}"
DOWNLOAD_PATH="\${{ inputs.path }}"
RUN_ID="\${{ inputs.run-id || github.run_id }}"
DWS_URL="\${DWS_URL:-http://localhost:4030}"

mkdir -p "$DOWNLOAD_PATH"
curl -sf "$DWS_URL/ci/artifacts/$RUN_ID/$NAME" | tar -xzf - -C "$DOWNLOAD_PATH"
echo "Artifact downloaded: $NAME"
`,
        },
      ],
    },
  },

  'jeju/setup-buildx': {
    name: 'Setup Docker Buildx',
    description: 'Set up Docker Buildx for multi-platform builds',
    runs: {
      using: 'composite',
      steps: [
        {
          stepId: 'setup',
          name: 'Setup Buildx',
          run: `
set -e
docker buildx create --use --name jeju-builder --driver docker-container
docker buildx inspect --bootstrap
`,
        },
      ],
    },
  },

  'jeju/docker-login': {
    name: 'Docker Login',
    description: 'Log in to container registry',
    inputs: {
      registry: { description: 'Registry URL' },
      username: { description: 'Username', required: true },
      password: { description: 'Password', required: true },
    },
    runs: {
      using: 'composite',
      steps: [
        {
          stepId: 'login',
          name: 'Docker login',
          run: `
set -e
REGISTRY="\${{ inputs.registry }}"
echo "\${{ inputs.password }}" | docker login $REGISTRY -u "\${{ inputs.username }}" --password-stdin
echo "Logged in to $REGISTRY"
`,
        },
      ],
    },
  },

  'jeju/docker-build': {
    name: 'Build and Push Docker Image',
    description: 'Build and push Docker image to registry',
    inputs: {
      context: { description: 'Build context', default: '.' },
      file: { description: 'Dockerfile path' },
      push: { description: 'Push image', default: 'false' },
      tags: { description: 'Image tags (comma-separated)', required: true },
      platforms: { description: 'Target platforms', default: 'linux/amd64' },
      'build-args': { description: 'Build arguments' },
      'cache-from': { description: 'Cache sources' },
      'cache-to': { description: 'Cache destinations' },
    },
    outputs: {
      digest: { description: 'Image digest' },
      imageid: { description: 'Image ID' },
    },
    runs: {
      using: 'composite',
      steps: [
        {
          stepId: 'build',
          name: 'Build image',
          run: `
set -e
CONTEXT="\${{ inputs.context }}"
DOCKERFILE="\${{ inputs.file || 'Dockerfile' }}"
PUSH="\${{ inputs.push }}"
TAGS="\${{ inputs.tags }}"
PLATFORMS="\${{ inputs.platforms }}"

TAG_ARGS=""
IFS=',' read -ra TAG_LIST <<< "$TAGS"
for TAG in "\${TAG_LIST[@]}"; do
  TAG_ARGS="$TAG_ARGS -t $TAG"
done

BUILD_ARGS=""
if [ -n "\${{ inputs.build-args }}" ]; then
  IFS=$'\\n' read -ra ARG_LIST <<< "\${{ inputs.build-args }}"
  for ARG in "\${ARG_LIST[@]}"; do
    BUILD_ARGS="$BUILD_ARGS --build-arg $ARG"
  done
fi

CACHE_FROM=""
if [ -n "\${{ inputs.cache-from }}" ]; then
  CACHE_FROM="--cache-from \${{ inputs.cache-from }}"
fi

CACHE_TO=""
if [ -n "\${{ inputs.cache-to }}" ]; then
  CACHE_TO="--cache-to \${{ inputs.cache-to }}"
fi

PUSH_FLAG=""
if [ "$PUSH" = "true" ]; then
  PUSH_FLAG="--push"
fi

docker buildx build \
  --platform "$PLATFORMS" \
  -f "$DOCKERFILE" \
  $TAG_ARGS \
  $BUILD_ARGS \
  $CACHE_FROM \
  $CACHE_TO \
  $PUSH_FLAG \
  "$CONTEXT"

echo "digest=$(docker images --no-trunc --quiet \${TAG_LIST[0]} 2>/dev/null || echo '')" >> $GITHUB_OUTPUT
`,
        },
      ],
    },
  },
};

export function mapGitHubInputs(
  githubInputs: Record<string, string>,
  mapping: Record<string, string>
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(githubInputs)) {
    const mappedKey = mapping[key] || key;
    result[mappedKey] = value;
  }
  return result;
}


