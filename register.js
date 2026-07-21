// ============================================================
// CONFIG — fill these in before going live
// ============================================================
const SUPABASE_URL = 'YOUR_SUPABASE_PROJECT_URL';       // e.g. https://xxxx.supabase.co
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';      // Project Settings > API > anon public key
const PAYMENT_REDIRECT_URL = 'https://example.com/pay';  // your external payment link
// ============================================================

const supabaseClient = (SUPABASE_URL.startsWith('http'))
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

const form = document.getElementById('registrationForm');
const submitBtn = document.getElementById('submitBtn');
const submitLabel = document.getElementById('submitLabel');
const formError = document.getElementById('formError');

function showError(message){
  formError.textContent = message;
  formError.hidden = false;
}

function clearError(){
  formError.hidden = true;
  formError.textContent = '';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();

  const firstName = document.getElementById('firstName').value.trim();
  const lastName = document.getElementById('lastName').value.trim();
  const email = document.getElementById('email').value.trim();
  const phone = document.getElementById('phone').value.trim();
  const course = document.getElementById('course').value;

  if(!firstName || !lastName || !email || !phone || !course){
    showError('Please fill in every field before continuing.');
    return;
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if(!emailPattern.test(email)){
    showError('Please enter a valid email address.');
    return;
  }

  submitBtn.disabled = true;
  submitLabel.textContent = 'Submitting…';

  if(!supabaseClient){
    console.warn('Supabase is not configured yet — skipping save and redirecting for testing.');
    redirectToPayment({ firstName, lastName, email, phone, course });
    return;
  }

  const { error } = await supabaseClient
    .from('registrations')
    .insert([{
      first_name: firstName,
      last_name: lastName,
      email: email,
      phone: phone,
      course: course
    }]);

  if(error){
    console.error('Supabase insert error:', error);
    showError('Something went wrong saving your registration. Please try again.');
    submitBtn.disabled = false;
    submitLabel.textContent = 'Proceed to payment';
    return;
  }

  redirectToPayment({ firstName, lastName, email, phone, course });
});

function redirectToPayment(data){
  submitLabel.textContent = 'Redirecting…';
  const url = new URL(PAYMENT_REDIRECT_URL);
  url.searchParams.set('email', data.email);
  url.searchParams.set('course', data.course);
  window.location.href = url.toString();
}
