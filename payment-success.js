// payment-success.js
//
// Paystack redirects the browser back here after Checkout with the
// transaction reference in the query string (as `reference` and/or
// `trxref`). This page never trusts that redirect on its own — it calls
// our verify-payment Netlify Function, which re-checks the transaction
// directly with Paystack before treating it as paid. The Paystack webhook
// (server-to-server) independently confirms the same transaction, so the
// registration is marked paid correctly even if the visitor closes this
// tab before it finishes loading.

const spinner = document.getElementById('statusSpinner');
const titleEl = document.getElementById('statusTitle');
const messageEl = document.getElementById('statusMessage');
const actionsEl = document.getElementById('statusActions');

function renderState(state, { title, message, actions }) {
  spinner.classList.remove('success', 'failed');
  if (state !== 'loading') spinner.classList.add(state);
  titleEl.textContent = title;
  messageEl.textContent = message;

  actionsEl.innerHTML = '';
  if (actions && actions.length) {
    actions.forEach((action) => {
      const a = document.createElement('a');
      a.href = action.href;
      a.textContent = action.label;
      a.className = `btn ${action.primary ? 'btn-dark' : 'btn-outline'}`;
      actionsEl.appendChild(a);
    });
    actionsEl.hidden = false;
  } else {
    actionsEl.hidden = true;
  }
}

async function verify() {
  const params = new URLSearchParams(window.location.search);
  const reference = params.get('reference') || params.get('trxref');

  if (!reference) {
    renderState('failed', {
      title: 'Missing transaction reference',
      message: "We couldn't find a payment reference in the URL. If you completed a payment, please contact support with your email address.",
      actions: [{ href: 'register.html', label: 'Back to registration' }],
    });
    return;
  }

  try {
    const response = await fetch(
      `/.netlify/functions/verify-payment?reference=${encodeURIComponent(reference)}`
    );
    const data = await response.json();

    if (response.ok && data.status === 'success') {
      renderState('success', {
        title: 'Payment successful 🎉',
        message: `You're all set for ${data.course || 'your course'}. A confirmation has been recorded — we'll be in touch on WhatsApp with next steps.`,
        actions: [{ href: 'index.html', label: 'Back to home', primary: true }],
      });
      return;
    }

    if (data.already_processed) {
      renderState('success', {
        title: 'Payment already confirmed',
        message: 'This transaction was already verified and recorded. You\'re good to go.',
        actions: [{ href: 'index.html', label: 'Back to home', primary: true }],
      });
      return;
    }

    renderState('failed', {
      title: 'Payment not successful',
      message: 'Your transaction could not be confirmed as successful. If you were charged, please contact support with your payment reference before trying again.',
      actions: [
        { href: 'register.html', label: 'Try again', primary: true },
        { href: 'index.html', label: 'Back to home' },
      ],
    });
  } catch (err) {
    console.error('verify-payment request failed:', err);
    renderState('failed', {
      title: 'Could not verify payment',
      message: 'We ran into a connection issue while confirming your payment. Please refresh this page — if the problem persists, contact support.',
      actions: [{ href: 'register.html', label: 'Back to registration' }],
    });
  }
}

verify();
