// ============================================================
// CONFIG — fill these in before going live
// ============================================================
// The anon key is safe to expose in browser code — it can ONLY insert
// new registration rows (see supabase-schema.sql RLS policy), nothing else.
const SUPABASE_URL = 'https://imhxynxgozcgmectrrbk.supabase.co';   // e.g. https://xxxx.supabase.co
const SUPABASE_ANON_KEY = 'sb_publishable_0fnv8uQOhJTK2V4t3VsiCQ_DY-tkMig'; // Project Settings > API > anon public key
// ============================================================

const supabaseClient = SUPABASE_URL.startsWith('http')
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

const form = document.getElementById('registrationForm');
const submitBtn = document.getElementById('submitBtn');
const submitLabel = document.getElementById('submitLabel');
const formError = document.getElementById('formError');

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

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();

  const firstName = document.getElementById('firstName').value.trim();
  const lastName = document.getElementById('lastName').value.trim();
  const email = document.getElementById('email').value.trim();
  const phone = document.getElementById('phone').value.trim();
  const course = document.getElementById('course').value;

  // ---- Client-side validation ----
  if (!firstName || !lastName || !email || !phone || !course) {
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

  if (!supabaseClient) {
    showError('Registration is not configured yet. Please contact the site admin.');
    console.error('Supabase client not initialized — check SUPABASE_URL / SUPABASE_ANON_KEY in register.js');
    return;
  }

  setLoading(true, 'Saving your details…');

  // Generate the registration ID client-side (instead of relying on
  // Postgres RETURNING, which RLS SELECT policies would otherwise block
  // for the anon/public key). This ID is what ties the registration to
  // its payment record end-to-end.
  const registrationId = crypto.randomUUID();

  try {
    // ---- 1. Save the registration to Supabase BEFORE payment ----
    const { error: insertError } = await supabaseClient.from('registrations').insert([
      {
        id: registrationId,
        first_name: firstName,
        last_name: lastName,
        email: email,
        phone: phone,
        course: course,
      },
    ]);

    if (insertError) {
      console.error('Supabase insert error:', insertError);
      showError('Something went wrong saving your registration. Please try again.');
      setLoading(false, 'Proceed to payment');
      return;
    }

    // ---- 2. Ask our Netlify Function to initialize the Paystack transaction ----
    setLoading(true, 'Redirecting to payment…');

    const response = await fetch('/.netlify/functions/create-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationId, email, course }),
    });

    const data = await response.json();

    if (!response.ok || !data.authorization_url) {
      console.error('create-payment error:', data);
      showError(data.error || 'Could not start payment. Please try again.');
      setLoading(false, 'Proceed to payment');
      return;
    }

    // ---- 3. Redirect the browser to Paystack Checkout ----
    window.location.href = data.authorization_url;
  } catch (err) {
    console.error('Unexpected registration error:', err);
    showError('Unexpected error. Please check your connection and try again.');
    setLoading(false, 'Proceed to payment');
  }
});
