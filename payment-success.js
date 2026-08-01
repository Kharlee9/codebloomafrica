// payment-success.js
//
// This page is only ever reached after register.js has already called
// verify-payment and confirmed the transaction server-side — so there is
// no re-verification here, just a presentational confirmation using the
// details passed along in the URL.

const messageEl = document.getElementById('statusMessage');

const params = new URLSearchParams(window.location.search);
const course = params.get('course');

if (course) {
  messageEl.textContent = `You're all set for ${course}. A confirmation has been recorded — join our WhatsApp community below to get next steps and connect with your cohort.`;
}
