-- Function to update updated_at timestamp
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Add triggers for updated_at
create trigger update_users_updated_at before update on public.users
  for each row execute function update_updated_at_column();

create trigger update_tournaments_updated_at before update on public.tournaments
  for each row execute function update_updated_at_column();

create trigger update_tournament_entries_updated_at before update on public.tournament_entries
  for each row execute function update_updated_at_column();

-- Function to increment tournament participants
create or replace function increment_tournament_participants()
returns trigger as $$
begin
  update public.tournaments
  set current_participants = current_participants + 1,
      prize_pool = prize_pool + new.entry_amount
  where id = new.tournament_id;
  return new;
end;
$$ language plpgsql;

-- Trigger to auto-increment participants when someone joins
create trigger on_tournament_entry_created
  after insert on public.tournament_entries
  for each row execute function increment_tournament_participants();

-- Function to update user stats when they win
create or replace function update_user_tournament_stats()
returns trigger as $$
begin
  if new.winner_id is not null and old.winner_id is null then
    update public.users
    set total_tournaments_won = total_tournaments_won + 1,
        total_winnings = total_winnings + new.prize_pool
    where id = new.winner_id;
  end if;
  return new;
end;
$$ language plpgsql;

-- Trigger to update user stats when tournament completes
create trigger on_tournament_winner_set
  after update on public.tournaments
  for each row execute function update_user_tournament_stats();
