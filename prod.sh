#!/usr/bin/env bash

set -e

cleanup() {
  rm -rf built
  rm -rf logs
  rm -rf ssl
  rm -rf conf
  rm -rf frontend/dist
  rm initKey 2>/dev/null

  exit 0
}

# trap CTRL+C (SIGINT) & SIGTERM
trap cleanup SIGINT SIGTERM

npm run build && cd frontend && npm run build && cd .. && node built/lib/index.js

cleanup
