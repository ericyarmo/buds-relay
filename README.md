# Buds Relay Server

**Zero-trust E2EE message relay for Buds Circle sharing**

Built with Cloudflare Workers + D1 + R2, following OWASP API Security Top 10 2023.

---

## Status

🚀 **PRODUCTION DEPLOYED** (Dec 25, 2025)
**Live:** https://buds-relay.getstreams.workers.dev
**Domain:** api.joinbuds.com (pending DNS setup)

### What's Complete

✅ **Authentication** - Firebase ID token verification with KV-cached public keys
✅ **Rate Limiting** - Per-endpoint limits (20-200 req/min), DID enumeration prevention
✅ **Input Validation** - Zod schemas for all inputs, SQL injection prevention
✅ **E2EE Message Relay** - Device registration, DID lookup, message send/receive
✅ **Signature Verification** - Ed25519 signature storage + validation (Migration 0003)
✅ **R2 Storage Migration** - Encrypted payloads in R2 vs D1 (Migration 0004)
✅ **Cleanup Cron** - Expired messages + R2 objects deleted daily at 2 AM UTC
✅ **Test Coverage** - 39/39 tests passing, zero TypeScript errors

### Scale Performance

- **Before:** D1 stores 500KB payloads → 50GB/day → Database full in hours ❌
- **After:** R2 stores payloads → $0.83/month for 30GB → Scales to 100k messages/day ✅
- **Impact:** 99.97% reduction in D1 storage (1.5TB → 1GB metadata only)

**Production-ready for 10k users, 100k messages/day.**

---

## Tech Stack

- **Runtime:** Cloudflare Workers (edge compute)
- **Database:** Cloudflare D1 (SQLite at the edge) - metadata only
- **Storage:** Cloudflare R2 (object storage) - encrypted message payloads
- **Framework:** Hono (fast HTTP router)
- **Auth:** firebase-auth-cloudflare-workers
- **Validation:** Zod (TypeScript-first schema validation)
- **Testing:** Vitest (39/39 tests passing)

---

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Create Resources

```bash
# Login to Cloudflare
npx wrangler login

# Create D1 database
npx wrangler d1 create buds-relay-db
# Copy database_id to wrangler.toml

# Create KV namespace
npx wrangler kv namespace create KV_CACHE
# Copy id to wrangler.toml

# Create R2 buckets
npx wrangler r2 bucket create buds-messages-dev
npx wrangler r2 bucket create buds-messages-prod
```

### 3. Apply Migrations

```bash
# Local
npm run db:migrate

# Production
npm run db:migrate:prod
```

**Migrations:**
- `0001_initial.sql` - Initial schema
- `0002_add_apns_token.sql` - APNs token for push notifications
- `0003_add_signature_column.sql` - Ed25519 signature storage
- `0004_add_r2_storage.sql` - R2 object storage for encrypted payloads

### 4. Run Tests

```bash
npm test
# Expected: ✓ 39 tests passing
```

### 5. Deploy

```bash
# Development
npm run deploy

# Production
npm run deploy:prod
```

---

## API Endpoints

All `/api/*` endpoints require Firebase Authentication (`Authorization: Bearer <token>`).

### Device Management

```bash
POST /api/devices/register     # Register new device
POST /api/devices/list          # List devices for DIDs
POST /api/devices/heartbeat     # Update device last_seen_at
```

### DID Lookup

```bash
POST /api/lookup/did            # Lookup DID by phone hash
POST /api/lookup/batch          # Batch lookup (max 12)
```

### E2EE Messages

```bash
POST /api/messages/send         # Send encrypted message (uploads to R2)
GET  /api/messages/inbox        # Get inbox (reads from R2)
POST /api/messages/mark-delivered
DELETE /api/messages/:messageId # Delete message + R2 object
```

### Health Check

```bash
GET /health                     # No auth required
```

---

## Security Model

### Zero-Trust E2EE Architecture

- **Client encrypts** → Relay stores ciphertext in R2 → **Client decrypts**
- Relay cannot read message contents (AES-256-GCM encrypted)
- Relay cannot modify messages (Ed25519 signatures verified by recipients)
- Relay cannot inject messages (device ownership verified)

### Validation (Zod Schemas)

- ✅ DIDs: `did:buds:<base58>` format
- ✅ Device IDs: UUID v4
- ✅ Phone hashes: SHA-256 (64 hex chars)
- ✅ CIDs: CIDv1 base32 format
- ✅ Ed25519 Signatures: Base64, 88 chars
- ✅ Max 12 DIDs per request (Circle limit)

### Rate Limiting

- `/api/lookup/did`: 20 requests/minute (DID enumeration prevention)
- `/api/devices/register`: 5 requests per 5 minutes (spam prevention)
- `/api/messages/send`: 100 requests/minute
- `/api/messages/inbox`: 200 requests/minute

### Authentication

- Firebase ID token required for all `/api/*` routes
- Public keys cached in KV for performance
- Invalid tokens → 401 Unauthorized

---

## Configuration

### Environment Variables (wrangler.toml)

```toml
[env.production.vars]
ENVIRONMENT = "production"
FIREBASE_PROJECT_ID = "buds-a32e0"
```

### Required Bindings

- `DB` - D1 Database (metadata storage)
- `KV_CACHE` - KV Namespace (Firebase public key cache)
- `R2_MESSAGES` - R2 Bucket (encrypted message payloads)

### Optional Secrets (APNs Push)

```bash
npx wrangler secret put APNS_P8_KEY --env production
npx wrangler secret put APNS_KEY_ID --env production
npx wrangler secret put APNS_TEAM_ID --env production
```

---

## Custom Domain Setup

1. Buy domain: `joinbuds.com`
2. Add to Cloudflare DNS
3. Update `wrangler.toml`:

```toml
[env.production]
routes = [
  { pattern = "api.joinbuds.com/*", zone_name = "joinbuds.com" }
]
```

4. Deploy: `npm run deploy:prod`

---

## Monitoring

```bash
# Tail logs (real-time)
npx wrangler tail --env production

# View analytics
npx wrangler dev

# Check health
curl https://api.joinbuds.com/health
```

---

## Project Structure

```
buds-relay/
├── src/
│   ├── index.ts              # Main router + scheduled triggers
│   ├── middleware/           # Auth + rate limiting
│   ├── handlers/             # API endpoints (devices, lookup, messages)
│   ├── utils/                # Validation, errors, crypto
│   └── cron/                 # Cleanup job (expired messages + R2)
├── test/                     # 39 tests (validation + rate limiting)
├── migrations/               # 4 migrations (0001-0004)
├── wrangler.toml             # Cloudflare config
└── deploy.sh                 # Deployment script with safety checks
```

---

## Available Scripts

- `npm run dev` - Start local development server
- `npm test` - Run all tests (39/39 passing)
- `npm run typecheck` - TypeScript type checking
- `npm run deploy:prod` - Deploy to production
- `npm run db:migrate:prod` - Apply migrations to production

---

## Cost Analysis (10k users, 100k messages/day)

| Resource | Usage | Cost |
|----------|-------|------|
| Workers paid plan | 10M req/day | $5/month |
| D1 database | 1 GB metadata | Included |
| R2 storage | 30 GB | $0.45/month |
| R2 Class A ops (PUT) | 100k/day | $0.36/month |
| R2 Class B ops (GET) | 400k/day | $0.02/month |
| **Total** | | **$5.83/month** |

**Cost per user:** $0.0006/month = **$0.007/year** 🎉

---

## License
Eve
MIT

## Author

Eric Yarmolinsky

---

**Status:** Production deployed. 39/39 tests passing. Ready for 10k users.
