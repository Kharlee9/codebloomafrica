// netlify/functions/create-payment.js
//
// POST /.netlify/functions/create-payment
// Body: { registrationId, email, course }
//
// Confirms the registration exists and hasn't already been paid for,
// initializes a Paystack transaction, logs a "pending" row in the
// payments table for reconciliation, and returns the Checkout URL for
// the browser to redirect to.

const { getSupabaseAdmin } = require('./utils/supabaseAdmin');

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const SITE_URL = process.env.SITE_URL; // e.g. https://codebloomafrica.netlify.app

// Course fees in Naira — update to your real prices.
const COURSE_PRICES = {
  'Product Design UI/UX': 10000,
  'UI/UX Design': 10000,
  'Data Analysis': 10000,
  'Product Management': 10000,
  'Digital Marketing': 10000,
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  if (!PAYSTACK_SECRET_KEY) {
    console.error('Missing PAYSTACK_SECRET_KEY environment variable');
    return respond(500, { error: 'Payment provider is not configured' });
  }

  if (!SITE_URL) {
    console.error('Missing SITE_URL environment variable');
    return respond(500, { error: 'Site is not configured for payments' });
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

  const amountNaira = COURSE_PRICES[course];
  if (!amountNaira) {
    return respond(400, { error: 'Unrecognized course selection' });
  }

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (err) {
    console.error(err);

    return respond(500, {
        error: err.message
    });
}

  // Confirm the registration exists and isn't already paid for.
  const { data: registration, error: fetchError } = await supabase
    .from('registrations')
    .select('id, paid')
    .eq('id', registrationId)
    .maybeSingle();

  if (fetchError) {
    console.error('Registration lookup failed:', fetchError);
    return respond(500, { error: 'Could not look up registration' });
  }

  if (!registration) {
    return respond(404, { error: 'Registration not found' });
  }

  if (registration.paid) {
    return respond(409, { error: 'This registration has already been paid for' });
  }

  // Unique, traceable reference for this specific transaction attempt.
  const reference = `CB-${registrationId}-${Date.now()}`;
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
        callback_url: `${SITE_URL}/payment-success.html`,
        metadata: {
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
    // never returns — the webhook will also independently confirm this.
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

    return respond(200, {
      authorization_url: paystackData.data.authorization_url,
      reference,
    });
  } catch (err) {
    console.error('create-payment unexpected error:', err);
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
