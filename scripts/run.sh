#!/bin/zsh
set -euo pipefail

REPO_DIR="${0:A:h:h}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

docker desktop start --timeout 180 || true
until docker info >/dev/null 2>&1; do sleep 2; done

cd "$REPO_DIR"
exec "$REPO_DIR/newsletter" run
