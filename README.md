# Buds Relay Server

**Zero-trust E2EE message relay for Buds Circle sharing**

Built with Cloudflare Workers + D1 following the OWASP API Security Top 10 2023 framework.

---

## Status

**Hardening Sprint: Complete** ✅🚀

**Phase 1: Authentication & Validation** ✅
- ✅ Project structure created
- ✅ Dependencies installed (Hono, firebase-auth-cloudflare-workers, Zod)
- ✅ Firebase Auth middleware implemented
- ✅ Input validation with Zod schemas
- ✅ Error handling with structured logging

**Phase 2: Rate Limiting** ✅
- ✅ In-memory rate limiter implemented
- ✅ Per-endpoint rate limiting configured
- ✅ DID enumeration prevention
- ✅ Rate limit headers (X-RateLimit-*)

**Phase 3: API Handlers** ✅
- ✅ Device registration, listing, heartbeat endpoints
- ✅ DID lookup (single + batch) endpoints
- ✅ E2EE message send/receive endpoints
- ✅ Message delivery tracking
- ✅ TypeScript type safety across all handlers

**Phase 5: Production Readiness** ✅
- ✅ Cleanup cron job (expired messages + inactive devices)
- ✅ Scheduled triggers (daily at 2 AM UTC)
- ✅ Deployment script with safety checks
- ✅ **39/39 tests passing** (validation + rate limiting)
- ✅ Zero TypeScript errors

**Ready for deployment to Cloudflare Workers!**

---

## Tech Stack

- **Runtime:** Cloudflare Workers (edge compute)
- **Database:** Cloudflare D1 (SQLite at the edge)
- **Framework:** Hono (fast, lightweight HTTP router)
- **Auth:** firebase-auth-cloudflare-workers (zero-dependency Firebase Auth)
- **Validation:** Zod (TypeScript-first schema validation)
- **Testing:** Vitest (fast unit tests)

---

## Project Structure

```
buds-relay/
├── src/
│   ├── index.ts              # Main router + scheduled triggers ✅
│   ├── middleware/
│   │   ├── auth.ts           # Firebase Auth middleware ✅
│   │   └── ratelimit.ts      # Rate limiting middleware ✅
│   ├── handlers/
│   │   ├── devices.ts        # Device registration & discovery ✅
│   │   ├── lookup.ts         # DID lookup endpoints ✅
│   │   └── messages.ts       # E2EE message handlers ✅
│   ├── utils/
│   │   ├── validation.ts     # Zod schemas ✅
│   │   ├── errors.ts         # Error handling ✅
│   │   └── crypto.ts         # Phone hashing ✅
│   └── cron/
│       └── cleanup.ts        # Scheduled cleanup job ✅
├── test/
│   ├── validation.test.ts    # ✅ 29/29 tests passing
│   └── ratelimit.test.ts     # ✅ 10/10 tests passing
├── schema.sql                # D1 database schema ✅
├── wrangler.toml             # Cloudflare Workers config ✅
├── deploy.sh                 # Deployment script ✅
├── tsconfig.json
├── vitest.config.ts
└── package.json
```

---

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Create D1 Database

```bash
npm run db:create
# Copy the database_id to wrangler.toml
```

### 3. Create KV Namespace

```bash
npm run kv:create
# Copy the id to wrangler.toml
```

### 4. Apply Database Schema

```bash
npm run db:migrate
```

### 5. Run Tests

```bash
npm test
```

Expected output:
```
✓ test/validation.test.ts (29 tests) 7ms
✓ test/ratelimit.test.ts (10 tests) 1132ms

Test Files  2 passed (2)
     Tests  39 passed (39)
```

### 6. Start Development Server

```bash
npm run dev
```

Server runs at `http://localhost:8787`

---

## Available Scripts

- `npm run dev` - Start local development server
- `npm run deploy` - Deploy to workers.dev
- `npm run deploy:staging` - Deploy to staging environment
- `npm run deploy:prod` - Deploy to production
- `npm test` - Run all tests
- `npm run test:watch` - Run tests in watch mode
- `npm run typecheck` - TypeScript type checking
- `npm run db:create` - Create D1 database
- `npm run db:migrate` - Apply schema (local)
- `npm run db:migrate:prod` - Apply schema (production)
- `npm run kv:create` - Create KV namespace

---

## API Endpoints

All `/api/*` endpoints require Firebase Authentication (`Authorization: Bearer <token>`).

### Health Check

```bash
GET /health
```

Returns server health status (no auth required).

### Device Management

```bash
# Register new device
POST /api/devices/register
{
  "device_id": "uuid-v4",
  "device_name": "Alice's iPhone",
  "owner_did": "did:buds:...",
  "owner_phone_hash": "sha256-hash",
  "pubkey_x25519": "base64",
  "pubkey_ed25519": "base64"
}

# List devices for DIDs
POST /api/devices/list
{
  "dids": ["did:buds:...", "did:buds:..."]
}

# Update device heartbeat
POST /api/devices/heartbeat
{
  "device_id": "uuid-v4"
}
```

### DID Lookup

```bash
# Lookup DID by phone hash
POST /api/lookup/did
{
  "phone_hash": "sha256-hash"
}

# Batch lookup (max 12)
POST /api/lookup/batch
{
  "phone_hashes": ["hash1", "hash2", ...]
}
```

### E2EE Messages

```bash
# Send encrypted message
POST /api/messages/send
{
  "message_id": "uuid-v4",
  "receipt_cid": "bafyrei...",
  "sender_did": "did:buds:...",
  "sender_device_id": "uuid-v4",
  "recipient_dids": ["did:buds:...", ...],
  "encrypted_payload": "base64",
  "wrapped_keys": "base64"
}

# Get inbox (paginated)
GET /api/messages/inbox?did=did:buds:...&limit=50&since=1234567890

# Mark message delivered
POST /api/messages/mark-delivered
{
  "message_id": "uuid-v4",
  "recipient_did": "did:buds:..."
}

# Delete message
DELETE /api/messages/:messageId
```

---

## Security Model

### Input Validation (Zod Schemas)

All API inputs validated with strict schemas:

- ✅ **DIDs:** `did:buds:<base58>` format
- ✅ **Device IDs:** UUID v4 format
- ✅ **Phone hashes:** SHA-256 (64 hex characters)
- ✅ **Base64:** Valid base64 encoding
- ✅ **CIDs:** CIDv1 base32 format
- ✅ **Arrays:** Max 12 DIDs (Circle limit)

**SQL injection prevention:** All inputs validated before prepared statements.

### Authentication

- Firebase ID token required for all `/api/*` routes
- Token verified using `firebase-auth-cloudflare-workers`
- Public keys cached in KV for performance
- Invalid tokens → 401 Unauthorized

### Rate Limiting

- Per-endpoint limits to prevent abuse
- DID enumeration prevention (20 lookups/min)
- Device registration spam protection (5/5min)
- Rate limit headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
- Retry-After header when rate limited
- Tracked by Firebase UID (authenticated) or IP (anonymous)

**Configured limits:**
- `/api/lookup/did`: 20 requests/minute
- `/api/devices/register`: 5 requests per 5 minutes
- `/api/messages/send`: 100 requests/minute
- `/api/messages/inbox`: 200 requests/minute

### Error Handling

- User-friendly error messages (no internal leaks)
- Structured JSON logging
- Request IDs for debugging (CF-Ray header)
- Zod errors transformed to readable format

---

## Test Coverage

**39 tests (100% passing)**

### Validation Tests (29 tests)

**Golden Vectors** (prove correctness):
- Valid DIDs accepted
- Valid UUIDs accepted
- Valid phone numbers accepted
- Valid base64 accepted
- Valid CIDs accepted

**Threat Vectors** (prove security):
- SQL injection blocked
- Malformed DIDs rejected
- Invalid UUIDs rejected
- Circle limit enforced (max 12 DIDs)
- Empty arrays rejected
- Non-hex phone hashes rejected

### Rate Limiting Tests (10 tests)

**Golden Vectors** (prove correctness):
- Requests under limit allowed
- Rate limit headers set correctly
- Different IPs have separate limits
- Authenticated users tracked by UID

**Threat Vectors** (prove security):
- Requests over limit blocked (429)
- Retry-After header returned
- DID enumeration attacks prevented
- Device registration spam blocked

---

## Configuration

### Environment Variables (wrangler.toml)

```toml
[vars]
ENVIRONMENT = "development"
FIREBASE_PROJECT_ID = "your-project-id"
```

### Required Bindings

- `DB` - D1 Database
- `KV_CACHE` - KV Namespace (for Firebase public keys)

---

## Hardening Sprint Results

All 5 phases complete following OWASP API Security Top 10 2023:

**Phase 1: Authentication & Validation** ✅
- Firebase Auth with KV-cached public keys
- Zod validation for all inputs
- SQL injection prevention

**Phase 2: Rate Limiting** ✅
- Per-endpoint limits (20-200 req/min)
- DID enumeration prevention
- Rate limit headers + Retry-After

**Phase 3: API Handlers** ✅
- 10 API endpoints (devices, lookup, messages)
- Full TypeScript type safety
- E2EE message relay

**Phase 4: Error Handling** ✅
- User-friendly error messages
- Structured JSON logging
- Zero information leaks

**Phase 5: Production Readiness** ✅
- Cleanup cron job (daily at 2 AM UTC)
- Deployment script with safety checks
- 39/39 tests passing

**Total development time:** ~4 hours (vs estimated 4.25 hours)

---

## Deployment

### Prerequisites

1. **Cloudflare Account**: Sign up at [cloudflare.com](https://www.cloudflare.com)
2. **Wrangler CLI**: Already installed via `npm install`
3. **Firebase Project**: Create at [console.firebase.google.com](https://console.firebase.google.com)
   - Enable Phone Authentication
   - Copy Project ID to `wrangler.toml` (FIREBASE_PROJECT_ID)

### First-Time Setup

```bash
# 1. Login to Cloudflare
npx wrangler login

# 2. Create D1 database
npm run db:create
# Copy the database_id to wrangler.toml

# 3. Create KV namespace
npm run kv:create
# Copy the id to wrangler.toml

# 4. Apply database schema (local)
npm run db:migrate
```

### Deploy with Script (Recommended)

The deployment script runs type checking, tests, and safety checks:

```bash
# Deploy to development
./deploy.sh dev

# Deploy to production
./deploy.sh production
```

The script will:
- ✅ Run TypeScript type checking
- ✅ Run all tests (39/39 must pass)
- ✅ Check D1 database is configured
- ✅ Check KV namespace is configured
- ✅ Apply migrations (production only, with confirmation)
- ✅ Deploy to Cloudflare Workers
- ✅ Show deployment URL

### Manual Deployment

```bash
# Development/staging
npm run deploy:staging

# Production
npm run deploy:prod
```

### Post-Deployment

```bash
# Test health endpoint
curl https://buds-relay-dev.YOUR_SUBDOMAIN.workers.dev/health

# Monitor logs
npx wrangler tail

# View analytics
npx wrangler dev
```

### Custom Domain (Optional)

1. Buy domain (e.g., `getbuds.app`)
2. Add to Cloudflare DNS
3. Update `wrangler.toml`:

```toml
[env.production]
routes = [
  { pattern = "api.getbuds.app/*", zone_name = "getbuds.app" }
]
```

4. Deploy: `./deploy.sh production`

---

## License

MIT

## Author

Eric Yarmolinsky

---

**Status:** Phase 5 complete. Production-ready relay server. 39/39 tests passing. Ready for deployment.
