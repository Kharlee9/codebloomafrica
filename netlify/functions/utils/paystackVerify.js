// netlify/functions/utils/paystackVerify.js
//
// Shared logic: verify a transaction reference directly with Paystack
// (never trust status passed in from the browser alone), then persist
// the result to Supabase. Used by both verify-payment.js (triggered by the
// browser after the InlineJS onSuccess callback) and paystack-webhook.js
// (triggered server-to-server by Paystack), so both paths always agree —
// and processing is idempotent no matter which one runs first.

async function verifyAndRecordPayment(reference, supabase, paystackSecretKey) {
  // 1. Ask Paystack for the authoritative status of this transaction.
  const paystackRes = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: { Authorization: `Bearer ${paystackSecretKey}` } }
  );
  const paystackData = await paystackRes.json();

  if (!paystackRes.ok || !paystackData.status) {
    throw new Error(`Paystack verify failed: ${JSON.stringify(paystackData)}`);
  }

  const tx = paystackData.data;
  const isSuccess = tx.status === 'success';
  const registrationId = tx.metadata && tx.metadata.registrationId;
  const course = tx.metadata && tx.metadata.course;
  const amountNaira = tx.amount / 100; // Paystack amounts are in kobo
  const paidAt = tx.paid_at || new Date().toISOString();
  const transactionId = tx.id || null; // Paystack's numeric transaction id

  if (!registrationId) {
    throw new Error(`Transaction ${reference} is missing registrationId metadata`);
  }

  // 2. Idempotency guard — the browser call and the webhook can both land
  // here for the same transaction. If we've already recorded success,
  // don't reprocess or overwrite anything.
  const { data: existingPayment } = await supabase
    .from('payments')
    .select('id, status')
    .eq('reference', reference)
    .maybeSingle();

  if (existingPayment && existingPayment.status === 'success') {
    return {
      status: 'success',
      already_processed: true,
      course,
      amount: amountNaira,
      reference,
      transaction_id: transactionId,
    };
  }

  // 3. Upsert the payments ledger record (unique on `reference`).
  const { error: paymentError } = await supabase
    .from('payments')
    .upsert(
      [
        {
          registration_id: registrationId,
          reference,
          amount: amountNaira,
          status: isSuccess ? 'success' : 'failed',
          email: tx.customer && tx.customer.email,
          paid_at: isSuccess ? paidAt : null,
          transaction_id: transactionId,
          raw_response: tx,
        },
      ],
      { onConflict: 'reference' }
    );

  if (paymentError) {
    throw new Error(`Failed to upsert payments record: ${paymentError.message}`);
  }

  // 4. Reflect the outcome on the registration itself.
  const registrationUpdate = isSuccess
    ? {
        paid: true,
        payment_status: 'success',
        payment_reference: reference,
        payment_date: paidAt,
        payment_amount: amountNaira,
        payment_transaction_id: transactionId,
      }
    : { payment_status: 'failed' };

  const { error: regError } = await supabase
    .from('registrations')
    .update(registrationUpdate)
    .eq('id', registrationId);

  if (regError) {
    throw new Error(`Failed to update registration: ${regError.message}`);
  }

  return {
    status: isSuccess ? 'success' : 'failed',
    course,
    amount: amountNaira,
    reference,
    transaction_id: transactionId,
  };
}

module.exports = { verifyAndRecordPayment };
