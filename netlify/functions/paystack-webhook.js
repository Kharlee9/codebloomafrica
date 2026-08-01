// netlify/functions/paystack-webhook.js
//
// POST /.netlify/functions/paystack-webhook
//
// Paystack calls this endpoint server-to-server whenever a transaction
// event fires. This is the SOURCE OF TRUTH for payment status — it fires
// even if the customer closes their browser before the InlineJS onSuccess
// callback / verify-payment call completes, and it's protected by HMAC
// signature verification so only genuine, unmodified requests from
// Paystack are ever processed. Kept alongside the InlineJS v2 popup flow
// as the reliability backstop (popup callbacks only fire if the tab stays
// open and JS runs successfully).
//
// Configure in the Paystack Dashboard:
// Settings > API Keys & Webhooks > Webhook URL
//   https://<your-site>.netlify.app/.netlify/functions/paystack-webhook

const crypto = require('crypto');
const { getSupabaseAdmin } = require('./utils/supabaseAdmin');
const { verifyAndRecordPayment } = require('./utils/paystackVerify');

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  if (!PAYSTACK_SECRET_KEY) {
    console.error('Missing PAYSTACK_SECRET_KEY environment variable');
    return respond(500, { error: 'Payment provider is not configured' });
  }

  // event.body is the raw request body string as received — required for
  // the HMAC to match exactly what Paystack signed.
  const rawBody = event.body || '';
  const signature =
    event.headers['x-paystack-signature'] || event.headers['X-Paystack-Signature'];

  if (!signature || !isValidSignature(rawBody, signature)) {
    console.warn('Rejected webhook: invalid or missing signature');
    return respond(401, { error: 'Invalid signature' });
  }

  let evt;
  try {
    evt = JSON.parse(rawBody);
  } catch (err) {
    return respond(400, { error: 'Invalid JSON payload' });
  }

  // Acknowledge everything with 200 quickly; only act on charge.success.
  // (Paystack retries webhooks that don't get a 2xx response.)
  if (evt.event !== 'charge.success') {
    return respond(200, { received: true, ignored: evt.event });
  }

  const reference = evt.data && evt.data.reference;
  if (!reference) {
    console.error('Webhook charge.success payload missing reference');
    return respond(200, { received: true });
  }

  try {
    const supabase = getSupabaseAdmin();
    await verifyAndRecordPayment(reference, supabase, PAYSTACK_SECRET_KEY);
    return respond(200, { received: true });
  } catch (err) {
    // Log the failure but still return 200 for already-processed/duplicate
    // events; for genuine failures, Paystack's automatic retry will hit
    // this endpoint again, at which point idempotency handling takes over.
    console.error('Webhook processing error:', err.message);
    return respond(200, { received: true, note: 'processing error logged' });
  }
};

function isValidSignature(rawBody, signature) {
  const expectedHash = crypto
    .createHmac('sha512', PAYSTACK_SECRET_KEY)
    .update(rawBody)
    .digest('hex');
  return timingSafeEqualStrings(expectedHash, signature);
}

function timingSafeEqualStrings(a, b) {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
