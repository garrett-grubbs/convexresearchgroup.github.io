#!/usr/bin/env bash
# Pull or publish the stock lookup data kept on the `stock-data` branch.
# The branch is force-pushed as a single commit each time, so it never builds up history.
#   scripts/stockdata_sync.sh pull <dir>
#   scripts/stockdata_sync.sh push <dir>          publish <dir> as the whole branch
#   scripts/stockdata_sync.sh push-if-unchanged <dir>
#                                                 same, but skip if someone else pushed since our pull
#                                                 (so a quick quote refresh never undoes a full pull)
#   scripts/stockdata_sync.sh push-tickers <dir>  merge per-ticker files onto the latest branch
set -euo pipefail
mode="$1"; dir="$2"
remote="https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
head_sha() { git ls-remote --heads "$remote" stock-data | cut -f1; }
if [ "$mode" = pull ]; then
  mkdir -p "$dir"
  rm -f "$dir/.base_sha"
  if git ls-remote --exit-code --heads "$remote" stock-data >/dev/null 2>&1; then
    tmp=$(mktemp -d)
    git clone -q --depth 1 --branch stock-data "$remote" "$tmp"
    git -C "$tmp" rev-parse HEAD > "$tmp/.base_sha"
    rm -rf "$tmp/.git"
    cp -a "$tmp/." "$dir/"
  fi
elif [ "$mode" = push ] || [ "$mode" = push-if-unchanged ]; then
  if [ "$mode" = push-if-unchanged ] && [ -f "$dir/.base_sha" ] && [ "$(head_sha)" != "$(cat "$dir/.base_sha")" ]; then
    echo "stock-data changed since pull; skipping this push"
    exit 0
  fi
  cd "$dir"
  rm -rf .git .base_sha
  git init -q
  git checkout -q -b stock-data
  git config user.name "crg-bot"
  git config user.email "actions@users.noreply.github.com"
  git add -A
  git commit -q -m "Stock data $(date -u +%Y-%m-%dT%H:%MZ)"
  git push -q -f "$remote" stock-data
  rm -rf .git
elif [ "$mode" = push-tickers ]; then
  tmp=$(mktemp -d)
  "$0" pull "$tmp"
  find "$dir" -maxdepth 1 -name '*.json' ! -name index.json ! -name universe.json -exec cp {} "$tmp/" \;
  "$0" push "$tmp"
fi
