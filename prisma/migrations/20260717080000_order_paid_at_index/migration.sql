-- Every Overview aggregate asks the same question: one tenant's PAID orders over a date
-- range. `Order` had (restaurantId, status) and (restaurantId, createdAt) — neither covers
-- a paidAt range, so each of the six dashboard queries seq-scanned the tenant's entire
-- order history on every load. Harmless at 6k rows; not at 100k.
--
-- Column order matters: equality columns first (restaurantId, status), the range column
-- last (paidAt), so the index can seek to the tenant's PAID rows and then walk the range.
CREATE INDEX "Order_restaurantId_status_paidAt_idx"
    ON "Order" ("restaurantId", "status", "paidAt");
