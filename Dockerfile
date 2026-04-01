FROM node:22-alpine

WORKDIR /app

# Install production dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy source
COPY src/ src/
COPY .gemini-cli-version ./
COPY docs/stream-json-schema.json docs/

# Create data directories
RUN mkdir -p data/sessions data/db

EXPOSE 3100

CMD ["node", "src/daemon/index.js"]
