'use strict';

// The send gate. This is not a tokenizer and it does not treat characters/4 as tokens.
// Reservation stays the configured maxInputTokens + maxOutputTokens either way.

function requestBody(req) {
  return JSON.stringify({
    model: req.model,
    temperature: req.temperature,
    seed: req.seed,
    max_tokens: req.maxTokens,
    messages: req.messages,
  });
}

function measure(body, bound, countTokens) {
  if (!bound || bound.kind === 'counter') {
    if (typeof countTokens !== 'function') {
      return { ok: false, code: 'tokenizer-unspecified', exact: false };
    }
    const n = countTokens(body);
    if (!Number.isInteger(n) || n < 0) {
      return { ok: false, code: 'tokenizer-unspecified', exact: false };
    }
    return { ok: true, code: 'counted', declaredTokens: n, method: 'counter', exact: false };
  }
  if (bound.kind !== 'utf8-bytes-plus-overhead') {
    return { ok: false, code: 'tokenizer-unspecified', exact: false };
  }
  const utf8Bytes = Buffer.byteLength(body, 'utf8');
  return {
    ok: true,
    code: 'bounded',
    declaredTokens: utf8Bytes + bound.overheadTokens,
    utf8Bytes: utf8Bytes,
    overheadTokens: bound.overheadTokens,
    method: 'utf8-bytes-plus-overhead',
    exact: false,
  };
}

function checkRequest(req, prices, bound, countTokens) {
  const body = requestBody(req);
  const measured = measure(body, bound, countTokens);
  if (!measured.ok) return Object.assign({ body: body }, measured);
  const fits = measured.declaredTokens <= prices.maxInputTokens;
  return Object.assign({ body: body, fits: fits }, measured, {
    code: fits ? measured.code : 'input-over-bound',
    ok: fits,
  });
}

module.exports = { requestBody, measure, checkRequest };
