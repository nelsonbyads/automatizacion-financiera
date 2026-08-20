-- Historical billing activities must not inherit the Ad Account's current/default card.
-- Store transaction-scoped payment metadata separately and keep the account default only as reference.
ALTER TABLE "meta_transactions"
  ADD COLUMN "payment_method_source" TEXT,
  ADD COLUMN "payment_status" TEXT,
  ADD COLUMN "invoice_id" TEXT,
  ADD COLUMN "account_default_payment_method" TEXT,
  ADD COLUMN "account_default_last_four" TEXT;

CREATE INDEX "meta_transactions_last_four_idx" ON "meta_transactions"("last_four");
CREATE INDEX "meta_transactions_payment_status_idx" ON "meta_transactions"("payment_status");
