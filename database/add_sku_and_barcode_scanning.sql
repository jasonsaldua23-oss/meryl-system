-- ==============================================================================
-- Migration: Add SKU Column, Unique Index, Sequence, and Auto-Generation Trigger
-- Meryl Shoes POS-Driven Inventory System
-- ==============================================================================

-- 1. Add sku column to public.product if not already present
ALTER TABLE public.product 
ADD COLUMN IF NOT EXISTS sku VARCHAR(32);

-- 2. Create sequential sequence for stable, human-readable SKUs (e.g., MS-000001)
CREATE SEQUENCE IF NOT EXISTS public.product_sku_seq
  START WITH 1
  INCREMENT BY 1
  MINVALUE 1
  NO MAXVALUE
  CACHE 1;

-- 3. Backfill all existing product variants with sequential SKUs (MS-000001, MS-000002, ...)
-- Deterministically ordered by creation timestamp and product_id
DO $$
DECLARE
  v_prod RECORD;
  v_seq_val BIGINT;
BEGIN
  FOR v_prod IN 
    SELECT product_id 
    FROM public.product 
    WHERE sku IS NULL OR TRIM(sku) = ''
    ORDER BY created_at ASC, product_id ASC
  LOOP
    v_seq_val := nextval('public.product_sku_seq');
    UPDATE public.product
    SET sku = 'MS-' || LPAD(v_seq_val::TEXT, 6, '0')
    WHERE product_id = v_prod.product_id;
  END LOOP;
END $$;

-- Align sequence to start after the highest existing SKU
DO $$
DECLARE
  v_max_num INT;
BEGIN
  SELECT COALESCE(MAX(SUBSTRING(sku FROM 'MS-([0-9]+)')::INT), 0)
  INTO v_max_num
  FROM public.product
  WHERE sku ~ '^MS-[0-9]+$';

  IF v_max_num > 0 THEN
    PERFORM setval('public.product_sku_seq', v_max_num);
  END IF;
END $$;

-- 4. Case-insensitive trimmed unique index on non-empty SKU
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_sku_unique 
ON public.product (LOWER(TRIM(sku))) 
WHERE sku IS NOT NULL AND TRIM(sku) <> '';

-- 5. Trigger function to automatically assign sequential SKU to new product variants
CREATE OR REPLACE FUNCTION public.trg_product_generate_sku()
RETURNS TRIGGER AS $$
BEGIN
  -- If SKU is not provided or empty, auto-generate next sequential SKU
  IF NEW.sku IS NULL OR TRIM(NEW.sku) = '' THEN
    NEW.sku := 'MS-' || LPAD(nextval('public.product_sku_seq')::TEXT, 6, '0');
  ELSE
    -- Normalize provided SKU: uppercase and trimmed
    NEW.sku := UPPER(TRIM(NEW.sku));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach BEFORE INSERT trigger
DROP TRIGGER IF EXISTS trg_product_generate_sku ON public.product;
CREATE TRIGGER trg_product_generate_sku
BEFORE INSERT ON public.product
FOR EACH ROW
EXECUTE FUNCTION public.trg_product_generate_sku();

-- 6. Add comment for database documentation and audit
COMMENT ON COLUMN public.product.sku IS 'Unique Stock Keeping Unit (e.g., MS-000001) identifying each exact product variant (model, color, size). Encoded on Code 128 barcode labels.';

