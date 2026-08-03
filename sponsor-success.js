// sponsor-success.js
//
// This page is only ever reached after sponsor.js has already called
// verify-sponsor-payment and confirmed the transaction server-side — so
// there is no re-verification here, just a presentational confirmation
// using the details passed along in the URL.

const messageEl = document.getElementById('statusMessage');

const params = new URLSearchParams(window.location.search);
const count = parseInt(params.get('count'), 10);

if (Number.isInteger(count) && count > 0) {
  const peopleLabel = count === 1 ? 'person' : 'people';
  messageEl.textContent = `Your payment was successful — and because of you, ${count} ${peopleLabel} now ${count === 1 ? 'has' : 'have'} access to life-changing tech education. Thank you for investing in Africa's next generation of tech leaders.`;
}
