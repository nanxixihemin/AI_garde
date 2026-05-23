# Use official lightweight Node.js Alpine image
FROM node:20-alpine

# Set production environment
ENV NODE_ENV=production

# Set working directory inside the container
WORKDIR /app

# Copy package configuration files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy application source code (excluding files defined in .dockerignore)
COPY . .

# Expose the API and static server port
EXPOSE 3000

# Start the Node.js application
CMD ["node", "server.js"]
