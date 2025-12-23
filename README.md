# Buds Relay Server

**Zero-trust E2EE message relay for Buds Circle sharing**

Built with Cloudflare Workers + D1 following the OWASP API Security Top 10 2023 framework.

---

## Status

**Hardening Sprint: Phase 3 Complete** ✅

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
- ✅ **39/39 tests passing** (validation + rate limiting)

**Next:** Phase 5 (production readiness - cleanup cron + deployment)

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
│   ├── index.ts              # Main router ✅
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
│   └── cron/                 # Cleanup jobs (TODO)
├── test/
│   ├── validation.test.ts    # ✅ 29/29 tests passing
│   └── ratelimit.test.ts     # ✅ 10/10 tests passing
├── schema.sql                # D1 database schema ✅
├── wrangler.toml             # Cloudflare Workers config
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

## Next Steps (Hardening Sprint)

Following `/Buds/PHASE_6_HARDENING_SPRINT.md`:

**Phase 2: Rate Limiting** ✅
- [x] Implement Cloudflare Workers rate limiting
- [x] Add per-endpoint limits
- [x] Create golden + threat tests
- [x] Prevent DID enumeration attacks

**Phase 3: API Handlers** ✅
- [x] Device registration endpoint
- [x] Device listing endpoint
- [x] Device heartbeat endpoint
- [x] DID lookup endpoint (single + batch)
- [x] Message send/receive endpoints
- [x] Message delivery tracking
- [x] Applied validation to all handlers
- [x] TypeScript type safety

**Phase 4: Already Complete** ✅
- [x] Error handling implemented
- [x] Structured logging implemented
- [x] Safe error messages

**Phase 5: Production Readiness (45 min)**
- [ ] Cleanup cron job (expired messages)
- [ ] Integration tests (optional)
- [ ] Deployment script

**Total remaining: ~45 minutes**

---

## Deployment

### Deploy to workers.dev (free)

```bash
npm run deploy
```

Your relay will be available at: `https://buds-relay.YOUR_SUBDOMAIN.workers.dev`

### Deploy to Custom Domain (later)

1. Buy domain (e.g., `getbuds.app`)
2. Add to Cloudflare
3. Update `wrangler.toml`:

```toml
[env.production]
name = "buds-relay"
routes = [
  { pattern = "api.getbuds.app/*", zone_name = "getbuds.app" }
]
```

4. Deploy: `npm run deploy:prod`

---

## License

MIT

## Author

Eric Yarmolinsky

---

**Status:** Phase 3 complete. All API handlers implemented. 39/39 tests passing. Ready for Phase 5 (production readiness).
