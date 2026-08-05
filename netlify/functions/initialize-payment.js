// netlify/functions/initialize-payment.js
//
// POST /.netlify/functions/initialize-payment
// Body: { registrationId, email, course }
//
// Server-side step of the Paystack InlineJS v2 "Resume Transaction" flow:
// https://paystack.com/docs/developer-tools/inlinejs/#resume-transaction
//
// 1. Confirms the registration exists and hasn't already been paid for.
// 2. Calls Paystack's /transaction/initialize endpoint using the SECRET key
//    (this must only ever happen server-side).
// 3. Logs a "pending" row in the payments table for reconciliation.
// 4. Returns only the access_code + reference to the browser — the secret
//    key never leaves this function. The browser uses the access_code with
//    PaystackPop's resumeTransaction() to complete checkout in-page.

const { getSupabaseAdmin } = require('./utils/supabaseAdmin');

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

// Flat registration fee in Naira — every course costs the same.
const REGISTRATION_FEE_NAIRA = 100;

// Courses offered on the registration form (register.html) — kept here so
// the server never trusts an arbitrary "course" string from the client.
const ALLOWED_COURSES = new Set([
  'Web Development',
  'UI/UX Design',
  'AI Video Creation',
  'Data Analysis',
  'Product Management',
  'Digital Marketing',
]);

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

  const { registrationId, email, course } = payload;

  if (!registrationId || !email || !course) {
    return respond(400, { error: 'registrationId, email and course are required' });
  }

  if (!isValidEmail(email)) {
    return respond(400, { error: 'A valid email address is required' });
  }

  if (!ALLOWED_COURSES.has(course)) {
    return respond(400, { error: 'Unrecognized course selection' });
  }

  const amountNaira = REGISTRATION_FEE_NAIRA;

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (err) {
    console.error(err);
    return respond(500, { error: err.message });
  }

  // Confirm the registration exists and isn't already paid for.
  const { data: registration, error: fetchError } = await supabase
    .from('registrations')
    .select('id, paid')
    .eq('id', registrationId)
    .maybeSingle();

  if (fetchError) {
    // Usually means Netlify env vars point at the wrong Supabase project,
    // the service-role key is invalid, or SUPABASE_URL is mistyped.
    console.error('Registration lookup failed:', fetchError);
    return respond(500, {
      error: 'Could not look up registration',
      details: fetchError.message || String(fetchError),
    });
  }

  if (!registration) {
    return respond(404, { error: 'Registration not found' });
  }

  if (registration.paid) {
    return respond(409, { error: 'This registration has already been paid for' });
  }

  // Unique, traceable reference for this specific transaction attempt.
  const reference = `CB-${registrationId}-${Date.now()}`;
  // Paystack's initialize endpoint expects amount in kobo (the smallest
  // unit of NGN), so ₦10,000 must be sent as 1,000,000.
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
          type: 'registration',
          registrationId,
          course,
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
    const { error: insertError } = await supabase.from('payments').insert([
      {
        registration_id: registrationId,
        reference,
        amount: amountNaira,
        status: 'pending',
        email,
      },
    ]);

    if (insertError) {
      // Not fatal — Paystack already has the transaction and verify/webhook
      // will upsert this row regardless. Just log it.
      console.error('Could not log pending payment row:', insertError);
    }

    // Only the access_code (+ reference, for the browser's own bookkeeping)
    // goes back to the client. Never return the secret key or raw Paystack
    // response.
    return respond(200, {
      access_code: paystackData.data.access_code,
      reference: paystackData.data.reference,
    });
  } catch (err) {
    console.error('initialize-payment unexpected error:', err);
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
