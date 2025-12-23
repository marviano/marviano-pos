# Schema Sync Analysis - Breaking Changes Assessment

## Executive Summary

**Status**: ⚠️ **CRITICAL ISSUES FOUND** - Matching SQLite to MySQL will require careful migration

**Total Tables with Differences**: 37 out of 37 common tables (100%)

**Risk Level**: **HIGH** - Several changes could break existing functionality

---

## Critical Breaking Changes

### 1. **Missing Columns in SQLite** (HIGH RISK)

#### `businesses.status` (MISSING in SQLite)
- **Impact**: HIGH
- **MySQL**: `status enum('active','inactive') NOT NULL DEFAULT 'active'`
- **SQLite**: Column doesn't exist
- **Breaking Risk**: 
  - ✅ **SAFE** - Can add with default value 'active'
  - Sync code already handles this gracefully
  - App will work after migration

#### `category2_businesses.created_at` (MISSING in SQLite)
- **Impact**: MEDIUM
- **MySQL**: `created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP`
- **SQLite**: Column doesn't exist
- **Breaking Risk**: 
  - ✅ **SAFE** - Can add with NULL or current timestamp
  - Junction table, no critical dependencies

### 2. **Missing Columns in MySQL** (MEDIUM RISK)

#### `users.updated_at` (MISSING in MySQL)
- **Impact**: MEDIUM
- **SQLite**: `updated_at INTEGER`
- **MySQL**: Column doesn't exist
- **Breaking Risk**: 
  - ⚠️ **POTENTIAL ISSUE** - If sync code writes to this column, it will fail
  - Need to check if sync code uses this field
  - **Action**: Either add to MySQL or remove from SQLite sync

#### `businesses.updated_at` (MISSING in MySQL)
- **Impact**: MEDIUM
- **SQLite**: `updated_at INTEGER`
- **MySQL**: Column doesn't exist
- **Breaking Risk**: 
  - ⚠️ **POTENTIAL ISSUE** - Same as users.updated_at
  - **Action**: Either add to MySQL or remove from SQLite sync

### 3. **Primary Key Differences** (LOW RISK - SQLite specific)

All tables use different primary key syntax:
- **SQLite**: `INTEGER PRIMARY KEY` (auto-incrementing)
- **MySQL**: `AUTO_INCREMENT` with separate `PRIMARY KEY`

**Breaking Risk**: 
- ✅ **SAFE** - This is just syntax difference, not functional
- SQLite handles this automatically
- No code changes needed

### 4. **Timestamp/Date Type Differences** (LOW-MEDIUM RISK)

Many tables have timestamp differences:
- **SQLite**: `INTEGER` or `TEXT` for dates
- **MySQL**: `timestamp`, `datetime`, or `date`

**Breaking Risk**: 
- ⚠️ **POTENTIAL ISSUE** - Sync code must convert between formats
- Current sync code may already handle this
- Need to verify date conversion in sync functions

**Affected Tables**:
- `bundle_items.updated_at`
- `category1.updated_at`
- `category2.updated_at`
- `cl_accounts.updated_at`
- `cogs.updated_at`
- `contacts.updated_at`
- `ingredients.updated_at`
- And many more...

### 5. **NOT NULL Constraint Differences** (MEDIUM RISK)

Several columns have different NOT NULL requirements:

#### `businesses.organization_id`
- **SQLite**: `INTEGER` (nullable)
- **MySQL**: `INTEGER NOT NULL`
- **Breaking Risk**: 
  - ⚠️ **POTENTIAL ISSUE** - If SQLite has NULL values, sync will fail
  - Need to ensure all records have organization_id

#### `businesses.created_at`
- **SQLite**: `TEXT` (nullable)
- **MySQL**: `timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP`
- **Breaking Risk**: 
  - ⚠️ **POTENTIAL ISSUE** - If SQLite has NULL, sync will fail
  - Need to ensure all records have created_at

#### `users.role_id` and `users.organization_id`
- **SQLite**: `INTEGER` (nullable)
- **MySQL**: `INTEGER NOT NULL`
- **Breaking Risk**: 
  - ⚠️ **POTENTIAL ISSUE** - Critical for user functionality
  - Need to ensure all users have these values

#### `transactions.refund_status`
- **SQLite**: `TEXT DEFAULT 'none'` (nullable)
- **MySQL**: `enum('none','partial','full') NOT NULL DEFAULT 'none'`
- **Breaking Risk**: 
  - ✅ **SAFE** - Has default value, but need to ensure consistency

#### `transactions.refund_total`
- **SQLite**: `REAL DEFAULT 0.0` (nullable)
- **MySQL**: `decimal(15,2) NOT NULL DEFAULT '0.00'`
- **Breaking Risk**: 
  - ✅ **SAFE** - Has default value

### 6. **Type Mismatches** (LOW RISK)

#### `category2.business_id` (EXTRA in SQLite)
- **SQLite**: Has `business_id INTEGER` column
- **MySQL**: Uses junction table `category2_businesses` instead
- **Breaking Risk**: 
  - ⚠️ **POTENTIAL ISSUE** - Different data model
  - Sync code already handles junction table (line 319-325 in offlineSync.ts)
  - Need to ensure migration doesn't break existing data

#### ENUM vs TEXT
- **MySQL**: Uses ENUM types (e.g., `status enum('active','inactive')`)
- **SQLite**: Uses TEXT
- **Breaking Risk**: 
  - ✅ **SAFE** - SQLite doesn't support ENUM, TEXT is fine
  - Sync code should validate values before insert

---

## Tables Analysis by Risk Level

### 🔴 HIGH RISK (Must Fix Before Sync)

1. **businesses** - Missing `status` column, NOT NULL constraints
2. **users** - NOT NULL constraints on role_id, organization_id
3. **transactions** - Multiple NOT NULL constraints, enum differences

### 🟡 MEDIUM RISK (Should Fix)

1. **category2_businesses** - Missing `created_at`
2. **All tables with updated_at** - Type conversion needed
3. **category2** - business_id column vs junction table

### 🟢 LOW RISK (Cosmetic/No Impact)

1. Primary key syntax differences (all tables)
2. Type name differences (INTEGER vs INT, TEXT vs VARCHAR)
3. Index differences (not affecting sync)

---

## Sync Code Analysis

### Current Sync Flow

1. **Download from MySQL** (`/api/sync` route):
   - Reads from MySQL
   - Sends to Electron
   - Electron upserts to SQLite

2. **Upload to MySQL** (`smartSync.ts`, `systemPosSync.ts`):
   - Reads from SQLite
   - Sends to MySQL API endpoints
   - MySQL inserts/updates

### Potential Issues in Current Sync Code

#### 1. `offlineSync.ts` - Download Sync
- ✅ Handles `category2_businesses` junction table correctly (line 319-325)
- ⚠️ May not handle missing `businesses.status` column
- ⚠️ May not handle `updated_at` columns that don't exist in MySQL

#### 2. `smartSync.ts` - Upload Sync
- ⚠️ May fail if SQLite has NULL values for NOT NULL MySQL columns
- ⚠️ May fail if trying to write `updated_at` to MySQL where it doesn't exist
- ⚠️ Date format conversion may be inconsistent

#### 3. `systemPosSync.ts` - System POS Sync
- ⚠️ Similar issues as smartSync.ts

---

## Recommended Fix Strategy

### Phase 1: Add Missing Columns to SQLite (SAFE)
1. Add `businesses.status` with default 'active'
2. Add `category2_businesses.created_at` with default NULL
3. Migration script needed in `electron/main.ts`

### Phase 2: Handle Missing Columns in MySQL (REQUIRES DECISION)
**Option A**: Add columns to MySQL
- Add `users.updated_at`
- Add `businesses.updated_at`
- Requires MySQL migration

**Option B**: Remove from SQLite sync
- Don't sync `updated_at` columns
- Update sync code to skip these fields

**Recommendation**: **Option B** - Remove from sync (simpler, less risk)

### Phase 3: Fix NOT NULL Constraints (CRITICAL)
1. Ensure all `businesses` have `organization_id` before sync
2. Ensure all `users` have `role_id` and `organization_id`
3. Ensure all `transactions` have required NOT NULL fields
4. Add validation in sync code

### Phase 4: Fix Date/Time Format Conversion (MEDIUM PRIORITY)
1. Standardize date format conversion in sync code
2. Ensure SQLite INTEGER timestamps convert to MySQL datetime
3. Test with various date formats

### Phase 5: Handle ENUM Validation (LOW PRIORITY)
1. Add validation for ENUM values before MySQL insert
2. Map invalid values to defaults

---

## Testing Checklist

Before deploying schema changes:

- [ ] Test sync download (MySQL → SQLite) with new columns
- [ ] Test sync upload (SQLite → MySQL) with NOT NULL constraints
- [ ] Test with NULL values in SQLite for NOT NULL MySQL columns
- [ ] Test date format conversion
- [ ] Test ENUM value validation
- [ ] Test with existing data (migration)
- [ ] Test offline mode after changes
- [ ] Test transaction creation after changes
- [ ] Test user creation after changes
- [ ] Test business creation after changes

---

## Files That Need Changes

### 1. `electron/main.ts`
- Add migration for `businesses.status`
- Add migration for `category2_businesses.created_at`
- Update CREATE TABLE statements to match MySQL

### 2. `src/lib/offlineSync.ts`
- Handle `businesses.status` in upsert
- Handle `category2_businesses.created_at` in upsert
- Skip `updated_at` columns that don't exist in MySQL

### 3. `src/lib/smartSync.ts`
- Validate NOT NULL fields before sync
- Skip `updated_at` columns when uploading
- Fix date format conversion
- Add ENUM validation

### 4. `src/lib/systemPosSync.ts`
- Similar fixes as smartSync.ts

### 5. `src/app/_api/sync/route.ts`
- Ensure all SELECT queries match MySQL schema
- Add `businesses.status` to SELECT
- Add `category2_businesses.created_at` to SELECT

---

## Migration Script Requirements

### SQLite Migration (in `electron/main.ts`)

```sql
-- Add businesses.status
ALTER TABLE businesses ADD COLUMN status TEXT DEFAULT 'active';
UPDATE businesses SET status = 'active' WHERE status IS NULL;

-- Add category2_businesses.created_at
ALTER TABLE category2_businesses ADD COLUMN created_at TEXT;

-- Ensure NOT NULL constraints are satisfied
UPDATE businesses SET organization_id = 1 WHERE organization_id IS NULL;
UPDATE users SET role_id = 1 WHERE role_id IS NULL;
UPDATE users SET organization_id = 1 WHERE organization_id IS NULL;
```

---

## Conclusion

**Overall Risk Assessment**: **MEDIUM-HIGH**

The schema differences are significant but mostly fixable. The main risks are:

1. ✅ **SAFE**: Adding missing columns to SQLite
2. ⚠️ **NEEDS ATTENTION**: NOT NULL constraint violations
3. ⚠️ **NEEDS ATTENTION**: Date format conversion
4. ✅ **SAFE**: Primary key syntax differences (cosmetic)

**Recommendation**: Proceed with fixes, but:
1. Test thoroughly in development
2. Backup database before migration
3. Implement fixes in phases
4. Monitor sync logs after deployment
