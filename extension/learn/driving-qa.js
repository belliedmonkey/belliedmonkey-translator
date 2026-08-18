// driving-qa.js — 驾车模式的问答引擎 (§9.5): a spoken question about the current
// card, answered by the user's OWN chat-capable engine and read back by TTS.
//
// Transport rides LearnNotes.chat (§9.2/§9.3/§4.2c) — the ONE place that knows
// the two wire formats. Own prompt version constant; it NEVER touches the notes
// PROMPT_VERSION (§12's version discipline — bumping that re-charges every
// user's cached notes).
//
// NO CACHE, on purpose (§9.5, §12): questions are free-form conversation, a
// per-(card, question) cache would almost never hit, and keeping the notes
// store's "cached forever" promise honest matters more than a phantom saving.
// The cost contract is stated at the entry point instead: one call per question.
//
// Answers are for text-to-speech: short plain sentences, no markup, rendered
// via textContent only — model output is untrusted.

var DrivingQA = (() => {
  // Bump ONLY when a prompt change corrects WRONG output (§9.2's rule). With no
  // cache there is nothing to invalidate — the constant exists so tests and
  // future cache decisions have a version to hang on to.
  const QA_PROMPT_VERSION = 1;

  const SYSTEM = 'You are a language tutor. The learner is DRIVING and listening'
    + ' hands-free; your answer will be read aloud by text-to-speech. You receive'
    + ' a sentence in the language the learner is studying, its translation, and'
    + ' the learner\'s spoken question about it (the transcript may contain'
    + ' recognition errors — interpret charitably). Answer the question about'
    + ' THIS sentence in {answerLang}, in 2 to 4 short plain sentences suitable'
    + ' for being spoken aloud. No markdown, no lists, no JSON, no headings —'
    + ' just plain conversational sentences.';

  function buildUser(item, question) {
    return 'Sentence (' + ((item && item.lang) || 'und') + '): ' + ((item && item.text) || '')
      + '\nTranslation: ' + ((item && item.tr) || '')
      + '\nLearner\'s question: ' + String(question == null ? '' : question);
  }

  // Same gate as the notes entry point — a chat-capable engine with a key. The
  // driving voice loop ANDs this with the STT gate and a uiLang voice
  // (interaction-spec 驾车模式 gate ladder); those live with the orchestrator.
  function capable() { return LearnNotes.capable(); }

  // One call per question. Errors carry LearnNotes.chat's named codes
  // (no_base / http / empty_output) — the session surface maps them to copy.
  async function ask(item, question, answerLang) {
    const system = SYSTEM.replace('{answerLang}', answerLang || 'the language of the translation');
    const text = await LearnNotes.chat(system, buildUser(item, question));
    return String(text).trim();
  }

  return { ask, capable, buildUser, SYSTEM, QA_PROMPT_VERSION };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = DrivingQA;
