-- Store historical exchange rates used to estimate Meta charges in Colombian pesos.
-- The first supported pair is USD/COP using the official TRM published by
-- Superintendencia Financiera de Colombia.

CREATE TABLE "exchange_rates" (
    "id" UUID NOT NULL,
    "rate_date" DATE NOT NULL,
    "base_currency" TEXT NOT NULL,
    "quote_currency" TEXT NOT NULL,
    "rate" DECIMAL(20,6) NOT NULL,
    "source" TEXT NOT NULL,
    "source_url" TEXT,
    "retrieved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw_data" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "exchange_rates_date_pair_key"
ON "exchange_rates"("rate_date", "base_currency", "quote_currency");

CREATE INDEX "exchange_rates_pair_date_idx"
ON "exchange_rates"("base_currency", "quote_currency", "rate_date");
