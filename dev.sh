#!/usr/bin/env bash

set -e

echo "Starting Backend..."
npm run build:backend
node built/lib/index.js &
BACKEND_PID=$!

echo "Starting Frontend..."
cd frontend
npm run dev &
FRONTEND_PID=$!

cd ..

cleanup() {
  echo ""
  echo "Stopping Apps..."

  if ps -p $BACKEND_PID > /dev/null; then
    kill $BACKEND_PID
    echo "Stopped Backend"
  fi

  if ps -p $FRONTEND_PID > /dev/null; then
    kill $FRONTEND_PID
    echo "Stopped Frontend"
  fi

  rm -rf built
  rm -rf logs
  rm -rf ssl
  rm -rf conf
  rm initKey 2>/dev/null

  exit 0
}

# trap CTRL+C (SIGINT) & SIGTERM
trap cleanup SIGINT SIGTERM

echo "Backend PID: $BACKEND_PID"
echo "Frontend PID: $FRONTEND_PID"
echo "Both Apps running. Press CTRL+C to stop."

# Wait, until ctrl+c is pressed
wait
