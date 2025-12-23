#!/bin/bash
#
# Buds Relay Deployment Script
# Deploys the relay server to Cloudflare Workers
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Print with color
info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check for environment argument
ENV=${1:-dev}

if [ "$ENV" != "dev" ] && [ "$ENV" != "staging" ] && [ "$ENV" != "production" ]; then
    error "Invalid environment: $ENV"
    echo "Usage: ./deploy.sh [dev|staging|production]"
    exit 1
fi

info "Deploying Buds Relay to environment: $ENV"

# 1. Run typecheck
info "Running TypeScript type checking..."
npm run typecheck
if [ $? -ne 0 ]; then
    error "TypeScript type checking failed. Please fix errors before deploying."
    exit 1
fi

# 2. Run tests
info "Running tests..."
npm test
if [ $? -ne 0 ]; then
    error "Tests failed. Please fix failing tests before deploying."
    exit 1
fi

# 3. Check if D1 database is configured
info "Checking D1 database configuration..."
DB_ID=$(grep -A 2 '\[\[d1_databases\]\]' wrangler.toml | grep 'database_id' | cut -d '"' -f 2)
if [ -z "$DB_ID" ]; then
    warn "D1 database not configured. Creating database..."
    npm run db:create
    echo ""
    warn "Please update wrangler.toml with the database_id and run this script again."
    exit 1
fi

# 4. Check if KV namespace is configured
info "Checking KV namespace configuration..."
KV_ID=$(grep -A 2 '\[\[kv_namespaces\]\]' wrangler.toml | grep '^id' | cut -d '"' -f 2)
if [ -z "$KV_ID" ]; then
    warn "KV namespace not configured. Creating namespace..."
    npm run kv:create
    echo ""
    warn "Please update wrangler.toml with the KV namespace id and run this script again."
    exit 1
fi

# 5. Apply database migrations (for production)
if [ "$ENV" = "production" ]; then
    info "Applying database migrations to production..."
    read -p "Are you sure you want to apply migrations to PRODUCTION? (yes/no): " confirm
    if [ "$confirm" = "yes" ]; then
        npm run db:migrate:prod
    else
        warn "Skipping database migration. Deployment continuing..."
    fi
fi

# 6. Deploy to Cloudflare Workers
info "Deploying to Cloudflare Workers ($ENV)..."

if [ "$ENV" = "dev" ]; then
    npm run deploy:staging
elif [ "$ENV" = "staging" ]; then
    npm run deploy:staging
else
    npm run deploy:prod
fi

if [ $? -eq 0 ]; then
    echo ""
    info "✅ Deployment successful!"
    echo ""
    if [ "$ENV" = "dev" ] || [ "$ENV" = "staging" ]; then
        info "Your relay is available at: https://buds-relay-dev.YOUR_SUBDOMAIN.workers.dev"
    else
        info "Your relay is available at: https://buds-relay.YOUR_SUBDOMAIN.workers.dev"
        info "Or at your custom domain if configured in wrangler.toml"
    fi
    echo ""
    info "Next steps:"
    echo "  - Test the /health endpoint"
    echo "  - Verify Firebase Auth is working"
    echo "  - Test device registration and DID lookup"
    echo "  - Monitor logs: wrangler tail"
else
    error "Deployment failed. Check the error messages above."
    exit 1
fi
