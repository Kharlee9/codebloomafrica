// netlify/functions/utils/supabaseAdmin.js
//
// Server-side Supabase client using the SERVICE ROLE key.
// This key bypasses Row Level Security, so it must only ever be used
// inside Netlify Functions (server-side) — never sent to the browser.

const { createClient } = require('@supabase/supabase-js');

let cachedClient = null;

function getSupabaseAdmin() {
  if (cachedClient) return cachedClient;

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables'
    );
  }

  cachedClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });

  return cachedClient;
}

module.exports = { getSupabaseAdmin };
