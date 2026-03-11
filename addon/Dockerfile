ARG BUILD_FROM=ghcr.io/hassio-addons/base/amd64:14.3.3
FROM $BUILD_FROM

# Install Node.js
RUN apk add --no-cache \
    nodejs \
    npm \
    sqlite

# Create app directory
WORKDIR /app

# Copy package and server files
COPY server/package*.json ./server/
COPY server/ ./server/
COPY frontend/ ./frontend/

# Install dependencies
RUN cd server && npm install

# Copy run script
COPY run.sh /
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
