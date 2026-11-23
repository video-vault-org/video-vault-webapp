#!/bin/sh
set -eu
umask 077

cd /data
mkdir -p conf jwtkeys tmp storage img
# Refresh the original branding on image upgrades; keep operator-provided image sets.
cp /opt/video-vault/default-images/default.* img/

if [ "$#" -eq 0 ]; then set -- start; fi

case "$1" in
  start)
    if [ ! -s conf/db.json ] || [ ! -s conf/storage.json ]; then
      echo 'Run config:init and admin:init with this data volume before starting VideoVault.' >&2
      exit 1
    fi
    shift
    exec node /opt/video-vault/built/lib/index.js "$@"
    ;;
  config:init|meta:init|frontend:init|admin:init)
    command="$1"
    shift
    name="${command%:init}"
    exec node "/opt/video-vault/built/lib/initialize-${name}.js" "$@"
    ;;
  *)
    exec "$@"
    ;;
esac
