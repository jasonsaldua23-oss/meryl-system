-- Migration: Set default reorder_level to 0 for products and inventory
-- Prevents premature low stock / out of stock notifications on newly added products before stock-in

-- 1. Update column defaults so new records default to 0
ALTER TABLE IF EXISTS product ALTER COLUMN reorder_level SET DEFAULT 0;
ALTER TABLE IF EXISTS inventory ALTER COLUMN reorder_level SET DEFAULT 0;

-- 2. Update existing products and unstocked inventory records that defaulted to 5
UPDATE inventory 
SET reorder_level = 0 
WHERE reorder_level = 5 AND stock_quantity = 0;

UPDATE product 
SET reorder_level = 0 
WHERE reorder_level = 5 
  AND NOT EXISTS (
    SELECT 1 FROM inventory 
    WHERE inventory.product_id = product.product_id 
      AND inventory.stock_quantity > 0
  );
