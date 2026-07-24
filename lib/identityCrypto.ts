import { supabaseAdmin } from './supabaseAdmin';

// Identity vault access (SECURITY.md): identity fields are encrypted at
// the application layer via pgcrypto before they are written, and
// decrypted ONLY at the form-generation step. The matching engine never
// reads this module. The key lives in the app's environment, never in
// the database.

export const IDENTITY_FIELDS = [
  'full_name',
  'date_of_birth',
  'address',
  'phone',
  'email',
  'insurance_member_id',
  'insurance_group_number',
] as const;
export type IdentityField = (typeof IDENTITY_FIELDS)[number];

function encryptionKey(): string {
  const key = process.env.IDENTITY_ENCRYPTION_KEY;
  if (!key) throw new Error('IDENTITY_ENCRYPTION_KEY is required');
  return key;
}

async function encryptValue(plain: string | null | undefined): Promise<string | null> {
  if (plain == null || plain === '') return null;
  const { data, error } = await supabaseAdmin().rpc('encrypt_identity', {
    plain,
    key: encryptionKey(),
  });
  if (error) throw error;
  return data as string;
}

async function decryptValue(cipher: string | null): Promise<string | null> {
  if (!cipher) return null;
  const { data, error } = await supabaseAdmin().rpc('decrypt_identity', {
    cipher,
    key: encryptionKey(),
  });
  if (error) throw error;
  return data as string;
}

export async function saveIdentity(
  userId: string,
  fields: Partial<Record<IdentityField, string>>,
): Promise<void> {
  const row: Record<string, string | null> = { id: userId };
  for (const field of IDENTITY_FIELDS) {
    if (field in fields) row[field] = await encryptValue(fields[field]);
  }
  row.updated_at = new Date().toISOString();
  const { error } = await supabaseAdmin().from('user_identity').upsert(row);
  if (error) throw error;
}

// Default read for any non-form context: which fields are on file, never
// their values.
export async function readIdentityMasked(
  userId: string,
): Promise<{ id: string } & Record<IdentityField, boolean>> {
  const { data, error } = await supabaseAdmin()
    .from('user_identity')
    .select(IDENTITY_FIELDS.join(','))
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  const row = (data ?? {}) as Record<string, unknown>;
  const masked = { id: userId } as Record<IdentityField, boolean> & { id: string };
  for (const field of IDENTITY_FIELDS) {
    masked[field] = Boolean(row[field]);
  }
  return masked;
}

// The ONLY decrypt path in the system. Per SECURITY.md this is called
// exclusively at the form-generation step, scoped to exactly the fields
// that specific form requires - nothing broader.
export async function decryptIdentityForForm(
  userId: string,
  fields: IdentityField[],
): Promise<Partial<Record<IdentityField, string>>> {
  const { data, error } = await supabaseAdmin()
    .from('user_identity')
    .select(fields.join(','))
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  const row = (data ?? {}) as Record<string, unknown>;
  const out: Partial<Record<IdentityField, string>> = {};
  for (const field of fields) {
    const value = await decryptValue((row[field] as string | null) ?? null);
    if (value != null) out[field] = value;
  }
  return out;
}
