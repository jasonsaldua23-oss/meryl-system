-- ==============================================================================
-- MERYL SHOES SYSTEM - PRODUCT CATEGORIES, BRANDS AND DEPARTMENTS
-- Run in the Supabase SQL Editor. Safe to run more than once.
--
-- Puts every product in the category it is sold as in the market, fixes brands,
-- fills in missing departments (Men / Women / Kids / Unisex), and removes the
-- "Sport Shoes" category plus the "Kid", "Men", "Women" rows that were created
-- as categories (those are departments, stored on product.gender).
--
-- Categories used:
--   Running Shoes    performance / road running models
--   Basketball Shoes signature basketball models (LeBron, Kobe, Jordan)
--   Casual Shoes     lifestyle sneakers, canvas, walking and slip-ons
--   Formal Shoes     school shoes, dress flats, boat shoes (Topsider, Alex)
--   Sandals          sandals, slides and slippers (Sandugo, Manjaru)
--
-- The last query lists the result so it can be checked.
-- ==============================================================================

begin;

set search_path to public, extensions;

-- 1. The five categories -------------------------------------------------------
insert into public.category (category_name)
select name
from (values ('Running Shoes'), ('Basketball Shoes'), ('Casual Shoes'), ('Formal Shoes'), ('Sandals')) as v(name)
where not exists (select 1 from public.category c where lower(trim(c.category_name)) = lower(v.name));

-- 2. Brand fixes ---------------------------------------------------------------
-- Air Jordan is sold under the Jordan brand.
update public.product set brand = 'Jordan'
where lower(product_name) like '%jordan%' and coalesce(brand, '') <> 'Jordan';
-- Models whose name starts with the brand but the brand field is empty.
update public.product p set brand = b.brand
from (values ('adidas', 'Adidas'), ('nike', 'Nike'), ('puma', 'Puma'), ('alex', 'Alex'), ('c-speed', 'C-Speed'),
             ('flamingos', 'Flamingos'), ('la bucks', 'LA Bucks'), ('mstyle', 'MStyle'), ('rocco', 'Rocco'),
             ('shoefit', 'Shoefit'), ('shoelyns', 'Shoelyns'), ('ultra lite', 'Ultra Lite'), ('venus', 'Venus'),
             ('sandugo', 'Sandugo'), ('manjaru', 'Manjaru'), ('topsider', 'Topsider')) as b(prefix, brand)
where lower(p.product_name) like b.prefix || ' %'
  and (p.brand is null or trim(p.brand) = '' or lower(p.brand) in ('n/a', 'na', 'none', 'default'));

-- 3. Category by model (first match wins) -------------------------------------
with rules as (
  select p.product_id,
    case
      -- Signature basketball models
      when lower(p.product_name) ~ '(lebron|kobe|jordan)' then 'Basketball Shoes'
      -- Sandals / slides / slippers, and the sandal brands
      when lower(p.product_name) ~ '(sandal|slide|slipper|flip ?flop)' or lower(coalesce(p.brand, '')) in ('sandugo', 'manjaru') then 'Sandals'
      -- School shoes, dress flats, boat shoes, oxfords, loafers
      when lower(p.product_name) ~ '(school|elegant|chic|oxford|loafer|derby|formal|dress|topsider|boat)'
        or lower(coalesce(p.brand, '')) = 'topsider' then 'Formal Shoes'
      -- Lifestyle lines that carry running-sounding names
      when lower(p.product_name) ~ '(air max|air force|airforce|court|tanjun|wearallday|gazelle|speedcat|dunk|advantage|hoops|air band)' then 'Casual Shoes'
      -- Performance / running models
      when lower(p.product_name) ~ '(run|racer|duramo|galaxy|ultraboost|downshifter|revolution|zoom fly|flex experience|mesh|sport|active flex|flex street|power flex|flex pro|urban flex)' then 'Running Shoes'
      -- Canvas, walking, comfort and slip-on styles
      else 'Casual Shoes'
    end as category_name
  from public.product p
)
update public.product p
set category_id = c.category_id, updated_at = now()
from rules r
join public.category c on lower(trim(c.category_name)) = lower(r.category_name)
where p.product_id = r.product_id
  and p.category_id is distinct from c.category_id;

-- 4. Department (product.gender) ------------------------------------------------
-- Kids: EU size 34 and below. Signature basketball: Men. Women's brands and
-- dress flats: Women. Anything else still empty: Unisex.
update public.product
set gender = 'Kids', updated_at = now()
where coalesce(nullif(regexp_replace(coalesce(size, ''), '[^0-9.]', '', 'g'), '')::numeric, 99) <= 34
  and coalesce(gender, '') <> 'Kids';

update public.product
set gender = case
    when lower(product_name) ~ '(lebron|kobe|jordan)' then 'Men'
    when lower(coalesce(brand, '')) in ('venus', 'flamingos') or lower(product_name) ~ '(elegant flat|chic)' then 'Women'
    else 'Unisex'
  end,
  updated_at = now()
where (gender is null or trim(gender) = '' or lower(gender) in ('n/a', 'na', 'none', 'default', 'unknown'))
  and coalesce(nullif(regexp_replace(coalesce(size, ''), '[^0-9.]', '', 'g'), '')::numeric, 99) > 34;

-- Tidy spelling of existing departments.
update public.product set gender = initcap(lower(trim(gender)))
where gender is not null and lower(trim(gender)) in ('men', 'women', 'kids', 'unisex') and gender <> initcap(lower(trim(gender)));
update public.product set gender = 'Kids' where lower(trim(gender)) in ('kid', 'children', 'child', 'boys', 'girls');
update public.product set gender = 'Men' where lower(trim(gender)) in ('male', 'man', 'mens', 'men''s');
update public.product set gender = 'Women' where lower(trim(gender)) in ('female', 'woman', 'womens', 'women''s', 'ladies');

-- 5. Remove "Sport Shoes" and the department rows that were saved as categories.
-- Products were all moved in step 3. Promotions that targeted one of these
-- categories are reported in the Messages tab so their target can be updated.
do $$
declare
  r record;
begin
  for r in
    select promo_name, target_products from public.promotion
    where target_products ~* 'categor[a-z]*:.*(sports? shoes|\mkids?\M|\mmen\M|\mwomen\M)'
  loop
    raise notice 'Update the target of promotion "%": %', r.promo_name, r.target_products;
  end loop;
end $$;

delete from public.category c
where lower(trim(c.category_name)) in ('sport shoes', 'sports shoes', 'sport', 'sports', 'kid', 'kids', 'men', 'women')
  and not exists (select 1 from public.product p where p.category_id = c.category_id);

commit;

-- Result: models per category, brand and department.
select c.category_name, p.brand, p.gender as department, count(distinct lower(p.product_name)) as models, count(*) as variants
from public.product p
left join public.category c on c.category_id = p.category_id
group by 1, 2, 3
order by 1, 2, 3;
