alter table if exists public.kols add column if not exists twitter_handle text;
alter table if exists public.kols add column if not exists twitter_url text;
alter table if exists public.kols add column if not exists telegram_url text;
alter table if exists public.kols add column if not exists website_url text;
alter table if exists public.kols add column if not exists updated_at timestamp with time zone;
