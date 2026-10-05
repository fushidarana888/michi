create table if not exists public.anki_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  deck_name text,
  last_review_id bigint not null default 0,
  last_sync_at timestamptz,
  last_card_count integer not null default 0 check (last_card_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.anki_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  anki_card_id bigint not null,
  note_id bigint,
  deck_name text not null,
  question_text text,
  answer_text text,
  reps integer not null default 0 check (reps >= 0),
  lapses integer not null default 0 check (lapses >= 0),
  interval_days integer not null default 0,
  ease_factor integer not null default 0,
  anki_modified_at bigint,
  first_reviewed_at timestamptz,
  last_reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, anki_card_id)
);

create table if not exists public.anki_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  review_id bigint not null,
  anki_card_id bigint not null,
  reviewed_at timestamptz not null,
  ease smallint not null check (ease between 0 and 4),
  interval_value integer not null default 0,
  previous_interval integer not null default 0,
  factor integer not null default 0,
  duration_ms integer not null default 0 check (duration_ms >= 0),
  review_type smallint not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, review_id),
  foreign key (user_id, anki_card_id)
    references public.anki_cards(user_id, anki_card_id)
    on delete cascade
);

create index if not exists anki_cards_user_deck_idx
  on public.anki_cards(user_id, deck_name);
create index if not exists anki_cards_user_first_review_idx
  on public.anki_cards(user_id, first_reviewed_at desc);
create index if not exists anki_cards_user_lapses_idx
  on public.anki_cards(user_id, lapses desc, reps desc);
create index if not exists anki_reviews_user_time_idx
  on public.anki_reviews(user_id, reviewed_at desc);
create index if not exists anki_reviews_card_time_idx
  on public.anki_reviews(user_id, anki_card_id, reviewed_at desc);

create or replace function public.touch_anki_card_review_bounds()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.anki_cards
  set first_reviewed_at = case
        when first_reviewed_at is null then new.reviewed_at
        else least(first_reviewed_at, new.reviewed_at)
      end,
      last_reviewed_at = case
        when last_reviewed_at is null then new.reviewed_at
        else greatest(last_reviewed_at, new.reviewed_at)
      end,
      updated_at = now()
  where user_id = new.user_id
    and anki_card_id = new.anki_card_id;
  return new;
end;
$$;

drop trigger if exists anki_reviews_touch_card_bounds on public.anki_reviews;
create trigger anki_reviews_touch_card_bounds
after insert on public.anki_reviews
for each row execute function public.touch_anki_card_review_bounds();

drop trigger if exists anki_connections_set_updated_at on public.anki_connections;
create trigger anki_connections_set_updated_at
before update on public.anki_connections
for each row execute function public.set_updated_at();

drop trigger if exists anki_cards_set_updated_at on public.anki_cards;
create trigger anki_cards_set_updated_at
before update on public.anki_cards
for each row execute function public.set_updated_at();

alter table public.anki_connections enable row level security;
alter table public.anki_cards enable row level security;
alter table public.anki_reviews enable row level security;

drop policy if exists "anki_connections_own_all" on public.anki_connections;
create policy "anki_connections_own_all" on public.anki_connections
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "anki_cards_own_all" on public.anki_cards;
create policy "anki_cards_own_all" on public.anki_cards
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "anki_reviews_own_all" on public.anki_reviews;
create policy "anki_reviews_own_all" on public.anki_reviews
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.anki_connections to authenticated;
grant select, insert, update, delete on public.anki_cards to authenticated;
grant select, insert, update, delete on public.anki_reviews to authenticated;
