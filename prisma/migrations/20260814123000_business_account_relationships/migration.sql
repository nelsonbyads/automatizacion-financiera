-- Track each configured Meta Business independently and preserve the many-to-many
-- relationship between Business Managers and advertising accounts. This prevents
-- duplicate charges when the same ad account is shared with more than one Business.

CREATE TYPE "MetaAccountRelationship" AS ENUM ('OWNED', 'CLIENT');

CREATE TABLE "meta_businesses" (
    "id" UUID NOT NULL,
    "meta_business_id" TEXT NOT NULL,
    "name" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "accessible" BOOLEAN NOT NULL DEFAULT true,
    "last_error" TEXT,
    "last_synced_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "meta_businesses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "meta_business_accounts" (
    "id" UUID NOT NULL,
    "meta_business_id" TEXT NOT NULL,
    "meta_account_id" TEXT NOT NULL,
    "relationship" "MetaAccountRelationship" NOT NULL,
    "last_synced_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "meta_business_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "meta_businesses_meta_business_id_key" ON "meta_businesses"("meta_business_id");
CREATE INDEX "meta_businesses_active_idx" ON "meta_businesses"("active");
CREATE INDEX "meta_businesses_accessible_idx" ON "meta_businesses"("accessible");
CREATE UNIQUE INDEX "meta_business_accounts_business_account_key" ON "meta_business_accounts"("meta_business_id", "meta_account_id");
CREATE INDEX "meta_business_accounts_account_idx" ON "meta_business_accounts"("meta_account_id");
CREATE INDEX "meta_business_accounts_relationship_idx" ON "meta_business_accounts"("relationship");

ALTER TABLE "meta_business_accounts"
ADD CONSTRAINT "meta_business_accounts_business_id_fkey"
FOREIGN KEY ("meta_business_id") REFERENCES "meta_businesses"("meta_business_id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "meta_business_accounts"
ADD CONSTRAINT "meta_business_accounts_account_id_fkey"
FOREIGN KEY ("meta_account_id") REFERENCES "meta_ad_accounts"("meta_account_id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill the relationship already collected by V6. V6 only queried
-- /owned_ad_accounts, therefore the historical relationship is OWNED.
INSERT INTO "meta_businesses" (
    "id", "meta_business_id", "name", "active", "accessible",
    "last_synced_at", "created_at", "updated_at"
)
SELECT
    gen_random_uuid(),
    source."meta_business_id",
    NULL,
    true,
    true,
    MAX(source."last_synced_at"),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (
    SELECT "meta_business_id", "last_synced_at"
    FROM "meta_ad_accounts"
    WHERE "meta_business_id" IS NOT NULL

    UNION ALL

    SELECT "meta_business_id", "synced_at" AS "last_synced_at"
    FROM "meta_transactions"
    WHERE "meta_business_id" IS NOT NULL
) AS source
GROUP BY source."meta_business_id"
ON CONFLICT ("meta_business_id") DO NOTHING;

INSERT INTO "meta_business_accounts" (
    "id", "meta_business_id", "meta_account_id", "relationship",
    "last_synced_at", "created_at", "updated_at"
)
SELECT
    gen_random_uuid(),
    account."meta_business_id",
    account."meta_account_id",
    'OWNED'::"MetaAccountRelationship",
    account."last_synced_at",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "meta_ad_accounts" AS account
WHERE account."meta_business_id" IS NOT NULL
ON CONFLICT ("meta_business_id", "meta_account_id") DO NOTHING;
