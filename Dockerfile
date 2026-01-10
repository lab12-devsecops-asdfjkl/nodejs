# Build stage
FROM node:18-alpine AS build
WORKDIR /app

COPY package*.json ./
# Use npm ci if lock file exists, otherwise npm install
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY . .

# Prune dev dependencies
RUN npm prune --production


# Production stage
FROM node:18-alpine AS production
WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nodejs -G nodejs

# Copy only production files
COPY --from=build --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nodejs:nodejs /app/package.json ./
COPY --from=build --chown=nodejs:nodejs /app/server.js ./

USER nodejs

EXPOSE 8000

CMD ["node", "server.js"]
