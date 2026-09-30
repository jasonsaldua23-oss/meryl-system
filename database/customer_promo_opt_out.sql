-- ==============================================================================
-- MERYL SHOES SYSTEM - PROMOTION EMAIL OPT-OUT (Data Privacy Act, RA 10173)
-- Run in the Supabase SQL Editor. Safe to run more than once.
--
-- customer.promo_opt_out = true means the customer unsubscribed from
-- promotional emails (by the link in an email, Gmail's Unsubscribe button, or
-- staff unticking "Send promotion emails" on the Customers page). The email
-- sender and the audience picker skip these customers.
-- ==============================================================================

begin;

alter table public.customer add column if not exists promo_opt_out boolean not null default false;
alter table public.customer add column if not exists promo_opt_out_at timestamptz;

commit;

select count(*) filter (where promo_opt_out) as unsubscribed, count(*) as customers from public.customer;
