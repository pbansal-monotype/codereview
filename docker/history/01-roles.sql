-- Local history DB bootstrap for PostgREST (Supabase-compatible REST).
-- Applied once on first `docker compose up` via /docker-entrypoint-initdb.d.

create role anon nologin;
create role service_role nologin bypassrls;
create role authenticator noinherit login password 'postgres';
grant anon, service_role to authenticator;

grant usage on schema public to anon, service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
