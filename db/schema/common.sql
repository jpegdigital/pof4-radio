-- Shared helpers used by more than one table.

-- `before update` trigger: keeps updated_at honest without every query remembering to set it.
create function touch_updated_at() returns trigger
language plpgsql as $fn$
begin
  new.updated_at := now();
  return new;
end
$fn$;
