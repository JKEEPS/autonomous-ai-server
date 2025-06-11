FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Build the TypeScript code
RUN npm run build

# Create a non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Change ownership of the app directory
RUN chown -R nodejs:nodejs /app
USER nodejs

# Expose port (if needed for HTTP interface)
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV WORKING_DIRECTORY=/app/workspace

# Create workspace directory
USER root
RUN mkdir -p /app/workspace && chown nodejs:nodejs /app/workspace
USER nodejs

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "console.log('Server is healthy')" || exit 1

# Start the server
CMD ["npm", "start"]
