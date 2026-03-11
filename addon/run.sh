#!/usr/bin/with-contenv bashio

bashio::log.info "Starting Digital Signage Server..."

# Start the Node.js application
cd /app/server
node index.js
