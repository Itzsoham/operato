-- Backfill the order-number counter.
--
-- The migration that ADDED "orderSeq" defaulted it to 0. "Order" has existed since the
-- init migration, so ANY database that already holds orders — every dev box, staging, and
-- production at deploy time — starts the counter at zero while ORD-0001 already exists.
--
-- The first real order the app mints is then ORD-0001, the
-- @@unique([restaurantId, orderNumber]) rejects it, and the failure surfaces AT THE TILL,
-- in front of a customer. It would keep failing for ORD-0002, ORD-0003 … until the
-- counter finally walked past whatever the seed had written.
--
-- prisma/seed.ts now sets the counter itself, but a seed cannot fix a database nobody
-- re-seeds. This migration can.
--
-- regexp_replace strips the "ORD-" prefix; NULLIF guards an order number with no digits
-- at all (there are none today, but a hand-inserted row would otherwise make the whole
-- statement fail); COALESCE covers a restaurant that has never taken an order.

UPDATE "Restaurant" r
   SET "orderSeq" = COALESCE(
     (
       SELECT MAX(NULLIF(regexp_replace(o."orderNumber", '\D', '', 'g'), '')::int)
         FROM "Order" o
        WHERE o."restaurantId" = r.id
     ),
     0
   );
