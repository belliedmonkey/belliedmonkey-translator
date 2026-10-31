// ws-transcribe.js — sentence cutters for streaming transcripts.
//
// History: until 2026-09-17 this file was the live-transcription WebSocket transport
// (domain-design §2.4 tier B — one client, vendor differences as message adapters keyed
// by the registry's `liveType`). Live transcription is now a DEVICE capability reached
// through the native bridge (`app/native-speech.js`, learning-design §9.6 门控 2026-09-17
// 修订); no registry entry carries a live endpoint any more, so the socket adapters were
// removed rather than left to rot. What stayed is the part every streaming source still
// needs — turning a stream of words into whole sentences — because the on-device
// recogniser's finals are time slices that cut mid-word (measured 2026-09-12, §9.6.1),
// exactly the shape the cloud deltas had. The name stayed so the bundle lists and the
// probe script keep pointing at one file.
//
// Consumers: asr-source.js (file-tier cue splitting), listen-core.js's stream cutter
// (`cut` injection), scripts/asr-probe.js (research tool).
'use strict';

var WsTranscribe = (() => {
  // A sentence ends at a CJK terminal (no space follows in CJK text), or at a Latin
  // terminal that is followed by whitespace / end — so "michael.com" and "3.5" never cut.
  const SENTENCE_RE = /[\s\S]*?(?:[。！？]+["'”’)\]]*|[.!?…]+["'”’)\]]*(?=\s|$))|[\s\S]+$/g;
  function splitSentences(text) {
    return (String(text || '').match(SENTENCE_RE) || []).map((x) => x.trim()).filter(Boolean);
  }
  // Complete sentences = every match except a trailing one that lacks a terminal.
  function completeSentences(text) {
    const parts = splitSentences(text);
    if (parts.length && !/(?:[。！？.!?…]+["'”’)\]]*)$/.test(parts[parts.length - 1])) return { done: parts.slice(0, -1), tail: parts[parts.length - 1] };
    return { done: parts, tail: '' };
  }

  // A tiny sentence cutter for word-delta streams: emits a final as soon as the buffer
  // holds a terminal, keeps the rest as the open partial. Same closing intent as
  // TranslationCore.createCueMerger; that one works on cues, this one on characters.
  //
  // Run-on speech (a speaker who never lands a period) would otherwise hold the pair
  // back indefinitely, so a long open tail is closed at its last CLAUSE boundary
  // (comma / semicolon / dash / CJK 、，；) once it passes CLAUSE_CHARS, and at a word
  // boundary once it passes HARD_CHARS. Still never a word or a fragment: the unit the
  // Engine receives is a clause with its context, which is what §2.4 rule 3 protects.
  const CLAUSE_CHARS = 90;
  const HARD_CHARS = 160;
  const CLAUSE_RE = /[,;:，、；：—–]\s*(?=\S)/g;
  function clauseCut(text) {
    if (text.length < CLAUSE_CHARS) return null;
    let last = -1, m;
    CLAUSE_RE.lastIndex = 0;
    while ((m = CLAUSE_RE.exec(text))) if (m.index >= 20) last = m.index + m[0].length;
    if (last > 0) return last;
    if (text.length >= HARD_CHARS) { const sp = text.lastIndexOf(' ', HARD_CHARS); return sp > 20 ? sp + 1 : HARD_CHARS; }
    return null;
  }
  function sentenceCutter(emit) {
    let pending = '';
    return {
      add(delta) {
        pending += delta || '';
        const { done, tail } = completeSentences(pending);
        for (const s of done) emit({ kind: 'final', text: s });
        pending = tail;
        let cut;
        while ((cut = clauseCut(pending)) != null) {
          const head = pending.slice(0, cut).trim();
          pending = pending.slice(cut);
          if (head) emit({ kind: 'final', text: head });
        }
        if (pending.trim()) emit({ kind: 'partial', text: pending.trim() });
      },
      flush() { const t = pending.trim(); pending = ''; if (t) emit({ kind: 'final', text: t }); },
      // 丢掉开口的尾句而不发出（调用方已经用别的方式消费了它，例如 App 的「我说」松手）
      reset() { pending = ''; },
    };
  }

  // For CUMULATIVE interim hypotheses (each interim is the whole utterance so far,
  // occasionally revising earlier words; a final arrives only when the speaker pauses).
  // Sentences are cut from the interim as soon as they are no longer the tail (text
  // follows the terminal ⇒ the recogniser has moved on ⇒ revisions are rare). Already
  // emitted sentences are never re-emitted; the final only flushes what is left.
  function interimCutter(emit) {
    let emitted = 0;   // sentences already emitted for the current utterance
    let head = '';     // the current utterance's opening characters — a text that does not
                       // start with them is a NEW utterance (measured: a vendor's final for
                       // utterance N can arrive AFTER the first interim of N+1, so an
                       // activity-start event is not a safe reset point; the text is)
    const recent = []; // last few emitted sentences — a revised final never re-emits one
    const split = splitSentences;
    const sameUtterance = (text) => !head || String(text).slice(0, 12) === head;
    const say = (s) => { if (recent.indexOf(s) >= 0) return; recent.push(s); if (recent.length > 6) recent.shift(); emit({ kind: 'final', text: s }); };
    return {
      interim(text) {
        if (!sameUtterance(text)) { emitted = 0; }
        head = String(text).slice(0, 12);
        const parts = split(text);
        const stable = parts.length - 1; // the tail may still change
        for (let i = emitted; i < stable; i++) say(parts[i]);
        if (stable > emitted) emitted = stable;
        if (parts.length > emitted) emit({ kind: 'partial', text: parts.slice(emitted).join(' ') });
      },
      final(text) {
        if (!sameUtterance(text)) emitted = 0;
        const parts = split(text);
        for (let i = emitted; i < parts.length; i++) say(parts[i]);
        emitted = 0; head = '';
      },
      reset() { /* utterance boundaries are detected from the text itself */ },
    };
  }

  return { sentenceCutter, interimCutter, splitSentences, completeSentences, clauseCut, CLAUSE_CHARS, HARD_CHARS };
})();

if (typeof window !== 'undefined') window.WsTranscribe = WsTranscribe;
if (typeof module !== 'undefined' && module.exports) module.exports = WsTranscribe;
