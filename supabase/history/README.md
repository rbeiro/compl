# Production migration history (reference only)

These 29 files were recovered from the production project's migration history
(`supabase migration fetch --remote`). They are kept for reference: some
production changes were made outside migrations, so replaying them does not
reproduce production exactly.

New projects are built from `supabase/migrations/`, whose baseline is the dump
of the production schema (`inventory/remote_schema.sql`).
