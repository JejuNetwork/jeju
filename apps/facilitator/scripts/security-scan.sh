#!/bin/bash
# Security scanning script for facilitator

set -e

echo "🔍 Running security scan for facilitator..."

# Check if bun audit is available
if bun audit --help > /dev/null 2>&1; then
  echo "Running bun audit..."
  bun audit || {
    echo "⚠️  bun audit found vulnerabilities"
    exit 1
  }
else
  echo "⚠️  bun audit not available, skipping..."
fi

# Check for known vulnerable packages
echo "Checking for known vulnerable packages..."
if [ -f "package.json" ]; then
  # Check for common vulnerable packages
  if grep -q "axios.*0\.[0-9]\|axios.*1\.[0-2]" package.json 2>/dev/null; then
    echo "⚠️  Potentially vulnerable axios version detected"
  fi
fi

echo "✅ Security scan complete"

