#!/bin/bash
set -euo pipefail

echo "Jeju CI Runner starting..."
echo "Architecture: $(uname -m)"
echo "OS: $(uname -s)"

WORKFLOW_PAYLOAD="${JEJU_WORKFLOW:-}"

if [ -z "$WORKFLOW_PAYLOAD" ]; then
  echo "Error: JEJU_WORKFLOW environment variable not set"
  exit 1
fi

WORKFLOW=$(echo "$WORKFLOW_PAYLOAD" | base64 -d)
RUN_ID=$(echo "$WORKFLOW" | jq -r '.runId')
JOB_ID=$(echo "$WORKFLOW" | jq -r '.jobId')
DWS_URL="${DWS_URL:-http://localhost:4030}"

echo "Run ID: $RUN_ID"
echo "Job ID: $JOB_ID"
echo "DWS URL: $DWS_URL"

cd /workspace

GITHUB_OUTPUT=/tmp/github_output
GITHUB_ENV=/tmp/github_env
GITHUB_STEP_SUMMARY=/tmp/step_summary

touch "$GITHUB_OUTPUT" "$GITHUB_ENV" "$GITHUB_STEP_SUMMARY"

export GITHUB_OUTPUT GITHUB_ENV GITHUB_STEP_SUMMARY
export GITHUB_WORKSPACE=/workspace
export HOME=/root

apply_env_file() {
  if [ -f "$GITHUB_ENV" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      if [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
        export "$line"
      fi
    done < "$GITHUB_ENV"
  fi
}

echo "$WORKFLOW" | jq -r '.env // {} | to_entries[] | "\(.key)=\(.value)"' | while read -r line; do
  if [ -n "$line" ]; then
    export "$line"
  fi
done

send_status() {
  local status="$1"
  local step_id="${2:-}"
  local exit_code="${3:-0}"
  
  local payload="{\"runId\":\"$RUN_ID\",\"jobId\":\"$JOB_ID\",\"status\":\"$status\""
  
  if [ -n "$step_id" ]; then
    payload="$payload,\"stepId\":\"$step_id\",\"exitCode\":$exit_code"
  fi
  
  payload="$payload}"
  
  curl -sf -X POST "$DWS_URL/ci/internal/status" \
    -H "Content-Type: application/json" \
    -d "$payload" 2>/dev/null || true
}

send_log() {
  local level="$1"
  local message="$2"
  local step_id="${3:-}"
  
  local payload="{\"runId\":\"$RUN_ID\",\"jobId\":\"$JOB_ID\",\"level\":\"$level\",\"message\":$(echo "$message" | jq -Rs .)"
  
  if [ -n "$step_id" ]; then
    payload="$payload,\"stepId\":\"$step_id\""
  fi
  
  payload="$payload}"
  
  curl -sf -X POST "$DWS_URL/ci/internal/log" \
    -H "Content-Type: application/json" \
    -d "$payload" 2>/dev/null || true
}

send_status "in_progress"

STEPS=$(echo "$WORKFLOW" | jq -c '.job.steps[]')
STEP_COUNT=$(echo "$WORKFLOW" | jq '.job.steps | length')
STEP_INDEX=0
JOB_SUCCESS=true

echo "$STEPS" | while IFS= read -r step; do
  STEP_ID=$(echo "$step" | jq -r '.stepId // .id // "step-'$STEP_INDEX'"')
  STEP_NAME=$(echo "$step" | jq -r '.name // "Step '$STEP_INDEX'"')
  USES=$(echo "$step" | jq -r '.uses // empty')
  RUN_CMD=$(echo "$step" | jq -r '.run // empty')
  STEP_IF=$(echo "$step" | jq -r '.if // empty')
  CONTINUE_ON_ERROR=$(echo "$step" | jq -r '.continueOnError // false')
  WORKING_DIR=$(echo "$step" | jq -r '.workingDirectory // empty')
  SHELL_TYPE=$(echo "$step" | jq -r '.shell // "bash"')
  
  echo "::group::$STEP_NAME"
  send_log "group" "$STEP_NAME" "$STEP_ID"
  
  if [ -n "$STEP_IF" ]; then
    echo "Evaluating condition: $STEP_IF"
  fi
  
  apply_env_file
  
  echo "$step" | jq -r '.env // {} | to_entries[] | "\(.key)=\(.value)"' | while read -r envline; do
    if [ -n "$envline" ]; then
      export "$envline"
    fi
  done
  
  STEP_EXIT=0
  
  if [ -n "$USES" ]; then
    echo "Using action: $USES"
    send_log "info" "Using action: $USES" "$STEP_ID"
    
    case "$USES" in
      actions/checkout*|jeju/checkout*)
        REF="${REF:-${GITHUB_REF:-main}}"
        REPO_URL="${GITHUB_SERVER_URL:-$DWS_URL}/git/${GITHUB_REPOSITORY:-}"
        
        echo "Cloning $REPO_URL..."
        git clone "$REPO_URL" . 2>&1 || true
        git checkout "$REF" 2>&1 || true
        ;;
      actions/setup-node*|jeju/setup-node*)
        VERSION=$(echo "$step" | jq -r '.with["node-version"] // .with.version // "20"')
        echo "Node.js $(node -v) already installed"
        ;;
      actions/setup-python*|jeju/setup-python*)
        VERSION=$(echo "$step" | jq -r '.with["python-version"] // .with.version // "3.11"')
        echo "Python $(python3 -V) already installed"
        ;;
      actions/cache*|jeju/cache*)
        KEY=$(echo "$step" | jq -r '.with.key // empty')
        PATH_TO_CACHE=$(echo "$step" | jq -r '.with.path // empty')
        echo "Cache action for key: $KEY, path: $PATH_TO_CACHE"
        echo "cache-hit=false" >> "$GITHUB_OUTPUT"
        ;;
      *)
        echo "Action $USES not implemented, skipping..."
        ;;
    esac
    
  elif [ -n "$RUN_CMD" ]; then
    if [ -n "$WORKING_DIR" ]; then
      cd "$WORKING_DIR"
    fi
    
    echo "$ $RUN_CMD"
    send_log "command" "$RUN_CMD" "$STEP_ID"
    
    case "$SHELL_TYPE" in
      python)
        python3 -c "$RUN_CMD" 2>&1 || STEP_EXIT=$?
        ;;
      pwsh|powershell)
        echo "PowerShell not supported on Linux"
        STEP_EXIT=1
        ;;
      *)
        bash -e -c "$RUN_CMD" 2>&1 || STEP_EXIT=$?
        ;;
    esac
    
    if [ -n "$WORKING_DIR" ]; then
      cd /workspace
    fi
  fi
  
  if [ $STEP_EXIT -ne 0 ]; then
    send_log "error" "Step failed with exit code $STEP_EXIT" "$STEP_ID"
    
    if [ "$CONTINUE_ON_ERROR" != "true" ]; then
      JOB_SUCCESS=false
    fi
  fi
  
  echo "::endgroup::"
  send_log "endgroup" "" "$STEP_ID"
  
  STEP_INDEX=$((STEP_INDEX + 1))
done

if [ "$JOB_SUCCESS" = "true" ]; then
  send_status "completed" "" 0
  echo "Job completed successfully"
  exit 0
else
  send_status "failed" "" 1
  echo "Job failed"
  exit 1
fi


