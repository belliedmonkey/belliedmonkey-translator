// src/app/agent-face.js — minimal agent/v1 confirm and failure surface.
//
// Copy is the lock in agent/copy.js. This file does not invent those strings.
// It does not start the microphone and it does not read the page.
import { EXT_NOTE_FOR_AI, CLOSE, MESSAGES } from '../../agent/copy.js';
import { failureCard } from '../../agent/confirm.js';
import { handleAgentUrl } from '../../agent/session.js';

function $(id) { return document.getElementById(id); }

function clearFace() {
  const old = $('agent-confirm');
  if (old) old.remove();
}

function button(className, label) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = label;
  return b;
}

function mount(card, opts) {
  clearFace();
  const back = document.createElement('div');
  back.id = 'agent-confirm';
  back.className = 'agent-back';
  const sheet = document.createElement('div');
  sheet.className = 'agent-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');

  const title = document.createElement('h2');
  title.textContent = card.title || '';
  sheet.appendChild(title);

  if (card.actionLabel) {
    const name = document.createElement('p');
    name.className = 'agent-name';
    name.textContent = card.actionLabel;
    sheet.appendChild(name);
  }
  if (card.line) {
    const line = document.createElement('p');
    line.className = 'agent-line';
    line.textContent = card.line;
    sheet.appendChild(line);
  }
  if (card.site) {
    const site = document.createElement('p');
    site.className = 'agent-site';
    site.textContent = card.site;
    sheet.appendChild(site);
  }
  (card.touches || []).forEach((touch) => {
    const p = document.createElement('p');
    p.className = 'agent-touch';
    p.textContent = touch;
    sheet.appendChild(p);
  });
  if (card.footnote) {
    const note = document.createElement('p');
    note.className = 'agent-note';
    note.textContent = card.footnote;
    sheet.appendChild(note);
  }
  if (card.message && !card.line) {
    const msg = document.createElement('p');
    msg.className = 'agent-line';
    msg.textContent = card.message;
    sheet.appendChild(msg);
  }

  let deviceBox = null;
  let assistantBox = null;
  let pasteBox = null;
  if (card.deviceAllow) {
    deviceBox = check(card.deviceAllow);
    sheet.appendChild(deviceBox.label);
  }
  if (card.assistantAllow) {
    assistantBox = check(card.assistantAllow);
    sheet.appendChild(assistantBox.label);
  }
  if (card.paste) {
    pasteBox = document.createElement('textarea');
    pasteBox.className = 'agent-paste';
    pasteBox.maxLength = 2000;
    pasteBox.setAttribute('aria-label', card.paste);
    sheet.appendChild(pasteBox);
  }

  const acts = document.createElement('div');
  acts.className = 'agent-acts';
  const primary = button('agent-primary', card.primary || CLOSE);
  const secondary = card.secondary ? button('agent-secondary secondary', card.secondary) : null;
  acts.appendChild(primary);
  if (secondary) acts.appendChild(secondary);
  sheet.appendChild(acts);
  back.appendChild(sheet);
  document.body.appendChild(back);
  try { primary.focus(); } catch (_) {}

  const busy = (on) => {
    primary.disabled = on;
    if (secondary) secondary.disabled = on;
  };

  return new Promise((resolve) => {
    const finish = (value) => { clearFace(); resolve(value); };
    primary.addEventListener('click', () => {
      busy(true);
      const value = {
        allow: true,
        device: !!(deviceBox && deviceBox.input.checked),
        assistant: !!(assistantBox && assistantBox.input.checked),
        paste: pasteBox ? pasteBox.value : '',
        primary: true,
      };
      Promise.resolve(opts.onPrimary ? opts.onPrimary(value) : value).then(finish, () => finish(value));
    });
    if (secondary) {
      secondary.addEventListener('click', () => {
        busy(true);
        Promise.resolve(opts.onSecondary ? opts.onSecondary() : { allow: false }).then(
          (v) => finish(v == null ? { allow: false } : v),
          () => finish({ allow: false }));
      });
    }
    back.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') finish({ allow: false });
    });
  });
}

function check(labelText) {
  const label = document.createElement('label');
  label.className = 'agent-check';
  const input = document.createElement('input');
  input.type = 'checkbox';
  const span = document.createElement('span');
  span.textContent = labelText;
  label.appendChild(input);
  label.appendChild(span);
  return { label, input };
}

function siteTail(message, line) {
  const msg = String(message || '');
  const head = String(line || '');
  if (!head || msg.slice(0, head.length) !== head) return '';
  const rest = msg.slice(head.length);
  if (rest.length < 3) return '';
  return rest.slice(1, -1);
}

function stepOf(fix) {
  if (!fix || !fix.open_setup) return '';
  try { return new URL(fix.open_setup).searchParams.get('step') || ''; }
  catch (_) { return ''; }
}

function ctaFor(receipt) {
  const locked = failureCard(receipt.code);
  if (locked) return locked.primary;
  const step = stepOf(receipt.fix);
  if (step === 'login') return MESSAGES.goLogin;
  if (step === 'mic') return failureCard('need_permission_mic').primary;
  if (step === 'packs') return failureCard('need_packs').primary;
  if (step === 'install_ext') return failureCard('need_ext').primary;
  if (step === 'engine') return failureCard('need_engine').primary;
  return '';
}

export async function presentAgentDeepLink(raw, host) {
  const ui = {
    confirm(card) {
      return mount(card, {});
    },
    async show(receipt, fail) {
      if (receipt && receipt.ok) {
        await mount({
          title: receipt.message || '',
          primary: CLOSE,
        }, {});
        return;
      }
      const card = fail ? {
        title: fail.title,
        line: fail.line,
          site: receipt.code === 'site_unsupported' ? siteTail(receipt.message, fail.line) : '',
        primary: fail.primary,
        secondary: fail.secondary,
      } : {
        title: receipt.action || '',
        message: receipt.message,
        primary: ctaFor(receipt) || CLOSE,
        secondary: ctaFor(receipt) ? CLOSE : '',
      };
      await mount(card, {
        onPrimary: async () => {
          if (receipt.code === 'site_unsupported' && host.ports && host.ports.enterSubtitle) {
            await host.ports.enterSubtitle({ action: 'start_live_subtitles', langs: {}, step: '', mode: 'explain', text: '', site: '' });
          } else if (host.ports && host.ports.openSetup && stepOf(receipt.fix)) {
            await host.ports.openSetup({ step: stepOf(receipt.fix), langs: {}, mode: 'explain', text: '', site: '' });
          }
          return { allow: false };
        },
        onSecondary: async () => {
          if (receipt.code === 'need_ext' && navigator.clipboard && navigator.clipboard.writeText) {
            const link = receipt.fix && receipt.fix.open_setup ? receipt.fix.open_setup : '';
            const body = link ? EXT_NOTE_FOR_AI + '\n' + link : EXT_NOTE_FOR_AI;
            try { await navigator.clipboard.writeText(body); } catch (_) {}
          }
          return { allow: false };
        },
      });
    },
  };
  return handleAgentUrl(raw, host, ui);
}
