-- 002: application-layer pgcrypto helpers for user_identity (SECURITY.md;
-- approach locked 2026-07-24: pgcrypto, no external vault).
-- Apply AFTER schema.sql on a fresh project.
--
-- The app encrypts identity fields before write and decrypts only at
-- form-generation time, via these functions (called with the app-held
-- IDENTITY_ENCRYPTION_KEY). Ciphertext is stored base64 in text columns,
-- which is why date_of_birth is widened to text here (the schema.sql
-- comment anticipated this: encryption is "not expressed in raw DDL...
-- since it depends on the encryption approach chosen at build time").

create extension if not exists pgcrypto;

alter table user_identity alter column date_of_birth type text;

create or replace function encrypt_identity(plain text, key text) returns text
  language sql security invoker stable as $$
  select case when plain is null then null
              else encode(pgp_sym_encrypt(plain, key), 'base64') end
$$;

create or replace function decrypt_identity(cipher text, key text) returns text
  language sql security invoker stable as $$
  select case when cipher is null then null
              else pgp_sym_decrypt(decode(cipher, 'base64'), key) end
$$;

-- Callable by the server (service role) only - never by browser roles.
revoke execute on function encrypt_identity(text, text) from public, anon, authenticated;
revoke execute on function decrypt_identity(text, text) from public, anon, authenticated;
grant execute on function encrypt_identity(text, text) to service_role;
grant execute on function decrypt_identity(text, text) to service_role;
