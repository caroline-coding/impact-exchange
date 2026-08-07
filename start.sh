#!/bin/bash
set -e
# First boot on a fresh volume: initialize from the bundled database snapshot.
if [ -n "$DB_PATH" ] && [ ! -f "$DB_PATH" ]; then
  echo "Initializing $DB_PATH from bundled snapshot"
  cp /app/seed-exchange.db "$DB_PATH"
fi
exec node server.js
