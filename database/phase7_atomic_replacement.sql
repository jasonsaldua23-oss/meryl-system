-- ==============================================================================
-- MERYL SHOES SYSTEM - PHASE 7: REPLACEMENTS, STOCK-IN AND SALES CHECKS
--   process_replacement      replacement saved in one transaction
--   save_inventory_settings  stock-in added to live stock (no lost sales)
--   complete_sale            also refuses inactive / expired items
-- Run in the Supabase SQL Editor after phase6_stored_analytics_and_cleanup.sql.
-- Safe to run more than once.
--
-- Before: the Replacements page saved the replacement, its details, stock
-- changes and inventory logs as separate requests, and wrote stock as
-- "the number shown on screen +/- quantity". A sale made at the POS while the
-- page was open was then overwritten (lost stock deduction), an out-of-stock
-- replacement quietly set stock to 0, and a failure half-way left a partial
-- record.
--
-- Now process_replacement() does it all in one database transaction, changes
-- stock relative to the live value with the row locked (like complete_sale),
-- refuses a replacement pair that is not in stock, and checks that each line
-- belongs to the receipt, uses the same shoe model and does not exceed the
-- pairs bought. The signed-in staff member is recorded as the processor.
-- Store policy is enforced here too: one replacement per receipt, within
-- 7 days of purchase (Figure 27).
-- ==============================================================================

begin;

set search_path to public, extensions;

create or replace function public.process_replacement(
  p_return_id uuid,
  p_sales_id uuid,
  p_lines jsonb,
  p_receipt jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
set timezone = 'UTC'
as $$
declare
  v_user uuid := public.app_current_user_id();
  v_return_id uuid := coalesce(p_return_id, gen_random_uuid());
  v_line jsonb;
  v_returned uuid;
  v_replacement uuid;
  v_qty integer;
  v_action text;
  v_note text;
  v_sold integer;
  v_queued jsonb := '{}'::jsonb;
  v_already integer;
  v_returned_name text;
  v_replacement_name text;
  v_available integer;
  v_count integer := 0;
  v_purchased_at timestamptz;
  v_days integer;
begin
  if v_user is null then
    raise exception 'Your session has expired. Please sign in again.';
  end if;
  if not public.app_is_staff() then
    raise exception 'Only store staff can record replacements.';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Select at least one item from the receipt to replace.';
  end if;

  -- Lock the sale so two staff cannot replace the same receipt at once.
  select transaction_date::timestamptz into v_purchased_at
  from public.sales_transaction where sales_id = p_sales_id for update;
  if not found then
    raise exception 'Receipt not found.';
  end if;
  if exists (select 1 from public.returns where return_id = v_return_id) then
    raise exception 'This replacement was already saved.';
  end if;

  -- Store policy (manuscript Figure 27): one replacement per receipt, within
  -- 7 calendar days of the purchase date (store time, Asia/Manila).
  if exists (select 1 from public.returns where sales_id = p_sales_id) then
    raise exception 'This receipt already has a replacement. Only one replacement is allowed per receipt.';
  end if;
  v_days := (now() at time zone 'Asia/Manila')::date - (v_purchased_at at time zone 'Asia/Manila')::date;
  if v_days > 7 then
    raise exception 'Replacements are accepted within 7 days of purchase. This receipt is % days old.', v_days;
  end if;

  insert into public.returns (
    return_id, sales_id, user_id, return_date,
    receipt_proof_name, receipt_proof_path, receipt_proof_url, receipt_verified_at
  )
  values (
    v_return_id, p_sales_id, v_user, now(),
    nullif(p_receipt ->> 'name', ''), nullif(p_receipt ->> 'path', ''), nullif(p_receipt ->> 'url', ''),
    coalesce(nullif(p_receipt ->> 'verified_at', '')::timestamptz, now())
  );

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    begin
      v_returned := (v_line ->> 'returned_product_id')::uuid;
      v_replacement := (v_line ->> 'replacement_product_id')::uuid;
      v_qty := (v_line ->> 'quantity')::integer;
    exception when others then
      raise exception 'A replacement line is incomplete. Please re-select the items.';
    end;
    v_action := case when v_line ->> 'inventory_action' = 'Return to Stock' then 'Return to Stock'
                     else 'Defective / Not Sellable' end;
    v_note := left(coalesce(v_line ->> 'note', 'Replacement'), 250);

    if v_returned is null or v_replacement is null then
      raise exception 'A replacement line is incomplete. Please re-select the items.';
    end if;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Replacement quantity must be at least 1.';
    end if;

    -- The returned pair must be on this receipt, and not more pairs than bought.
    select coalesce(sum(quantity), 0)::integer into v_sold
    from public.sales_details where sales_id = p_sales_id and product_id = v_returned;
    select product_name into v_returned_name from public.product where product_id = v_returned;
    if v_sold = 0 then
      raise exception '% is not on this receipt.', coalesce(v_returned_name, 'The returned item');
    end if;
    v_already := coalesce((v_queued ->> v_returned::text)::integer, 0);
    if v_already + v_qty > v_sold then
      raise exception 'Only % pair(s) of % were bought on this receipt.', v_sold, v_returned_name;
    end if;
    v_queued := v_queued || jsonb_build_object(v_returned::text, v_already + v_qty);

    -- 1-to-1 exchange: same shoe model (any size or colour of it).
    select product_name into v_replacement_name from public.product where product_id = v_replacement;
    if v_replacement_name is null then
      raise exception 'The replacement item no longer exists.';
    end if;
    if lower(regexp_replace(trim(v_replacement_name), '\s+', ' ', 'g'))
       <> lower(regexp_replace(trim(v_returned_name), '\s+', ' ', 'g')) then
      raise exception 'Replacement must be the same shoe model (% for %).', v_replacement_name, v_returned_name;
    end if;

    insert into public.return_details (
      return_id, product_id, quantity_returned, reason, new_product_id, new_quantity, inventory_action
    )
    values (v_return_id, v_returned, v_qty, v_note, v_replacement, v_qty, v_action);

    if v_action = 'Return to Stock' and v_replacement = v_returned then
      -- Same pair back on the shelf, same pair out: stock unchanged.
      insert into public.inventory_log (inventory_log_id, product_id, quantity_change, transaction_type, reference_id, date_updated)
      values (gen_random_uuid(), v_replacement, 0, 'adjustment', v_return_id, now());
    else
      if v_action = 'Return to Stock' then
        update public.inventory
        set stock_quantity = stock_quantity + v_qty, last_updated = now()
        where product_id = v_returned;
        insert into public.inventory_log (inventory_log_id, product_id, quantity_change, transaction_type, reference_id, date_updated)
        values (gen_random_uuid(), v_returned, v_qty, 'return', v_return_id, now());
      end if;
      -- A defective returned pair is written off (not restocked).

      select stock_quantity - coalesce(reserved_quantity, 0) into v_available
      from public.inventory where product_id = v_replacement for update;
      if v_available is null then
        raise exception 'No inventory record for %.', v_replacement_name;
      end if;
      if v_available < v_qty then
        raise exception 'Not enough stock of % for this replacement (available: %).', v_replacement_name, greatest(v_available, 0);
      end if;
      update public.inventory
      set stock_quantity = stock_quantity - v_qty, last_updated = now()
      where product_id = v_replacement;
      insert into public.inventory_log (inventory_log_id, product_id, quantity_change, transaction_type, reference_id, date_updated)
      values (gen_random_uuid(), v_replacement, -v_qty, 'adjustment', v_return_id, now());
    end if;
    v_count := v_count + 1;
  end loop;

  insert into public.audit_log (actor_user_id, action_type, entity_type, entity_id, metadata)
  values (v_user, 'REPLACEMENT_RECORDED', 'RETURN', v_return_id::text,
          jsonb_build_object('sales_id', p_sales_id, 'lines', v_count));

  return jsonb_build_object('return_id', v_return_id, 'lines', v_count);
end;
$$;

revoke all on function public.process_replacement(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.process_replacement(uuid, uuid, jsonb, jsonb) to anon, authenticated;


-- ------------------------------------------------------------------------------
-- complete_sale: also refuse inactive items and expired stock (the POS hides
-- them, but a direct request could still sell them), and give clear messages
-- for malformed input and absurd payment amounts. Otherwise unchanged from
-- security_phase5_discount_enforcement.sql.
-- ------------------------------------------------------------------------------
create or replace function public.complete_sale(
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
  v_status text;
  v_product_status text;
  v_expiry date;
  v_name text;
begin
  if v_user_id is null then
    raise exception 'Your session has expired. Please sign in again.';
  end if;

  begin
    v_customer_id := nullif(trim(coalesce(p_customer_id, '')), '')::uuid;
  exception when others then
    raise exception 'The selected customer could not be found. Please pick the customer again.';
  end;

  if v_method not in ('cash', 'gcash', 'card', 'online', 'check') then
    raise exception 'Unsupported payment method: %.', v_method;
  end if;
  if p_amount_paid is not null and p_amount_paid > 10000000 then
    raise exception 'The amount paid looks wrong (PHP %). Please re-enter the cash received.', round(p_amount_paid, 2);
  end if;

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
    begin
      v_product_id := (v_item ->> 'product_id')::uuid;
      v_qty := coalesce((v_item ->> 'quantity')::integer, 0);
    exception when others then
      raise exception 'A cart item is invalid. Please remove it and add it again.';
    end;
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
      coalesce(i.srp, p.cost_price, 0)::numeric(12, 2),
      lower(trim(coalesce(nullif(trim(i.inventory_status), ''), p.status, 'active'))),
      lower(trim(coalesce(p.status, 'active'))),
      i.expiration_date::date,
      p.product_name
    into v_available, v_price, v_status, v_product_status, v_expiry, v_name
    from public.inventory i
    join public.product p on p.product_id = i.product_id
    where i.product_id = v_product_id
    for update of i;

    if v_available is null then
      raise exception 'No inventory record found for product %.', v_product_id;
    end if;
    -- Same rule as the POS and Product List: inactive items and expired stock are not for sale.
    if v_status not in ('active', 'available') or v_product_status not in ('active', 'available') then
      raise exception '% is marked inactive and cannot be sold.', v_name;
    end if;
    if v_expiry is not null and v_expiry < (now() at time zone 'Asia/Manila')::date then
      raise exception '% is past its expiration date and cannot be sold.', v_name;
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
-- Stock-in / inventory settings (Product Settings page).
-- Before: the page saved "stock shown on screen + stock-in" as the new total,
-- so a sale made after the page loaded was erased. Now the stock-in is added
-- to the live stock with the row locked, and the log is written in the same
-- transaction. Admins and inventory staff only.
-- ------------------------------------------------------------------------------
create or replace function public.save_inventory_settings(
  p_product_id uuid,
  p_stock_in integer,
  p_reserved_quantity integer,
  p_reorder_level integer,
  p_srp numeric,
  p_status text,
  p_manufacturer_date date default null,
  p_expiration_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.app_current_user_id();
  v_inventory_id uuid;
  v_stock integer;
  v_old_reserved integer;
  v_new_stock integer;
  v_status text := case when lower(trim(coalesce(p_status, ''))) = 'inactive' then 'inactive' else 'active' end;
begin
  if v_user is null then
    raise exception 'Your session has expired. Please sign in again.';
  end if;
  if public.app_current_role_group() not in ('admin', 'inventory') then
    raise exception 'Only administrators and inventory staff can change stock.';
  end if;
  if coalesce(p_stock_in, 0) < 0 then
    raise exception 'Stock-in quantity cannot be negative.';
  end if;
  if coalesce(p_reorder_level, 0) < 0 then
    raise exception 'Reorder level must be 0 or more.';
  end if;
  if p_srp is null or p_srp <= 0 then
    raise exception 'Selling price (SRP) must be greater than 0.';
  end if;
  if p_manufacturer_date is not null and p_expiration_date is not null and p_expiration_date < p_manufacturer_date then
    raise exception 'Expiration date must not be earlier than manufacturer date.';
  end if;
  if not exists (select 1 from public.product where product_id = p_product_id) then
    raise exception 'Product not found.';
  end if;

  select inventory_id, stock_quantity, coalesce(reserved_quantity, 0)
  into v_inventory_id, v_stock, v_old_reserved
  from public.inventory where product_id = p_product_id
  for update;

  if v_inventory_id is null then
    if coalesce(p_stock_in, 0) <= 0 then
      raise exception 'Stock-in quantity must be greater than 0 for new inventory.';
    end if;
    v_inventory_id := gen_random_uuid();
    v_stock := 0;
    v_old_reserved := 0;
    v_new_stock := p_stock_in;
    if coalesce(p_reserved_quantity, 0) < 0 or coalesce(p_reserved_quantity, 0) > v_new_stock then
      raise exception 'Held stock cannot be greater than total on-hand stock (%).', v_new_stock;
    end if;
    insert into public.inventory (
      inventory_id, product_id, stock_quantity, reserved_quantity, reorder_level, srp,
      inventory_status, manufacturer_date, expiration_date, last_updated
    )
    values (
      v_inventory_id, p_product_id, v_new_stock, coalesce(p_reserved_quantity, 0), coalesce(p_reorder_level, 0), p_srp,
      v_status, p_manufacturer_date, p_expiration_date, now()
    );
  else
    v_new_stock := v_stock + coalesce(p_stock_in, 0);
    if coalesce(p_reserved_quantity, 0) < 0 or coalesce(p_reserved_quantity, 0) > v_new_stock then
      raise exception 'Held stock cannot be greater than total on-hand stock (%).', v_new_stock;
    end if;
    update public.inventory
    set stock_quantity = v_new_stock,
        reserved_quantity = coalesce(p_reserved_quantity, 0),
        reorder_level = coalesce(p_reorder_level, 0),
        srp = p_srp,
        inventory_status = v_status,
        manufacturer_date = p_manufacturer_date,
        expiration_date = p_expiration_date,
        last_updated = now()
    where inventory_id = v_inventory_id;
  end if;

  if coalesce(p_stock_in, 0) > 0 then
    insert into public.inventory_log (inventory_log_id, product_id, quantity_change, transaction_type, reference_id, date_updated)
    values (gen_random_uuid(), p_product_id, p_stock_in, 'restock', v_inventory_id, now());
  end if;

  if coalesce(p_reserved_quantity, 0) <> v_old_reserved then
    begin
      insert into public.inventory_log (inventory_log_id, product_id, quantity_change, transaction_type, reference_id, date_updated)
      values (gen_random_uuid(), p_product_id, abs(coalesce(p_reserved_quantity, 0) - v_old_reserved),
              case when coalesce(p_reserved_quantity, 0) > v_old_reserved then 'hold' else 'release_hold' end,
              v_inventory_id, now());
    exception when check_violation then
      null; -- databases whose log only allows sale/return/adjustment/restock
    end;
  end if;

  return jsonb_build_object('inventory_id', v_inventory_id, 'stock_quantity', v_new_stock);
end;
$$;

revoke all on function public.save_inventory_settings(uuid, integer, integer, integer, numeric, text, date, date) from public, anon, authenticated;
grant execute on function public.save_inventory_settings(uuid, integer, integer, integer, numeric, text, date, date) to anon, authenticated;

commit;
