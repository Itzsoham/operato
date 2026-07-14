/*
  Warnings:

  - A unique constraint covering the columns `[id,restaurantId]` on the table `Customer` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[menuItemId,restaurantId]` on the table `InventoryItem` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[id,restaurantId]` on the table `InventoryItem` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[id,restaurantId]` on the table `MenuCategory` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[id,restaurantId]` on the table `MenuItem` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[id,restaurantId]` on the table `Order` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[id,restaurantId]` on the table `RestaurantTable` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[id,restaurantId]` on the table `Staff` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "InventoryItem" DROP CONSTRAINT "InventoryItem_menuItemId_fkey";

-- DropForeignKey
ALTER TABLE "InventoryTransaction" DROP CONSTRAINT "InventoryTransaction_inventoryItemId_fkey";

-- DropForeignKey
ALTER TABLE "MenuItem" DROP CONSTRAINT "MenuItem_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "Order" DROP CONSTRAINT "Order_customerId_fkey";

-- DropForeignKey
ALTER TABLE "Order" DROP CONSTRAINT "Order_tableId_fkey";

-- DropForeignKey
ALTER TABLE "OrderItem" DROP CONSTRAINT "OrderItem_menuItemId_fkey";

-- DropForeignKey
ALTER TABLE "OrderItem" DROP CONSTRAINT "OrderItem_orderId_fkey";

-- DropForeignKey
ALTER TABLE "Shift" DROP CONSTRAINT "Shift_staffId_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "Customer_id_restaurantId_key" ON "Customer"("id", "restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_menuItemId_restaurantId_key" ON "InventoryItem"("menuItemId", "restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_id_restaurantId_key" ON "InventoryItem"("id", "restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "MenuCategory_id_restaurantId_key" ON "MenuCategory"("id", "restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "MenuItem_id_restaurantId_key" ON "MenuItem"("id", "restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_id_restaurantId_key" ON "Order"("id", "restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "RestaurantTable_id_restaurantId_key" ON "RestaurantTable"("id", "restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_id_restaurantId_key" ON "Staff"("id", "restaurantId");

-- AddForeignKey
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_categoryId_restaurantId_fkey" FOREIGN KEY ("categoryId", "restaurantId") REFERENCES "MenuCategory"("id", "restaurantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_tableId_restaurantId_fkey" FOREIGN KEY ("tableId", "restaurantId") REFERENCES "RestaurantTable"("id", "restaurantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_restaurantId_fkey" FOREIGN KEY ("customerId", "restaurantId") REFERENCES "Customer"("id", "restaurantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_restaurantId_fkey" FOREIGN KEY ("orderId", "restaurantId") REFERENCES "Order"("id", "restaurantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_menuItemId_restaurantId_fkey" FOREIGN KEY ("menuItemId", "restaurantId") REFERENCES "MenuItem"("id", "restaurantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_menuItemId_restaurantId_fkey" FOREIGN KEY ("menuItemId", "restaurantId") REFERENCES "MenuItem"("id", "restaurantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_inventoryItemId_restaurantId_fkey" FOREIGN KEY ("inventoryItemId", "restaurantId") REFERENCES "InventoryItem"("id", "restaurantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_staffId_restaurantId_fkey" FOREIGN KEY ("staffId", "restaurantId") REFERENCES "Staff"("id", "restaurantId") ON DELETE CASCADE ON UPDATE CASCADE;
