// sponsor.js
//
// Sponsor registration + payment flow. Mirrors register.js's Paystack
// InlineJS v2 "Resume Transaction" pattern exactly:
// https://paystack.com/docs/developer-tools/inlinejs/#resume-transaction
//
//   1. Save the sponsor registration to Supabase (paid = false).
//   2. Ask initialize-sponsor-payment (server-side, uses the SECRET key)
//      to initialize a Paystack transaction for
//      (number of people sponsored × ₦10,000) and return an access_code.
//   3. Open the official Paystack popup in-page with
//      popup.resumeTransaction(access_code, { onSuccess, onCancel, onError }).
//   4. On success, call verify-sponsor-payment (server-side) to re-check
//      the transaction directly with Paystack and persist the result —
//      the client-side onSuccess callback is never trusted on its own.
//   5. Redirect to sponsor-success.html.
//
// This is a fully separate flow from register.js / registrations table —
// it writes to sponsor_registrations / sponsor_payments only, so it can't
// affect the existing course-registration flow.

// The Supabase anon (publishable) key is safe to expose in browser code —
// it can ONLY insert new sponsor rows (see supabase-schema.sql RLS policy).
const SUPABASE_URL = 'https://evuyhhritkfoxexbspco.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV2dXloaHJpdGtmb3hleGJzcGNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU3ODQ2NTYsImV4cCI6MjEwMTM2MDY1Nn0.D7UGpZgA9sJcpLIMZB8_js_yEChFkn6JDThXYMzOgqk';

const supabaseClient = SUPABASE_URL.startsWith('http')
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

const form = document.getElementById('sponsorForm');
const submitBtn = document.getElementById('submitBtn');
const submitLabel = document.getElementById('submitLabel');
const formError = document.getElementById('formError');
const paymentOverlay = document.getElementById('paymentOverlay');
const paymentOverlayText = document.getElementById('paymentOverlayText');

function showError(message) {
  formError.textContent = message;
  formError.hidden = false;
}

function clearError() {
  formError.hidden = true;
  formError.textContent = '';
}

function setLoading(isLoading, label) {
  submitBtn.disabled = isLoading;
  submitLabel.textContent = label;
}

// Full-screen blurred overlay shown once Paystack reports success, while
// we re-verify the transaction server-side — keeps the transition from
// popup close to success page feeling deliberate rather than frozen.
function showPaymentOverlay(text) {
  paymentOverlayText.textContent = text;
paymentOverlay.style.display = 'flex'
}

function hidePaymentOverlay() {
paymentOverlay.style.display = 'none'
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();

const firstName = document.getElementById('firstName').value.trim();
const lastName = document.getElementById('lastName').value.trim();
const phone = document.getElementById('phone').value.trim();
const email = document.getElementById('email').value.trim();
const sponsorCountRaw = document.getElementById('sponsorCount').value;
const sponsorPreference = document.getElementById('sponsorPreference').value;
const socialMediaAcknowledgement = document.getElementById('socialMediaAcknowledgement').value;

// ---- Client-side validation ----
const fields = [
  { id: 'firstName', value: firstName },
  { id: 'lastName', value: lastName },
  { id: 'phone', value: phone },
  { id: 'email', value: email },
  { id: 'sponsorCount', value: sponsorCountRaw },
  { id: 'sponsorPreference', value: sponsorPreference },
  { id: 'socialMediaAcknowledgement', value: socialMediaAcknowledgement },
];

const firstEmpty = fields.find(f => !f.value);

if (firstEmpty) {
  showError('Please fill in every field before continuing.');
  document.getElementById(firstEmpty.id).focus();
  return;
}

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    showError('Please enter a valid email address.');
    return;
  }

  const phonePattern = /^[+0-9\s-]{7,20}$/;
  if (!phonePattern.test(phone)) {
    showError('Please enter a valid phone number.');
    return;
  }

  // Any positive whole number is allowed — no upper cap on how many
  // people someone can sponsor.
  const sponsorCount = parseInt(sponsorCountRaw, 10);
  if (!Number.isInteger(sponsorCount) || sponsorCount < 1 || String(sponsorCount) !== sponsorCountRaw.trim()) {
    showError('Please enter a valid whole number of people to sponsor (1 or more).');
    return;
  }

  if (!supabaseClient) {
    showError('Sponsorship registration is not configured yet. Please contact the site admin.');
    console.error('Supabase client not initialized — check SUPABASE_URL / SUPABASE_ANON_KEY in sponsor.js');
    return;
  }

  if (typeof PaystackPop === 'undefined') {
    showError('Payment is not available right now. Please refresh the page and try again.');
    console.error('PaystackPop is not defined — check that the InlineJS v2 script tag loaded in sponsor.html');
    return;
  }

  setLoading(true, 'Saving your details…');

  // Generated client-side, same pattern as register.js — ties the sponsor
  // registration to its payment record end-to-end without relying on
  // Postgres RETURNING (which RLS would block for the anon key).
  const sponsorId = crypto.randomUUID();

  try {
    // ---- 1. Save the sponsor registration to Supabase BEFORE payment ----
    const { error: insertError } = await supabaseClient.from('sponsor_registrations').insert([
      {
        id: sponsorId,
        first_name: firstName,
        last_name: lastName,
        phone: phone,
        email: email,
        number_of_sponsorships: sponsorCount,
        sponsor_preference: sponsorPreference,
        social_media_acknowledgement: socialMediaAcknowledgement,
      },
    ]);

    if (insertError) {
      console.error('Supabase insert error:', insertError);
      showError('Something went wrong saving your details. Please try again.');
      setLoading(false, 'Proceed to payment');
      return;
    }

    // ---- 2. Ask our Netlify Function to initialize the Paystack transaction ----
    setLoading(true, 'Preparing payment…');

    const initRes = await fetch('/.netlify/functions/initialize-sponsor-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sponsorId, email, sponsorCount }),
    });

    const initData = await initRes.json();

    if (!initRes.ok || !initData.access_code) {
      console.error('initialize-sponsor-payment error:', initData);
      showError(initData.error || 'Could not start payment. Please try again.');
      setLoading(false, 'Proceed to payment');
      return;
    }

    // ---- 3. Open the official Paystack InlineJS v2 popup ----
    setLoading(true, 'Opening payment…');

    const popup = new PaystackPop();

    popup.resumeTransaction(initData.access_code, {
      onSuccess: async (transaction) => {
        // ---- 4. Never trust the client callback alone — re-verify server-side ----
        showPaymentOverlay('Confirming your payment…');
        setLoading(true, 'Confirming payment…');

        try {
          const verifyRes = await fetch(
            `/.netlify/functions/verify-sponsor-payment?reference=${encodeURIComponent(transaction.reference)}`
          );
          const verifyData = await verifyRes.json();

          if (verifyRes.ok && verifyData.status === 'success') {
            // ---- 5. Success — go to the success page ----
            const params = new URLSearchParams({
              reference: transaction.reference,
              count: String(verifyData.sponsor_count || sponsorCount),
            });
            window.location.href = `sponsor-success.html?${params.toString()}`;
            return;
          }

          console.error('verify-sponsor-payment did not confirm success:', verifyData);
          hidePaymentOverlay();
          showError('We could not confirm your payment. If you were charged, please contact support with your payment reference.');
          setLoading(false, 'Proceed to payment');
        } catch (err) {
          console.error('verify-sponsor-payment request failed:', err);
          hidePaymentOverlay();
          showError('We ran into a connection issue confirming your payment. Please contact support with your payment reference before trying again.');
          setLoading(false, 'Proceed to payment');
        }
      },
      onCancel: () => {
        setLoading(false, 'Proceed to payment');
      },
      onError: (error) => {
        console.error('Paystack popup error:', error && error.message);
        showError('Something went wrong opening the payment window. Please try again.');
        setLoading(false, 'Proceed to payment');
      },
    });
  } catch (err) {
    console.error('Unexpected sponsor registration error:', err);
    showError('Unexpected error. Please check your connection and try again.');
    setLoading(false, 'Proceed to payment');
  }
});
