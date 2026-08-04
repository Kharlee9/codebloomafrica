// register.js
//
// Registration + payment flow, rebuilt on Paystack InlineJS v2 using the
// "Resume Transaction" pattern:
// https://paystack.com/docs/developer-tools/inlinejs/#resume-transaction
//
//   1. Save the registration to Supabase (paid = false), including the
//      work status, education, beginner-course-awareness, and
//      volunteering-interest fields collected on the form.
//   2. Ask initialize-payment (server-side, uses the SECRET key) to
//      initialize a Paystack transaction and return an access_code.
//   3. Open the official Paystack popup in-page with
//      popup.resumeTransaction(access_code, { onSuccess, onCancel, onError }).
//      This single popup lets the customer pay with card, bank transfer,
//      USSD, QR, or mobile money — Paystack handles all channel UI itself.
//   4. On success, call verify-payment (server-side) to re-check the
//      transaction directly with Paystack and persist the result — the
//      client-side onSuccess callback is never trusted on its own.
//   5. Redirect to payment-success.html.

// ============================================================
// CONFIG — fill these in before going live
// ============================================================
// The Supabase anon (publishable) key is safe to expose in browser code —
// it can ONLY insert new registration rows (see supabase-schema.sql RLS
// policy).
const SUPABASE_URL = 'https://evuyhhritkfoxexbspco.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV2dXloaHJpdGtmb3hleGJzcGNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU3ODQ2NTYsImV4cCI6MjEwMTM2MDY1Nn0.D7UGpZgA9sJcpLIMZB8_js_yEChFkn6JDThXYMzOgqk';

// No Paystack key is hardcoded here. This flow uses PaystackPop's
// resumeTransaction(access_code) — the transaction (and the Paystack
// public key it's tied to) was already created server-side by
// initialize-payment.js using the SECRET key. The secret key never
// reaches the browser, and no public key is needed on this page either.
// ============================================================

const supabaseClient = SUPABASE_URL.startsWith('http')
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

const form = document.getElementById('registrationForm');
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
  paymentOverlay.hidden = false;
}

function hidePaymentOverlay() {
  paymentOverlay.hidden = true;
}

hidePaymentOverlay()

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();

  const firstName = document.getElementById('firstName').value.trim();
  const lastName = document.getElementById('lastName').value.trim();
  const email = document.getElementById('email').value.trim();
  const phone = document.getElementById('phone').value.trim();
  const course = document.getElementById('course').value;
  const workStatus = document.getElementById('workStatus').value;
  const education = document.getElementById('education').value;
  const stateOfResidence = document.getElementById('stateOfResidence').value;
  const dateOfBirth = document.getElementById('dateOfBirth').value;
  const awareBeginnerCourse = document.getElementById('awareBeginnerCourse').value;
  const volunteeringInterest = document.getElementById('volunteeringInterest').value;

  // ---- Client-side validation ----
  if (
    !firstName ||
    !lastName ||
    !email ||
    !phone ||
    !course ||
    !workStatus ||
    !education ||
    !stateOfResidence ||
    !dateOfBirth ||
    !awareBeginnerCourse ||
    !volunteeringInterest
  ) {
    showError('Please fill in every field before continuing.');
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

  const today = new Date().toISOString().split('T')[0];
  if (dateOfBirth > today) {
    showError('Date of birth cannot be in the future.');
    return;
  }

  if (!supabaseClient) {
    showError('Registration is not configured yet. Please contact the site admin.');
    console.error('Supabase client not initialized — check SUPABASE_URL / SUPABASE_ANON_KEY in register.js');
    return;
  }

  if (typeof PaystackPop === 'undefined') {
    showError('Payment is not available right now. Please refresh the page and try again.');
    console.error('PaystackPop is not defined — check that the InlineJS v2 script tag loaded in register.html');
    return;
  }

  setLoading(true, 'Saving your details…');

  // Generate the registration ID client-side (instead of relying on
  // Postgres RETURNING, which RLS SELECT policies would otherwise block
  // for the anon/public key). This ID is what ties the registration to
  // its payment record end-to-end.
  const registrationId = crypto.randomUUID();

  try {
    // ---- 1. Save the registration to Supabase BEFORE payment (paid = false by default) ----
    const { error: insertError } = await supabaseClient.from('registrations').insert([
      {
        id: registrationId,
        first_name: firstName,
        last_name: lastName,
        email: email,
        phone: phone,
        course: course,
        work_status: workStatus,
        education: education,
        state_of_residence: stateOfResidence,
        date_of_birth: dateOfBirth,
        aware_of_beginner_course: awareBeginnerCourse,
        interested_in_volunteering: volunteeringInterest,
      },
    ]);

    if (insertError) {
      console.error('Supabase insert error:', insertError);
      showError('Something went wrong saving your registration. Please try again.');
      setLoading(false, 'Proceed to payment');
      return;
    }

    // ---- 2. Ask our Netlify Function to initialize the Paystack transaction ----
    setLoading(true, 'Preparing payment…');

    const initRes = await fetch('/.netlify/functions/initialize-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationId, email, course }),
    });

    const initData = await initRes.json();

    if (!initRes.ok || !initData.access_code) {
      console.error('initialize-payment error:', initData);
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
        // Show the full-screen confirmation overlay right away so the
        // transition from the closing Paystack popup to the success page
        // feels deliberate, not frozen.
        showPaymentOverlay('Confirming your payment…');
        setLoading(true, 'Confirming payment…');

        try {
          const verifyRes = await fetch(
            `/.netlify/functions/verify-payment?reference=${encodeURIComponent(transaction.reference)}`
          );
          const verifyData = await verifyRes.json();

          if (verifyRes.ok && verifyData.status === 'success') {
            // ---- 5. Success — go to the success page ----
            const params = new URLSearchParams({
              reference: transaction.reference,
              course: verifyData.course || course,
            });
            window.location.href = `payment-success.html?${params.toString()}`;
            return;
          }

          console.error('verify-payment did not confirm success:', verifyData);
          hidePaymentOverlay();
          showError('We could not confirm your payment. If you were charged, please contact support with your payment reference.');
          setLoading(false, 'Proceed to payment');
        } catch (err) {
          console.error('verify-payment request failed:', err);
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
    console.error('Unexpected registration error:', err);
    showError('Unexpected error. Please check your connection and try again.');
    setLoading(false, 'Proceed to payment');
  }
});
