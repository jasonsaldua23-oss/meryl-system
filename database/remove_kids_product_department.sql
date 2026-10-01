-- Run once in the Supabase SQL Editor.
-- Kids is no longer a product department. Normalize every existing product to
-- one of the three supported values; retired/unknown values become Unisex.
update public.product
set gender = case
    when lower(trim(coalesce(gender, ''))) in ('male', 'man', 'men', 'mens', 'men''s') then 'Men'
    when lower(trim(coalesce(gender, ''))) in ('female', 'woman', 'women', 'womens', 'women''s', 'ladies') then 'Women'
    else 'Unisex'
  end,
  updated_at = now()
where gender is distinct from case
    when lower(trim(coalesce(gender, ''))) in ('male', 'man', 'men', 'mens', 'men''s') then 'Men'
    when lower(trim(coalesce(gender, ''))) in ('female', 'woman', 'women', 'womens', 'women''s', 'ladies') then 'Women'
    else 'Unisex'
  end;

-- Enforce the supported departments for all new and updated product records.
alter table public.product
  drop constraint if exists product_department_allowed;

alter table public.product
  add constraint product_department_allowed
  check (gender is null or gender in ('Men', 'Women', 'Unisex'));
