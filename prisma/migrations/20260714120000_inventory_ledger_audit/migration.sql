-- Inventory ledger: a SIGNED delta, an actor, and a real apply order.
--
-- WHY `delta`. The ledger recorded `quantity` as a positive magnitude plus a `type`. For
-- STOCK_IN/STOCK_OUT/WASTE the sign is implied by the type — but an ADJUSTMENT of +3kg (a
-- recount found more) and one of -3kg (a shrinkage write-off) both store
-- `quantity = 3, type = ADJUSTMENT` and are BYTE-IDENTICAL. The only signed sum anyone
-- could write over this table --
--
--     CASE WHEN type IN ('STOCK_OUT','WASTE') THEN -quantity ELSE quantity END
--
-- -- reads a 3kg LOSS as a 3kg GAIN: wrong by twice the delta, in the wrong direction.
-- The text-to-SQL feature (the entire point of the product) will write SUM() over this
-- table, and a reconciliation job would silently agree with it.
--
-- With a signed `delta` the invariant is one query and no CASE:
--     SUM(delta) = InventoryItem."currentStock"
--
-- Note the three steps: ADD NULLABLE -> BACKFILL -> SET NOT NULL. Adding it NOT NULL
-- outright (which is what `prisma migrate diff` generates) fails on every existing row.

-- 1. delta, nullable for the moment ------------------------------------------
ALTER TABLE "InventoryTransaction" ADD COLUMN "delta" DECIMAL(10,3);

-- 2. Backfill the sign from the type.
--
-- Exact for every row that exists today: the seed emits only STOCK_IN / STOCK_OUT /
-- WASTE, so there is not a single ADJUSTMENT whose sign has been lost. Had there been,
-- the sign would only have been recoverable by differencing consecutive balanceAfter
-- rows — which is the whole reason this column exists.
UPDATE "InventoryTransaction"
   SET "delta" = CASE
     WHEN "type" IN ('STOCK_OUT', 'WASTE') THEN -"quantity"
     ELSE "quantity"
   END
 WHERE "delta" IS NULL;

-- 3. Now it can be required.
ALTER TABLE "InventoryTransaction" ALTER COLUMN "delta" SET NOT NULL;

-- 4. WHO moved the stock -----------------------------------------------------
-- An audit trail that records what and when but not who does not answer the question it
-- exists for. Nullable + SET NULL: a staff member leaving must not erase the history of
-- what they did.
ALTER TABLE "InventoryTransaction" ADD COLUMN "userId" TEXT;

ALTER TABLE "InventoryTransaction"
  ADD CONSTRAINT "InventoryTransaction_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. Apply order -------------------------------------------------------------
-- `createdAt` is TIMESTAMP(3): two movements in the same millisecond tie, and the ledger
-- then renders its balances out of order and looks broken even though the data is right.
-- Worse, the column default is CURRENT_TIMESTAMP = TRANSACTION START time, which under a
-- FOR UPDATE queue is not apply order at all. A sequence is allocated at INSERT, which
-- under the item's row lock IS the order the movements were applied in.
ALTER TABLE "InventoryTransaction" ADD COLUMN "seq" BIGSERIAL NOT NULL;

-- 6. Indexes -----------------------------------------------------------------
-- Both the ledger read and the velocity subquery walk ONE item's movements. Without this
-- they heap-fetch every transaction that item has ever had.
CREATE INDEX "InventoryTransaction_inventoryItemId_seq_idx"
    ON "InventoryTransaction" ("inventoryItemId", "seq");

-- Two "Chicken" rows would split the ledger in half and make "how much chicken do we
-- have" ambiguous — to the reorder list, and to the AI answering it.
CREATE UNIQUE INDEX "InventoryItem_restaurantId_name_key"
    ON "InventoryItem" ("restaurantId", "name");

-- 7. The AI role can read the new columns (it holds an explicit allowlist, not a blanket
--    grant — see the RLS migration). No new table, so no new GRANT is needed; the
--    existing table-level SELECT covers added columns.
