-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('PENDING', 'MATCHED', 'UNMATCHED', 'AMOUNT_DIFFERENCE', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "meta_ad_accounts" (
    "id" UUID NOT NULL,
    "meta_account_id" TEXT NOT NULL,
    "meta_object_id" TEXT,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "timezone_name" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_synced_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "meta_ad_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta_transactions" (
    "id" UUID NOT NULL,
    "meta_account_id" TEXT NOT NULL,
    "meta_transaction_id" TEXT,
    "account_name" TEXT NOT NULL,
    "transaction_date" DATE NOT NULL,
    "event_time" TIMESTAMPTZ(3) NOT NULL,
    "currency" TEXT NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "payment_method" TEXT,
    "last_four" TEXT,
    "payment_method_changed" BOOLEAN NOT NULL DEFAULT false,
    "reconciliation_status" "ReconciliationStatus" NOT NULL DEFAULT 'PENDING',
    "reconciliation_observation" TEXT,
    "raw_data" JSONB,
    "synced_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "meta_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_runs" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'RUNNING',
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "records_received" INTEGER NOT NULL DEFAULT 0,
    "records_created" INTEGER NOT NULL DEFAULT 0,
    "records_updated" INTEGER NOT NULL DEFAULT 0,
    "records_failed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "meta_ad_accounts_meta_account_id_key" ON "meta_ad_accounts"("meta_account_id");
CREATE UNIQUE INDEX "meta_transactions_external_event_key" ON "meta_transactions"("meta_account_id", "meta_transaction_id", "event_time");
CREATE INDEX "meta_transactions_date_idx" ON "meta_transactions"("transaction_date");
CREATE INDEX "meta_transactions_currency_idx" ON "meta_transactions"("currency");
CREATE INDEX "meta_transactions_reconciliation_idx" ON "meta_transactions"("reconciliation_status");
CREATE INDEX "sync_runs_source_period_idx" ON "sync_runs"("source", "year", "month");
CREATE INDEX "sync_runs_status_idx" ON "sync_runs"("status");

-- AddForeignKey
ALTER TABLE "meta_transactions"
ADD CONSTRAINT "meta_transactions_meta_account_id_fkey"
FOREIGN KEY ("meta_account_id") REFERENCES "meta_ad_accounts"("meta_account_id")
ON DELETE RESTRICT ON UPDATE CASCADE;
