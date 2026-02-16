# Use Node.js 20 on Debian Bullseye Slim for smaller image size
FROM node:20-bullseye-slim

# Install system dependencies required for Playwright and Chromium
RUN apt-get update && apt-get install -y \
    chromium \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Install Playwright browsers (chromium only to save space)
RUN npx playwright install chromium --with-deps

# Copy application source code
COPY . .

# Create public directory for screenshots if not exists
RUN mkdir -p public/screenshots

# Set environment variables (defaults, can be overridden)
ENV PORT=8080
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Expose port
EXPOSE 8080

# Start the application
CMD ["node", "server.js"]