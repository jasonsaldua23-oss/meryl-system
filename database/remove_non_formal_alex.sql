-- ==============================================================================
-- MERYL SHOES SYSTEM - REMOVE ALEX MODELS THAT ARE NOT SCHOOL / FORMAL SHOES
-- Run in the Supabase SQL Editor after recategorize_products.sql.
-- Safe to run more than once.
--
-- Alex is carried only as a school / formal shoe brand. Alex models with
-- sneaker names (Active Flex, Canvas Classic, Runner Lite, ...) are removed:
--   * never sold or replaced  -> deleted (their stock rows, stock log,
--     promotion links and analytics rows go with them)
--   * has sales or replacements -> made inactive instead, so receipts,
--     reports and replacement records stay correct
-- Kept: Alex models whose name says school or formal (e.g. Alex School Black).
-- ==============================================================================

begin;

create temporary table alex_remove on commit drop as
select p.product_id, p.product_name, p.size,
       exists (select 1 from public.sales_details d where d.product_id = p.product_id)
       or exists (select 1 from public.return_details r where r.product_id = p.product_id or r.new_product_id = p.product_id)
         as has_history
from public.product p
where lower(coalesce(p.brand, '')) = 'alex'
  and lower(p.product_name) !~ '(school|formal|oxford|loafer|derby|dress|elegant|leather)';

-- Keep the ones with history, but take them off sale.
update public.product p
set status = 'inactive', updated_at = now()
from alex_remove a
where a.product_id = p.product_id and a.has_history;

update public.inventory i
set inventory_status = 'inactive', last_updated = now()
from alex_remove a
where a.product_id = i.product_id and a.has_history;

-- Delete the ones that were never sold or replaced.
delete from public.product p
using alex_remove a
where a.product_id = p.product_id and not a.has_history;

commit;

-- Alex products left: only school / formal models should be active.
select p.product_name, coalesce(p.status, 'active') as status, count(*) as variants
from public.product p
where lower(coalesce(p.brand, '')) = 'alex'
group by 1, 2
order by 2, 1;
