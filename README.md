# Buds Relay Server

**Zero-trust E2EE message relay for Buds Circle sharing**

Built with Cloudflare Workers + D1 + R2, following OWASP API Security Top 10 2023.

---

## Status

🚀 **PRODUCTION DEPLOYED** (Dec 31, 2025)
**Live:** https://buds-relay.getstreams.workers.dev
**Dev:** https://buds-relay-dev.getstreams.workers.dev
**Domain:** api.joinbuds.com (pending DNS setup)

### What's Complete

✅ **Authentication** - Firebase ID token verification with KV-cached public keys
✅ **Rate Limiting** - Per-endpoint limits (20-200 req/min), DID enumeration prevention
✅ **Input Validation** - Zod schemas for all inputs, SQL injection prevention
✅ **E2EE Message Relay** - Device registration, DID lookup, message send/receive
✅ **Signature Verification** - Ed25519 signature storage + validation
✅ **R2 Storage** - Encrypted payloads in R2 vs D1 for scalability
✅ **Cleanup Cron** - Expired messages + R2 objects deleted daily at 2 AM UTC
✅ **Phone-Based Identity** - DID derivation from phone + account salt (Migration 0005)
✅ **Deterministic Phone Encryption** - AES-256-GCM prevents rainbow table attacks (Migration 0006)
✅ **Test Coverage** - 39/39 tests passing, zero TypeScript errors

### Crypto Hardening (Phase 10.3 Modules 0.2-0.3)

**Identity Model:**
- DID = `did:phone:SHA256(phone + account_salt)` (not per-device)
- All devices with same phone number = same DID
- Account salt generated once per phone, stored encrypted on relay

**Phone Number Security:**
- Plaintext phones sent over HTTPS (TLS)
- Encrypted server-side with AES-256-GCM (deterministic)
- Nonce derived from SHA-256(phone).slice(0, 12)
- Requires BOTH database leak AND secrets leak to expose phone numbers

**DID Format Support:**
- `did:phone:<hex64>` - Phone-based identity (current)
- `did:buds:<base58>` - Legacy format (still supported)

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
# Development
npx wrangler d1 execute buds-relay-db --env=dev --remote --file=migrations/0001_initial.sql
npx wrangler d1 execute buds-relay-db --env=dev --remote --file=migrations/0002_add_apns_token.sql
npx wrangler d1 execute buds-relay-db --env=dev --remote --file=migrations/0003_add_signature_column.sql
npx wrangler d1 execute buds-relay-db --env=dev --remote --file=migrations/0004_add_r2_storage.sql
npx wrangler d1 execute buds-relay-db --env=dev --remote --file=migrations/0005_add_account_salts.sql
npx wrangler d1 execute buds-relay-db --env=dev --remote --file=migrations/0006_add_encrypted_phone.sql

# Production (same commands with --env=production)
```

**Migrations:**
- `0001_initial.sql` - Initial schema (devices, phone_to_did, encrypted_messages)
- `0002_add_apns_token.sql` - APNs token for push notifications
- `0003_add_signature_column.sql` - Ed25519 signature storage
- `0004_add_r2_storage.sql` - R2 object storage for encrypted payloads
- `0005_add_account_salts.sql` - Phone-based identity (account salts table)
- `0006_add_encrypted_phone.sql` - Deterministic phone encryption (phone_hash → encrypted_phone)

### 4. Set Secrets

```bash
# REQUIRED: Phone encryption key (generate with: openssl rand -base64 32)
echo "YOUR_BASE64_KEY" | npx wrangler secret put PHONE_ENCRYPTION_KEY --env=dev
echo "YOUR_BASE64_KEY" | npx wrangler secret put PHONE_ENCRYPTION_KEY --env=production

# OPTIONAL: APNs credentials (for push notifications)
npx wrangler secret put APNS_P8_KEY --env production
npx wrangler secret put APNS_KEY_ID --env production
npx wrangler secret put APNS_TEAM_ID --env production
```

### 5. Run Tests

```bash
npm test
# Expected: ✓ 39 tests passing
```

### 6. Deploy

```bash
# Development
npm run deploy:staging

# Production
npm run deploy:prod
```

---

## API Endpoints

All `/api/*` endpoints require Firebase Authentication (`Authorization: Bearer <token>`).

### Account Management

```bash
POST /api/account/salt          # Get or create account salt (phone-based DID)
```

### Device Management

```bash
POST /api/devices/register      # Register new device (with phone number)
POST /api/devices/list          # List devices for DIDs
POST /api/devices/heartbeat     # Update device last_seen_at
```

### DID Lookup

```bash
POST /api/lookup/did            # Lookup DID by phone number (encrypted server-side)
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

### Testing Endpoints (Dev Only)

```bash
POST /test/phone-encryption     # Test deterministic phone encryption
POST /test/account-salt-debug   # Test account salt flow (no auth)
```

---

## Security Model

### Zero-Trust E2EE Architecture

- **Client encrypts** → Relay stores ciphertext in R2 → **Client decrypts**
- Relay cannot read message contents (AES-256-GCM encrypted)
- Relay cannot modify messages (Ed25519 signatures verified by recipients)
- Relay cannot inject messages (device ownership verified)

### Phone Number Privacy (Phase 10.3 Module 0.3)

**Server-Side Deterministic Encryption:**
- Client sends plaintext phone over HTTPS (TLS)
- Server encrypts with AES-256-GCM using PHONE_ENCRYPTION_KEY secret
- Nonce derived from SHA-256(phone).slice(0, 12) - deterministic for lookups
- Same phone → same ciphertext → enables database queries

**Security Properties:**
- ❌ Rainbow tables don't work (ciphertext, not hash)
- ✅ Lookups work (deterministic encryption)
- ✅ DB leak alone doesn't expose phones (encrypted at rest)
- ✅ Requires BOTH DB + secrets leak to decrypt

**Tradeoff:** Server sees plaintext phones during API calls (over TLS). Encrypted phones stored in database. This is necessary for phone-based identity with multi-device support.

### Validation (Zod Schemas)

- ✅ DIDs: `did:phone:<hex64>` OR `did:buds:<base58>` format
- ✅ Device IDs: UUID v4
- ✅ Phone numbers: E.164 format (e.g., +14155551234)
- ✅ CIDs: CIDv1 base32 format
- ✅ Ed25519 Signatures: Base64, 88 chars
- ✅ Max 12 DIDs per request (Circle limit)

### Rate Limiting

- `/api/account/salt`: 10 requests/minute
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

[env.production.observability]
enabled = true

[env.production.observability.logs]
enabled = true
head_sampling_rate = 1
invocation_logs = true
```

### Required Bindings

- `DB` - D1 Database (metadata storage)
- `KV_CACHE` - KV Namespace (Firebase public key cache)
- `R2_MESSAGES` - R2 Bucket (encrypted message payloads)

### Required Secrets

```bash
# Generate encryption key: openssl rand -base64 32
PHONE_ENCRYPTION_KEY  # Base64-encoded 256-bit AES key for phone number encryption
```

### Optional Secrets (APNs Push)

```bash
APNS_P8_KEY     # .p8 key content from Apple Developer Portal
APNS_KEY_ID     # Key ID from Apple Developer Portal
APNS_TEAM_ID    # Team ID from Apple Developer Portal
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

# View analytics in Cloudflare Dashboard
# → Workers & Pages → buds-relay → Observability

# Check health
curl https://buds-relay.getstreams.workers.dev/health
```

---

## Project Structure

```
buds-relay/
├── src/
│   ├── index.ts              # Main router + scheduled triggers
│   ├── middleware/           # Auth + rate limiting
│   ├── handlers/             # API endpoints (devices, lookup, messages, account)
│   ├── utils/                # Validation, errors, crypto, phone encryption
│   └── cron/                 # Cleanup job (expired messages + R2)
├── test/                     # 39 tests (validation + rate limiting)
├── migrations/               # 6 migrations (0001-0006)
├── docs/                     # Documentation
│   ├── deployment/           # Deployment guides (R2 migration)
│   ├── architecture/         # Architecture docs (future)
│   └── planning/             # Planning docs (future)
├── wrangler.toml             # Cloudflare config (dev + prod)
└── deploy.sh                 # Deployment script with safety checks
```

---

## Available Scripts

- `npm run dev` - Start local development server
- `npm test` - Run all tests (39/39 passing)
- `npm run typecheck` - TypeScript type checking
- `npm run deploy:staging` - Deploy to dev environment
- `npm run deploy:prod` - Deploy to production

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

## Documentation

- **Deployment:** See `docs/deployment/R2_MIGRATION_GUIDE.md`
- **Architecture:** See `docs/architecture/` (future)
- **Planning:** See `docs/planning/` (future)

---

## License

MIT

## Author

Eric Yarmolinsky

---

**Status:** Production deployed. Phase 10.3 Module 0.3 complete. 39/39 tests passing. Ready for 10k users.
