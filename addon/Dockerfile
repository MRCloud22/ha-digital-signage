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

# Install server dependencies
RUN cd server && npm install

# Install frontend dependencies and build React app
RUN cd frontend && npm install && npm run build

# Copy run script
COPY run.sh /
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
