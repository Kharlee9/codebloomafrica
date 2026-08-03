// netlify/functions/initialize-sponsor-payment.js
//
// POST /.netlify/functions/initialize-sponsor-payment
// Body: { sponsorId, email, sponsorCount }
//
// Server-side step of the Paystack InlineJS v2 "Resume Transaction" flow
// for the sponsor feature — mirrors initialize-payment.js exactly, but:
//   - reads from/writes to sponsor_registrations / sponsor_payments
//   - calculates the amount dynamically as sponsorCount × ₦10,000
//     instead of a flat fee
//
// This is fully isolated from the course-registration flow (different
// tables, different function), so it can't affect it.

const { getSupabaseAdmin } = require('./utils/supabaseAdmin');

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

// Per-person sponsorship fee in Naira. The amount sent to Paystack is
// always sponsorCount × this value — never hardcoded per quantity.
const PER_SPONSORSHIP_FEE_NAIRA = 10000;
const MIN_SPONSOR_COUNT = 1;
const MAX_SPONSOR_COUNT = 10;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  if (!PAYSTACK_SECRET_KEY) {
    console.error('Missing PAYSTACK_SECRET_KEY environment variable');
    return respond(500, { error: 'Payment provider is not configured' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (err) {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const { sponsorId, email, sponsorCount } = payload;

  if (!sponsorId || !email || !sponsorCount) {
    return respond(400, { error: 'sponsorId, email and sponsorCount are required' });
  }

  if (!isValidEmail(email)) {
    return respond(400, { error: 'A valid email address is required' });
  }

  const count = Number(sponsorCount);
  if (!Number.isInteger(count) || count < MIN_SPONSOR_COUNT || count > MAX_SPONSOR_COUNT) {
    return respond(400, { error: `sponsorCount must be a whole number between ${MIN_SPONSOR_COUNT} and ${MAX_SPONSOR_COUNT}` });
  }

  // Amount = Number of Sponsors × ₦10,000 — calculated here, never trusted
  // from the client, and never hardcoded per quantity.
  const amountNaira = count * PER_SPONSORSHIP_FEE_NAIRA;

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (err) {
    console.error(err);
    return respond(500, { error: err.message });
  }

  // Confirm the sponsor registration exists and isn't already paid for.
  const { data: sponsor, error: fetchError } = await supabase
    .from('sponsor_registrations')
    .select('id, paid, number_of_sponsorships')
    .eq('id', sponsorId)
    .maybeSingle();

  if (fetchError) {
    console.error('Sponsor registration lookup failed:', fetchError);
    return respond(500, {
      error: 'Could not look up sponsor registration',
      details: fetchError.message || String(fetchError),
    });
  }

  if (!sponsor) {
    return respond(404, { error: 'Sponsor registration not found' });
  }

  if (sponsor.paid) {
    return respond(409, { error: 'This sponsorship has already been paid for' });
  }

  // Unique, traceable reference for this specific transaction attempt.
  const reference = `CB-SPONSOR-${sponsorId}-${Date.now()}`;
  // Paystack's initialize endpoint expects amount in kobo (the smallest
  // unit of NGN).
  const amountKobo = amountNaira * 100;

  try {
    const paystackRes = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        amount: amountKobo,
        currency: 'NGN',
        reference,
        channels: ['card', 'bank', 'bank_transfer', 'ussd', 'qr', 'mobile_money'],
        metadata: {
          type: 'sponsor',
          sponsorId,
          sponsorCount: count,
        },
      }),
    });

    const paystackData = await paystackRes.json();

    if (!paystackRes.ok || !paystackData.status) {
      console.error('Paystack initialize error:', paystackData);
      return respond(502, { error: 'Could not start payment. Please try again.' });
    }

    // Log the pending attempt so it can be reconciled even if the browser
    // never completes the popup flow — the webhook will also independently
    // confirm this.
    const { error: insertError } = await supabase.from('sponsor_payments').insert([
      {
        sponsor_id: sponsorId,
        reference,
        amount: amountNaira,
        currency: 'NGN',
        status: 'pending',
        email,
      },
    ]);

    if (insertError) {
      // Not fatal — Paystack already has the transaction and verify/webhook
      // will upsert this row regardless. Just log it.
      console.error('Could not log pending sponsor payment row:', insertError);
    }

    // Only the access_code (+ reference, for the browser's own bookkeeping)
    // goes back to the client. Never return the secret key or raw Paystack
    // response.
    return respond(200, {
      access_code: paystackData.data.access_code,
      reference: paystackData.data.reference,
      amount: amountNaira,
    });
  } catch (err) {
    console.error('initialize-sponsor-payment unexpected error:', err);
    return respond(500, { error: 'Unexpected error initializing payment' });
  }
};

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
