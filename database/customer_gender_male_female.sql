-- ==============================================================================
-- MERYL SHOES SYSTEM - CUSTOMER GENDER: MALE / FEMALE ONLY
-- Run in the Supabase SQL Editor after the matching app update is live.
-- Safe to run more than once.
--
-- A customer's gender is their own (Male or Female). Men's / Women's / Kids /
-- Unisex are shoe departments (product.gender), not customer values; whether
-- a customer is a child is already recorded by customer.age.
-- ==============================================================================

begin;

alter table public.customer drop constraint if exists chk_customer_gender_allowed;

-- Old department-style values become the customer's gender.
update public.customer
set gender = case
  when lower(trim(gender)) in ('m', 'male', 'man', 'men', 'boy', 'kids (boy)', 'kid-boy', 'kids-boy') then 'Male'
  when lower(trim(gender)) in ('f', 'female', 'woman', 'women', 'girl', 'kids (girl)', 'kid-girl', 'kids-girl') then 'Female'
  else null
end
where gender is not null;

alter table public.customer
  add constraint chk_customer_gender_allowed
  check (gender is null or gender in ('Male', 'Female'));

commit;

-- Result: how many customers of each gender.
select coalesce(gender, '(not set)') as gender, count(*) as customers
from public.customer
group by 1
order by 1;
