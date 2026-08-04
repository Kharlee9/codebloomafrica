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

// Celebratory confetti burst, played once on load.
if (typeof confetti === 'function') {
  confetti({
    particleCount: 140,
    spread: 80,
    startVelocity: 45,
    origin: { y: 0.35 },
    colors: ['#F5C400', '#111111', '#4ADE80', '#3B82F6', '#FFFFFF'],
  });
}
