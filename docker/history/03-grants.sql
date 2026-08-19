-- Grant PostgREST roles access to history tables created by schema.sql.

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Anon stays locked out; RLS is enabled with no policies in schema.sql.
-- service_role bypasses RLS (BYPASSRLS on the role).
grant select on all tables in schema public to anon;
