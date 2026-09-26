-- ==============================================================================
-- MERYL SHOES SYSTEM - PHASE 5: SERVER-VALIDATED DISCOUNTS
-- Run in the Supabase SQL Editor AFTER security_phase4_session_enforcement.sql
-- and after the matching frontend is live.
--
-- Manuscript references:
--   * POS use case, Steps 2-3: "checks active promotion records ... applies valid
--     promotional discounts ... links promo_id".
--   * White-box tests TC-WSec003..006: discounts above 20% require a manager
--     override (administrator credentials, temporary override token); an
--     administrator at the POS is not prompted; up to 20% applies directly.
--   * Objective 3.1 functional suitability / 3.6 security (ISO 25010).
--
-- What changes:
--   * complete_sale validates every discounted line:
--       - with promo_id: the promotion must be live now, target the product and
--         allow at least that discount (bundle needs 2+ bundled products);
--       - without promo_id (manual): up to 20%, or more with a valid one-time
--         manager override token (administrators are exempt);
--     and stores promo_id on sales_details (exact promotion reporting).
--   * authorize_discount_override(username, password) issues that token.
-- ==============================================================================

begin;

set search_path to public, extensions;

alter table public.promotion add column if not exists target_products text;
alter table public.sales_details add column if not exists promo_id uuid;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sales_details_promo_id_fkey'
  ) then
    alter table public.sales_details
      add constraint sales_details_promo_id_fkey
      foreign key (promo_id) references public.promotion(promo_id) on delete set null;
  end if;
end $$;

-- ------------------------------------------------------------------------------
-- 1. Manager override tokens (temporary, single use, bound to the cashier)
-- ------------------------------------------------------------------------------
create table if not exists public.discount_override (
  override_id uuid primary key default gen_random_uuid(),
  cashier_user_id uuid not null references public."user"(user_id) on delete cascade,
  manager_user_id uuid not null references public."user"(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_sales_id uuid
);
alter table public.discount_override enable row level security;
revoke all on table public.discount_override from public, anon, authenticated;

create or replace function public.authorize_discount_override(p_username text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cashier uuid := public.app_current_user_id();
  v_manager jsonb;
  v_override uuid;
  v_expires timestamptz := now() + interval '15 minutes';
begin
  if v_cashier is null then
    raise exception 'Your session has expired. Please sign in again.';
  end if;
  -- Verify credentials without creating a session for the manager.
  v_manager := public.login_user(p_username, p_password, false);
  if v_manager is null or v_manager ? 'error' then
    raise exception 'Invalid manager credentials.';
  end if;
  if public.app_role_group(v_manager ->> 'role_name') <> 'admin' then
    raise exception 'Authorization failed. Administrator or Manager credentials required.';
  end if;

  insert into public.discount_override (cashier_user_id, manager_user_id, expires_at)
  values (v_cashier, (v_manager ->> 'user_id')::uuid, v_expires)
  returning override_id into v_override;

  insert into public.audit_log (actor_user_id, action_type, entity_type, entity_id, metadata)
  values (v_cashier, 'POS_MANAGER_OVERRIDE', 'POS', v_override::text,
          jsonb_build_object('manager_user_id', v_manager ->> 'user_id', 'manager', v_manager ->> 'username', 'reason', 'discount_above_20_percent'));

  return jsonb_build_object(
    'override_id', v_override,
    'manager_name', v_manager ->> 'name',
    'expires_at', v_expires
  );
end;
$$;

-- ------------------------------------------------------------------------------
-- 2. Promotion rules (same as the frontend's promotion-rules.ts)
-- ------------------------------------------------------------------------------
-- Promotion times are store wall-clock times stored with a "+00" suffix; read
-- the wall-clock part. Date-only values cover the whole day.
create or replace function public.app_promotion_wallclock(p_value text, p_is_end boolean)
returns timestamp
language sql
immutable
as $$
  select case
    when p_value is null or trim(p_value) = '' then null
    when trim(p_value) ~ '^\d{4}-\d{2}-\d{2}$' then
      case when p_is_end then trim(p_value)::date + interval '1 day' - interval '1 millisecond'
           else trim(p_value)::date::timestamp end
    else
      case when p_is_end then left(replace(trim(p_value), 'T', ' '), 16)::timestamp + interval '59.999 seconds'
           else left(replace(trim(p_value), 'T', ' '), 16)::timestamp end
  end
$$;

-- Largest discount percent a live promotion allows for this product line,
-- or NULL when the promotion is not running or does not cover the product.
create or replace function public.app_promotion_allowed_percent(
  p_promo_id uuid,
  p_product_id uuid,
  p_price numeric,
  p_qty integer
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_promo record;
  v_now timestamp := (now() at time zone 'Asia/Manila');
  v_name text;
  v_category text;
  v_target text;
  v_segment text;
  v_products text[] := '{}';
  v_categories text[] := '{}';
  v_kind text;
  v_value numeric;
  v_matches boolean;
begin
  select * into v_promo from public.promotion where promo_id = p_promo_id;
  if not found then
    return null;
  end if;
  if lower(coalesce(v_promo.status, '')) in ('inactive', 'deactivated') then
    return null;
  end if;
  if v_now < coalesce(public.app_promotion_wallclock(v_promo.start_date::text, false), '-infinity'::timestamp)
     or v_now > coalesce(public.app_promotion_wallclock(v_promo.end_date::text, true), 'infinity'::timestamp) then
    return null;
  end if;

  select lower(trim(p.product_name)), lower(trim(coalesce(c.category_name, '')))
  into v_name, v_category
  from public.product p
  left join public.category c on c.category_id = p.category_id
  where p.product_id = p_product_id;

  v_target := trim(coalesce(v_promo.target_products, ''));
  if v_target = '' then
    -- No target text: linked products, or everything when there are none.
    if exists (select 1 from public.promo_product where promo_id = p_promo_id) then
      v_matches := exists (
        select 1 from public.promo_product pp
        join public.product p on p.product_id = pp.product_id
        where pp.promo_id = p_promo_id and lower(trim(p.product_name)) = v_name
      );
    else
      v_matches := true;
    end if;
  elsif lower(v_target) = 'all products' then
    v_matches := true;
  else
    foreach v_segment in array regexp_split_to_array(v_target, '\|') loop
      v_segment := trim(v_segment);
      if lower(v_segment) like 'categories:%' then
        v_categories := v_categories || array(
          select lower(trim(x)) from unnest(string_to_array(substr(v_segment, 12), ',')) x where trim(x) <> '');
      elsif lower(v_segment) like 'products:%' then
        v_products := v_products || array(
          select lower(trim(x)) from unnest(string_to_array(substr(v_segment, 10), ',')) x where trim(x) <> '');
      elsif lower(v_segment) like '% category' then
        v_categories := v_categories || lower(trim(left(v_segment, length(v_segment) - 9)));
      elsif v_segment <> '' then
        v_products := v_products || lower(v_segment);
      end if;
    end loop;
    if cardinality(v_products) > 0 then
      v_matches := v_name = any(v_products) and (cardinality(v_categories) = 0 or v_category = any(v_categories));
    elsif cardinality(v_categories) > 0 then
      v_matches := v_category = any(v_categories);
    else
      v_matches := true;
    end if;
  end if;
  if not v_matches then
    return null;
  end if;

  v_value := coalesce(v_promo.discount_value, 0);
  v_kind := case
    when v_promo.promo_name like '%\_\_TYPE\_BOGO\_\_%' then 'bogo'
    when v_promo.promo_name like '%\_\_TYPE\_BUNDLE\_\_%' then 'bundle'
    when lower(coalesce(v_promo.discount_type, '')) like '%bogo%' then 'bogo'
    when lower(coalesce(v_promo.discount_type, '')) like '%bundle%' then 'bundle'
    when lower(coalesce(v_promo.discount_type, '')) like '%fixed%' then 'fixed'
    else 'percentage'
  end;

  return case v_kind
    when 'fixed' then least(100, case when p_price > 0 then v_value / p_price * 100 else 0 end)
    when 'bogo' then case when p_qty > 0 then floor(p_qty / 2.0) / p_qty * 100 else 0 end
    when 'bundle' then least(100, case when v_value >= 5 then v_value else 10 end)
    else least(100, greatest(0, v_value))
  end;
end;
$$;

-- ------------------------------------------------------------------------------
-- 3. complete_sale: validate discounts, store promo_id, consume overrides
-- ------------------------------------------------------------------------------
drop function if exists public.complete_sale(text, text, text, numeric, jsonb, text);
drop function if exists public.complete_sale(text, text, text, numeric, jsonb, text, uuid);

create function public.complete_sale(
  p_user_id text,          -- ignored; the cashier is the signed-in user
  p_customer_id text,
  p_payment_method text,
  p_amount_paid numeric,
  p_items jsonb,
  p_reference_number text default null,
  p_override_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_manual_limit constant numeric := 20;  -- TC-WSec004/005: above 20% needs a manager
  v_sales_id uuid := gen_random_uuid();
  v_payment_id uuid := gen_random_uuid();
  v_user_id uuid := public.app_current_user_id();
  v_is_admin boolean := public.app_is_admin();
  v_customer_id uuid;
  v_method text := lower(coalesce(nullif(trim(p_payment_method), ''), 'cash'));
  v_reference text := null;
  v_total numeric(12, 2) := 0;
  v_change numeric(12, 2);
  v_item jsonb;
  v_product_id uuid;
  v_promo_id uuid;
  v_qty integer;
  v_price numeric(12, 2);
  v_discount numeric(12, 2);
  v_allowed numeric;
  v_client_subtotal numeric;
  v_base numeric;
  v_expected numeric;
  v_subtotal numeric(12, 2);
  v_available integer;
  v_override_used boolean := false;
begin
  if v_user_id is null then
    raise exception 'Your session has expired. Please sign in again.';
  end if;

  v_customer_id := nullif(trim(coalesce(p_customer_id, '')), '')::uuid;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Cart is empty.';
  end if;

  if v_method = 'gcash' then
    v_reference := regexp_replace(coalesce(p_reference_number, ''), '\D', '', 'g');
    if v_reference !~ '^\d{13}$' then
      raise exception 'GCash Reference Number must be exactly 13 digits.';
    end if;
  end if;

  insert into public.sales_transaction (sales_id, customer_id, transaction_date, total_amount, user_id)
  values (v_sales_id, v_customer_id, now(), 0, v_user_id);

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_qty := coalesce((v_item ->> 'quantity')::integer, 0);
    v_discount := coalesce((v_item ->> 'discount_applied')::numeric, 0)::numeric(12, 2);
    v_client_subtotal := coalesce((v_item ->> 'subtotal')::numeric, -1);
    v_promo_id := case
      when coalesce(v_item ->> 'promo_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (v_item ->> 'promo_id')::uuid
      else null
    end;

    if v_product_id is null then
      raise exception 'Sale item is missing a product.';
    end if;
    if v_qty <= 0 then
      raise exception 'Sale quantity must be greater than zero.';
    end if;
    if v_discount < 0 or v_discount > 100 then
      raise exception 'Discount must be between 0 and 100 percent.';
    end if;

    select
      i.stock_quantity - coalesce(i.reserved_quantity, 0),
      coalesce(i.srp, p.cost_price, 0)::numeric(12, 2)
    into v_available, v_price
    from public.inventory i
    join public.product p on p.product_id = i.product_id
    where i.product_id = v_product_id
    for update of i;

    if v_available is null then
      raise exception 'No inventory record found for product %.', v_product_id;
    end if;
    if v_price <= 0 then
      raise exception 'Product % has no selling price set.', v_product_id;
    end if;
    if v_available < v_qty then
      raise exception 'Insufficient available stock for product %. Available: %, requested: %.',
        v_product_id, v_available, v_qty;
    end if;

    -- Discount validation.
    if v_discount > 0 then
      if v_promo_id is not null then
        v_allowed := public.app_promotion_allowed_percent(v_promo_id, v_product_id, v_price, v_qty);
        if v_allowed is null then
          raise exception 'The promotion applied to product % is not running for it right now. Please refresh the POS.', v_product_id;
        end if;
        if v_discount > v_allowed + 0.01 then
          raise exception 'A % percent discount on product % is more than its promotion allows (% percent).', v_discount, v_product_id, round(v_allowed, 2);
        end if;
        if exists (select 1 from public.promotion where promo_id = v_promo_id
                   and (promo_name like '%\_\_TYPE\_BUNDLE\_\_%' or lower(coalesce(discount_type, '')) like '%bundle%'))
           and (select count(distinct e ->> 'product_id') from jsonb_array_elements(p_items) e
                where e ->> 'promo_id' = v_item ->> 'promo_id') < 2 then
          raise exception 'A bundle discount needs at least two different bundled products in the cart.';
        end if;
      else
        v_promo_id := null;
        if v_discount > c_manual_limit and not v_is_admin then
          if p_override_id is null or not exists (
            select 1 from public.discount_override
            where override_id = p_override_id
              and cashier_user_id = v_user_id
              and used_at is null
              and expires_at > now()
          ) then
            raise exception 'Discounts above 20%% need manager approval.';
          end if;
          v_override_used := true;
        end if;
      end if;
    else
      v_promo_id := null;
    end if;

    -- The client sends a discount percent rounded to 2 decimals, so allow that
    -- rounding (0.005% of the line) plus one centavo, and nothing more.
    v_base := v_price * v_qty;
    v_expected := v_base * (1 - v_discount / 100);
    if v_client_subtotal < 0 or abs(v_client_subtotal - v_expected) > (v_base * 0.00005 + 0.01) then
      raise exception 'Price for product % has changed. Please refresh the POS and try again.', v_product_id;
    end if;
    v_subtotal := round(v_client_subtotal, 2);
    v_total := v_total + v_subtotal;

    insert into public.sales_details (
      sales_detail_id, sales_id, product_id, quantity, price, discount_applied, subtotal, promo_id
    )
    values (gen_random_uuid(), v_sales_id, v_product_id, v_qty, v_price, v_discount, v_subtotal, v_promo_id);

    update public.inventory
    set stock_quantity = stock_quantity - v_qty,
        last_updated = now()
    where product_id = v_product_id;

    insert into public.inventory_log (
      inventory_log_id, product_id, quantity_change, transaction_type, reference_id, date_updated
    )
    values (gen_random_uuid(), v_product_id, -v_qty, 'sale', v_sales_id, now());
  end loop;

  if v_total <= 0 then
    raise exception 'Sale total must be greater than zero.';
  end if;
  if coalesce(p_amount_paid, 0) < v_total then
    raise exception 'Insufficient payment amount.';
  end if;

  v_change := (coalesce(p_amount_paid, 0) - v_total)::numeric(12, 2);

  update public.sales_transaction set total_amount = v_total where sales_id = v_sales_id;

  insert into public.payment (
    payment_id, sales_id, payment_method, amount_paid, change_amount, payment_status, reference_number
  )
  values (
    v_payment_id, v_sales_id, v_method, coalesce(p_amount_paid, 0)::numeric(12, 2),
    v_change, 'completed', v_reference
  );

  if v_override_used then
    update public.discount_override
    set used_at = now(), used_sales_id = v_sales_id
    where override_id = p_override_id;
  end if;

  return jsonb_build_object(
    'sales_id', v_sales_id,
    'payment_id', v_payment_id,
    'total_amount', v_total,
    'change_amount', v_change
  );
end;
$$;

-- ------------------------------------------------------------------------------
-- 4. Privileges (phase 4 convention: SECURITY DEFINER callable only if listed)
-- ------------------------------------------------------------------------------
revoke all on function public.authorize_discount_override(text, text) from public, anon, authenticated;
revoke all on function public.app_promotion_allowed_percent(uuid, uuid, numeric, integer) from public, anon, authenticated;
revoke all on function public.complete_sale(text, text, text, numeric, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function public.authorize_discount_override(text, text) to anon, authenticated;
grant execute on function public.complete_sale(text, text, text, numeric, jsonb, text, uuid) to anon, authenticated;
grant execute on function public.app_promotion_wallclock(text, boolean) to anon, authenticated;

commit;
