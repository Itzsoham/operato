-- Column-level grants for every remaining AI-readable table, mirroring the treatment
-- "Customer" and "Staff" already have.
--
-- Every one of these tables was full-table GRANTed in the original bootstrap
-- (..._rls_and_ai_grants), and src/lib/ai/schema-context.ts has always exposed only a
-- curated SUBSET of each table's real columns to the model's prompt. An sql-safety-reviewer
-- audit pointed out that a prompt-level omission is not a database boundary, and found two
-- concrete consequences on this codebase specifically:
--
--   1. "Restaurant" carries razorpayCustomerId, razorpaySubscriptionId, planExpiresAt and
--      orderSeq — none of them in the prompt, all of them camelCase, so today the ONLY
--      thing stopping a model query from reading them is sql-guard.ts's quoted-identifier
--      ALLOWLIST. That is real protection, but it is a single point of failure for these
--      specific columns: relax the allowlist for any reason (an alias-quoting fix, say)
--      and they are silently reachable again.
--   2. Several tables carry plain lowercase columns — "Order"."notes", "Shift"."notes",
--      "OrderItem"."notes", "MenuItem"."image", "Restaurant"."logo" — which need NO quoting
--      at all to reference, so the allowlist (which only inspects double-quoted
--      identifiers) never sees them. "notes" fields are free text a staff member typed,
--      and reading them into a prose prompt is a durable prompt-injection channel schema-
--      context.ts already avoids on every table it curates by hand.
--
-- Matching the grant to the prompt everywhere removes both: the boundary stops depending on
-- the allowlist for columns that were never meant to be readable at all, on every table at
-- once, the same way "Customer" and "Staff" already work.

-- Restaurant: id, name, slug, timezone, currency, plan, createdAt
REVOKE SELECT ON "Restaurant" FROM operato_ai_ro;
GRANT SELECT ("id", "name", "slug", "timezone", "currency", "plan", "createdAt")
  ON "Restaurant" TO operato_ai_ro;

-- MenuCategory: id, restaurantId, name, sortOrder, createdAt
REVOKE SELECT ON "MenuCategory" FROM operato_ai_ro;
GRANT SELECT ("id", "restaurantId", "name", "sortOrder", "createdAt")
  ON "MenuCategory" TO operato_ai_ro;

-- MenuItem: id, restaurantId, categoryId, name, description, price, isAvailable, isVeg,
-- preparationTime, createdAt  (withholds: image, sortOrder, updatedAt)
REVOKE SELECT ON "MenuItem" FROM operato_ai_ro;
GRANT SELECT (
  "id", "restaurantId", "categoryId", "name", "description", "price",
  "isAvailable", "isVeg", "preparationTime", "createdAt"
) ON "MenuItem" TO operato_ai_ro;

-- RestaurantTable: id, restaurantId, number, label, capacity, status
REVOKE SELECT ON "RestaurantTable" FROM operato_ai_ro;
GRANT SELECT ("id", "restaurantId", "number", "label", "capacity", "status")
  ON "RestaurantTable" TO operato_ai_ro;

-- Order: id, restaurantId, orderNumber, tableId, customerId, status, type, subtotal, tax,
-- discount, totalAmount, servedAt, paidAt, createdAt  (withholds: notes, updatedAt)
REVOKE SELECT ON "Order" FROM operato_ai_ro;
GRANT SELECT (
  "id", "restaurantId", "orderNumber", "tableId", "customerId", "status", "type",
  "subtotal", "tax", "discount", "totalAmount", "servedAt", "paidAt", "createdAt"
) ON "Order" TO operato_ai_ro;

-- OrderItem: id, orderId, restaurantId, menuItemId, quantity, unitPrice, totalPrice,
-- status, createdAt  (withholds: notes)
REVOKE SELECT ON "OrderItem" FROM operato_ai_ro;
GRANT SELECT (
  "id", "orderId", "restaurantId", "menuItemId", "quantity", "unitPrice", "totalPrice",
  "status", "createdAt"
) ON "OrderItem" TO operato_ai_ro;

-- InventoryItem: id, restaurantId, menuItemId, name, unit, currentStock, lowStockThreshold,
-- costPerUnit, supplier, createdAt  (withholds: updatedAt)
REVOKE SELECT ON "InventoryItem" FROM operato_ai_ro;
GRANT SELECT (
  "id", "restaurantId", "menuItemId", "name", "unit", "currentStock", "lowStockThreshold",
  "costPerUnit", "supplier", "createdAt"
) ON "InventoryItem" TO operato_ai_ro;

-- InventoryTransaction: id, inventoryItemId, restaurantId, type, quantity, delta,
-- balanceAfter, seq, createdAt  (withholds: userId, notes)
REVOKE SELECT ON "InventoryTransaction" FROM operato_ai_ro;
GRANT SELECT (
  "id", "inventoryItemId", "restaurantId", "type", "quantity", "delta", "balanceAfter",
  "seq", "createdAt"
) ON "InventoryTransaction" TO operato_ai_ro;

-- Shift: id, staffId, restaurantId, startTime, endTime, hoursWorked, createdAt
-- (withholds: notes)
REVOKE SELECT ON "Shift" FROM operato_ai_ro;
GRANT SELECT ("id", "staffId", "restaurantId", "startTime", "endTime", "hoursWorked", "createdAt")
  ON "Shift" TO operato_ai_ro;

-- Verify (must return exactly the AI_TABLES column lists in src/lib/ai/schema-context.ts,
-- table by table):
--   SELECT table_name, column_name
--     FROM information_schema.column_privileges
--    WHERE grantee = 'operato_ai_ro' AND privilege_type = 'SELECT'
--    ORDER BY table_name, column_name;
