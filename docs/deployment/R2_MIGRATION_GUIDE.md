# R2 Migration Deployment Guide

**Date**: December 25, 2025
**Purpose**: Migrate encrypted message payloads from D1 database to R2 object storage
**Critical**: Prevents D1 database bloat (50GB/day would fill 10GB limit in hours)

---

## What Was Done

### 1. Code Changes ✅

**Relay Worker Updates:**
- ✅ Added R2_MESSAGES binding to `wrangler.toml` (dev + production)
- ✅ Updated `Env` interface in `src/index.ts` to include `R2_MESSAGES: R2Bucket`
- ✅ Created migration `0004_add_r2_storage.sql`:
  - Added `r2_key TEXT` column to `encrypted_messages` table
  - Created index on `r2_key` for efficient lookups
  - Kept `encrypted_payload` for backward compatibility
- ✅ Updated `src/handlers/messages.ts`:
  - **sendMessage()**: Uploads encrypted payload to R2 (`messages/{message_id}.bin`), stores R2 key in D1
  - **getInbox()**: Reads from R2 if `r2_key` exists, otherwise returns old `encrypted_payload` (backward compat)
  - **deleteMessage()**: Deletes R2 object when deleting message
- ✅ Updated `src/cron/cleanup.ts`:
  - **cleanupExpiredMessages()**: Deletes R2 objects for expired messages before deleting D1 records

**Database Migration:**
- ✅ Ran migration 0004 on production database
- ✅ Successfully added `r2_key` column (2 rows written, 32 rows read)

### 2. Architecture Changes

**Before (D1 Blob Storage):**
```
iOS → Relay → D1 (500KB encrypted_payload inline)
      ↓
    50GB/day → Database full in hours ❌
```

**After (R2 Object Storage):**
```
iOS → Relay → R2 (500KB binary object)
              ↓
           $0.45/month for 30GB ✅

      Relay → D1 (only metadata + R2 key)
              ↓
           ~1GB total (no bloat)
```

### 3. Backward Compatibility

The migration is **fully backward compatible**:
- Old messages: Have `encrypted_payload` in D1, `r2_key` is NULL → Relay returns payload as-is
- New messages: Have `r2_key` set, `encrypted_payload` is NULL → Relay fetches from R2 and returns as base64
- **iOS client**: No changes needed - API response format is identical (base64 encrypted_payload)

---

## What You Need to Do

### Step 1: Enable R2 in Cloudflare Dashboard

1. Go to https://dash.cloudflare.com
2. Navigate to **R2 Object Storage** in the sidebar
3. Click **Enable R2** (if not already enabled)
   - Note: R2 requires a payment method on file (but usage is cheap: $0.015/GB/month)
   - No upfront costs - pay only for what you use

### Step 2: Create R2 Buckets

**Option A: Via Cloudflare Dashboard (Recommended)**
1. In R2 dashboard, click **Create bucket**
2. Create bucket: `buds-messages-dev`
   - Region: Automatic (global)
   - Lifecycle rules: Delete objects after 30 days (optional)
3. Create bucket: `buds-messages-prod`
   - Region: Automatic (global)
   - Lifecycle rules: Delete objects after 30 days (recommended)

**Option B: Via Wrangler CLI (After enabling R2)**
```bash
cd /Users/ericyarmolinsky/Developer/buds-relay
npx wrangler r2 bucket create buds-messages-dev
npx wrangler r2 bucket create buds-messages-prod
```

### Step 3: Deploy Relay to Production

Once R2 buckets are created:

```bash
cd /Users/ericyarmolinsky/Developer/buds-relay
npm run deploy:prod
```

Expected output:
```
✅ Uploading worker...
✅ Deployment complete!
   URL: https://buds-relay.getstreams.workers.dev
```

### Step 4: Test E2EE with R2 Storage

1. **Share a memory from iPhone** (this will upload to R2)
2. **Check Xcode logs** for R2 upload confirmation
3. **Receive the memory** on another device
4. **Verify logs** show successful decryption

**Expected Logs:**
```
✅ [INBOX] Message decrypted and verified
✅ [INBOX] CID verified - content matches claimed CID
✅ [INBOX] Signature verified - message is authentic
```

### Step 5: Verify R2 Storage in Dashboard

1. Go to Cloudflare Dashboard → R2 → `buds-messages-prod`
2. You should see objects: `messages/{uuid}.bin`
3. Check object metadata:
   - `messageId`: UUID
   - `receiptCid`: CIDv1 hash
   - `senderDid`: did:buds:...
   - `uploadedAt`: Unix timestamp

---

## Cost Analysis (R2 vs D1)

**Before (D1 Blob Storage):**
- Database size: 50GB/day × 30 days = **1.5TB** ❌ **EXCEEDS 10GB LIMIT**
- Cost: Included in Workers paid plan ($5/month)
- Problem: **Database fills in hours**

**After (R2 Object Storage):**
- R2 storage: 30GB average (30-day retention)
  - Storage cost: 30GB × $0.015/GB = **$0.45/month**
  - Class A ops (PUT): 100k/day × $0.36/million = **$0.36/month**
  - Class B ops (GET): 400k/day × $0.04/million = **$0.016/month**
- D1 metadata: ~1GB (receipt CIDs, wrapped keys, signatures)
  - Cost: Included in Workers paid plan ($5/month)
- **Total R2 cost: $0.83/month** 🎉

**Savings:**
- Prevents D1 database failure at scale
- 99.97% reduction in database storage (1.5TB → 1GB)
- Total infrastructure cost: **$5.83/month** for 10k users

---

## Rollback Plan (If Needed)

If R2 migration causes issues:

1. **Revert relay code:**
   ```bash
   git revert HEAD
   npm run deploy:prod
   ```

2. **Database rollback** (optional - migration is non-destructive):
   ```bash
   # Drop r2_key column if needed
   npx wrangler d1 execute buds-relay-db --env production --remote \
     --command "ALTER TABLE encrypted_messages DROP COLUMN r2_key"
   ```

3. **Old messages still work** - they have `encrypted_payload` in D1

---

## Success Criteria

✅ R2 enabled in Cloudflare Dashboard
✅ Buckets created: `buds-messages-dev` and `buds-messages-prod`
✅ Relay deployed successfully
✅ iPhone can share memories (uploads to R2)
✅ Recipient receives and decrypts successfully
✅ R2 dashboard shows objects in `buds-messages-prod` bucket
✅ No errors in Cloudflare Workers logs

---

## Next Steps After R2 Migration

From SCALE_ANALYSIS.md Phase 2 (Before 1k Users):

1. **Enable APNs push notifications** (~2 hours)
   - Replace 30s polling with push-triggered inbox fetch
   - 95% reduction in wasted requests

2. **Implement tiered photo storage** (~4 hours)
   - Hot tier: Last 30 days (local storage)
   - Cold tier: Older photos in iCloud
   - Prevents 19GB/year iPhone storage bloat

3. **Stress testing** (~4 hours)
   - Simulate 1k users, 10k messages/day
   - Monitor D1 query latency, R2 download speeds
   - Profile iOS app memory with 10k receipts

---

## Summary

**Status**: Migration code complete, database migrated, waiting for R2 enablement
**Blocker**: R2 needs to be enabled through Cloudflare Dashboard (manual step)
**Impact**: Prevents critical relay failure at scale (D1 bloat)
**Estimated Time**: 10 minutes (enable R2 + create buckets + deploy)

**Once deployed, Buds can handle 10k users with zero storage issues.** 🚀
