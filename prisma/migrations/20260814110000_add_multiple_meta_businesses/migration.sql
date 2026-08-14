-- Add Business Manager provenance to Meta data
ALTER TABLE "meta_ad_accounts" ADD COLUMN "meta_business_id" TEXT;
ALTER TABLE "meta_transactions" ADD COLUMN "meta_business_id" TEXT;

CREATE INDEX "meta_ad_accounts_business_idx" ON "meta_ad_accounts"("meta_business_id");
CREATE INDEX "meta_transactions_business_idx" ON "meta_transactions"("meta_business_id");
