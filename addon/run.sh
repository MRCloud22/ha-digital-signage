#!/usr/bin/with-contenv bashio

bashio::log.info "Starting Digital Signage Server..."

# Ensure persistent data directories exist
mkdir -p /data/uploads

# Point server at the HA persistent data volume so data survives addon updates
export DB_PATH=/data/database.sqlite
export UPLOAD_DIR=/data/uploads

cd /app/server
node index.js
