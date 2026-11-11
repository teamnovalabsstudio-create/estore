-- Constraints and indexes Prisma's schema language can't express.

-- ── Stock invariants: the last line of defence against overselling ──
ALTER TABLE "ProductVariant"
  ADD CONSTRAINT "ProductVariant_stock_nonnegative"
    CHECK ("stockOnHand" >= 0 AND "stockReserved" >= 0 AND "stockReserved" <= "stockOnHand"),
  ADD CONSTRAINT "ProductVariant_money_nonnegative"
    CHECK ("pricePaisa" >= 0 AND "costPaisa" >= 0 AND ("compareAtPaisa" IS NULL OR "compareAtPaisa" >= 0));

ALTER TABLE "Coupon"
  ADD CONSTRAINT "Coupon_usage_within_limit"
    CHECK ("usedCount" >= 0 AND ("usageLimit" IS NULL OR "usedCount" <= "usageLimit"));

ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_totals_nonnegative"
    CHECK ("subtotalPaisa" >= 0 AND "discountPaisa" >= 0 AND "shippingPaisa" >= 0
           AND "codFeePaisa" >= 0 AND "totalPaisa" >= 0);

-- ── Search: trigram for fuzzy/prefix matches, tsvector for ranked full-text ──
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "Product_title_trgm_idx" ON "Product" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "ProductVariant_sku_trgm_idx" ON "ProductVariant" USING GIN ("sku" gin_trgm_ops);
CREATE INDEX "Product_searchVector_idx" ON "Product" USING GIN ("searchVector");

CREATE OR REPLACE FUNCTION product_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW."searchVector" :=
      setweight(to_tsvector('simple', coalesce(NEW."title", '')), 'A')
   || setweight(to_tsvector('simple', coalesce(NEW."brand", '')), 'B')
   || setweight(to_tsvector('simple', array_to_string(coalesce(NEW."tags", '{}'), ' ')), 'B')
   || setweight(to_tsvector('simple', coalesce(NEW."description", '')), 'C');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Product_searchVector_trg"
  BEFORE INSERT OR UPDATE OF "title", "brand", "tags", "description" ON "Product"
  FOR EACH ROW EXECUTE FUNCTION product_search_vector_update();
