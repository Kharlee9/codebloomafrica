// netlify/functions/verify-payment.js
//
// GET /.netlify/functions/verify-payment?reference=xxxx
//
// Called by register.js immediately after PaystackPop's onSuccess callback
// fires. Never trusts that client-side callback on its own — it re-checks
// the transaction directly with Paystack and only then updates Supabase,
// via the shared verifyAndRecordPayment() helper also used by the webhook.

const { getSupabaseAdmin } = require('./utils/supabaseAdmin');
const { verifyAndRecordPayment } = require('./utils/paystackVerify');

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return respond(405, { error: 'Method not allowed' });
  }

  if (!PAYSTACK_SECRET_KEY) {
    console.error('Missing PAYSTACK_SECRET_KEY environment variable');
    return respond(500, { error: 'Payment provider is not configured' });
  }

  const reference = event.queryStringParameters && event.queryStringParameters.reference;
  if (!reference) {
    return respond(400, { error: 'Missing transaction reference' });
  }

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (err) {
    console.error(err.message);
    return respond(500, { error: 'Server misconfiguration' });
  }

  try {
    const result = await verifyAndRecordPayment(reference, supabase, PAYSTACK_SECRET_KEY);
    return respond(result.status === 'success' ? 200 : 400, result);
  } catch (err) {
    console.error('verify-payment error:', err.message);
    return respond(500, { error: 'Could not verify payment', details: err.message });
  }
};

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
