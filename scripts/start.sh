#!/bin/sh
set -e

# If no data.json exists (fresh volume), seed the database
if [ ! -f "$DATA_DIR/data.json" ]; then
  echo "[start] No data.json found, running seed..."
  node db/seed.js
fi

echo "[start] Starting CleanCave..."
exec node server.js
