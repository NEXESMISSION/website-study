/* Course Folder: exam engine.
   Reads the exam from <script type="application/json" id="exam-data">, renders a cover → timed exam → results report,
   grades out of 20, finds weak topics, and keeps attempt history + an in-progress draft in localStorage.
   Question types: mcq, tf (optional justify), numeric, text (self-marked with a rubric), grid, journal, match, problem (parts). */
(function () {
  'use strict';

  const dataEl = document.getElementById('exam-data');
  const root = document.getElementById('exam');
  if (!dataEl || !root) return;
  const EXAM = JSON.parse(dataEl.textContent);
  const KEY = 'course-folder:exam:' + EXAM.id;
  const DRAFT_KEY = KEY + ':draft';
  const LETTERS = 'abcdefghijklmnop';
  const HUB = EXAM.hub || 'index.html';
  const HOME = EXAM.home || '../index.html';

  /* ---------------- helpers ---------------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const strip = s => String(s == null ? '' : s).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  const numOr = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const round2 = v => Math.round(v * 100) / 100;
  function readJSON(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function writeJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
  function removeKey(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  const fmtNum = v => {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v !== 'number') return String(v);
    const abs = Math.abs(v);
    const s = abs.toLocaleString('en-US', { maximumFractionDigits: 4 });
    return (v < 0 ? '−' : '') + s;
  };
  const fmtTime = sec => {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
  };

  /* Parse what a student typed: "1,500" "1 500" "1.5" "1,5" "(1,300)" "-7000" "7.5%" "€8,050" "146 days" "—" */
  const UNIT_TAIL = /[A-Za-zÀ-ɏ\/][A-Za-zÀ-ɏ\/.²³]*$/;   // a unit word typed after the number (applied after spaces are removed)
  function parseNum(raw) {
    if (raw === null || raw === undefined) return null;
    let s = String(raw).trim();
    if (!s) return null;
    let neg = false;
    s = s.replace(/[−–—]/g, '-');
    if (/^-+$/.test(s)) return 0;                                   // a lone dash means nil, as in accounting tables
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/[\s  ']/g, '').replace(/(TND|DT|dinars?|millimes?|€|£|\$|¥|₺|%)/gi, '');
    s = s.replace(UNIT_TAIL, '');                                    // "146 days", "282.8 ft/s", "43.9 members per week"
    if (s.startsWith('+')) s = s.slice(1);
    if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
    if (s.includes('.') && s.includes(',')) {
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (s.includes(',')) {
      if (/^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, '');
      else s = s.replace(',', '.');
    } else if (/^\d{1,3}(\.\d{3}){2,}$/.test(s)) {
      s = s.replace(/\./g, '');
    }
    if (!/^(\d+\.?\d*|\.\d+)(e-?\d+)?$/i.test(s)) return NaN;
    const v = parseFloat(s);
    return neg ? -v : v;
  }
  /* All plausible readings of what was typed. Tunisian (French) writing uses a decimal comma ("356,708" = 356.708)
     while English uses a thousands comma ("1,500" = 1500): when the text is ambiguous, keep both readings. */
  function parseAll(raw) {
    const v = parseNum(raw);
    if (v === null || v === undefined) return [];
    const out = isNaN(v) ? [] : [v];
    let s = String(raw).replace(/[−–—]/g, '-').replace(/[\s  ']/g, '').replace(/(TND|DT|dinars?|millimes?|€|£|\$|¥|₺|%)/gi, '');
    s = s.replace(UNIT_TAIL, '');
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (s.startsWith('+')) s = s.slice(1);
    if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
    if (/^\d{1,3},\d{3}$/.test(s)) out.push((neg ? -1 : 1) * parseFloat(s.replace(',', '.')));      // "356,708" → also 356.708
    if (/^\d{1,3}\.\d{3}$/.test(s)) out.push((neg ? -1 : 1) * parseFloat(s.replace('.', '')));      // "1.500" → also 1500
    return out;
  }
  function close(v, ans, tol) {
    if (v === null || v === undefined || isNaN(v)) return false;
    const t = typeof tol === 'number' ? tol : Math.max(Math.abs(ans) * 0.005, 0.01);
    return Math.abs(v - ans) <= t + 1e-9;
  }
  function closeAny(raw, ans, tol) { return parseAll(raw).some(v => close(v, ans, tol)); }

  /* ---------------- model ---------------- */
  const questions = [];
  const items = [];
  EXAM.sections.forEach((sec, si) => {
    sec.questions.forEach(q => {
      const n = questions.length + 1;
      const entry = { q, n, qid: q.id || ('q' + n), si, items: [] };
      const inherit = { topic: q.topic, review: q.review };
      if (q.type === 'problem') q.parts.forEach((p, pi) => addItem(entry, p, entry.qid + LETTERS[pi], '(' + LETTERS[pi] + ')', inherit));
      else addItem(entry, q, entry.qid, '', inherit);
      questions.push(entry);
    });
  });
  function addItem(entry, spec, id, label, inherit) {
    const it = { id, spec, label, entry, type: spec.type, topic: spec.topic || inherit.topic || 'General', review: spec.review || inherit.review || '' };
    if (spec.type === 'match') it.points = numOr(spec.pointsEach, 1) * spec.items.length;
    else if (spec.type === 'text') it.points = numOr(spec.points, (spec.rubric || []).reduce((a, r) => a + numOr(r.points, 0), 0) || 1);
    else it.points = numOr(spec.points, 1);
    entry.items.push(it); items.push(it);
    if (spec.type === 'tf' && spec.justify) {
      const jp = numOr(spec.justify.points, 1);
      const j = {
        id: id + 'j', label: (label ? label + ' ' : '') + 'justification', entry, type: 'text', isJustify: true, parent: it,
        topic: it.topic, review: it.review, points: jp,
        spec: { type: 'text', points: jp, rubric: spec.justify.rubric || [{ text: 'My justification gives the correct reason', points: jp }], model: spec.justify.model || '' }
      };
      it.justify = j; entry.items.push(j); items.push(j);
    }
  }
  const MAX = round2(items.reduce((a, it) => a + it.points, 0));
  const SELF_ITEMS = items.filter(it => it.type === 'text');

  /* ---------------- state ---------------- */
  let state = { mode: 'timed', answers: {}, flags: {}, start: 0, deadline: 0 };
  let timerHandle = null;
  let lastResult = null; // { attemptIndex, ticks: {itemId: [bool]} }

  function saveDraft() { writeJSON(DRAFT_KEY, state); }
  function history() { return readJSON(KEY, { attempts: [] }); }

  /* ---------------- answered? ---------------- */
  function isAnswered(it) {
    const a = state.answers[it.id];
    switch (it.type) {
      case 'mcq': return typeof a === 'number';
      case 'tf': return a === true || a === false;
      case 'numeric': case 'text': return typeof a === 'string' && a.trim() !== '';
      case 'grid': return !!a && Object.values(a).some(v => String(v).trim() !== '');
      case 'journal': return !!a && (a.noEntry || (a.lines || []).some(l => l && (l.account || String(l.dr || '').trim() || String(l.cr || '').trim())));
      case 'match': return Array.isArray(a) && a.some(v => typeof v === 'number');
      default: return false;
    }
  }
  function entryState(entry) {
    const n = entry.items.filter(isAnswered).length;
    return n === 0 ? '' : (n === entry.items.length ? 'done' : 'part');
  }

  /* ---------------- rendering: inputs ---------------- */
  function gridGiven(spec, r, c) { return (spec.given || []).some(g => g[0] === r && g[1] === c); }
  function renderInput(it) {
    const s = it.spec, id = it.id, a = state.answers[id];
    switch (it.type) {
      case 'mcq':
        return '<div class="x-opts" role="radiogroup">' + s.options.map((o, i) =>
          `<label class="x-opt"><input type="radio" name="${id}" value="${i}" data-item="${id}" data-kind="mcq" ${a === i ? 'checked' : ''}><span class="k">${LETTERS[i]}</span><span>${o}</span></label>`).join('') + '</div>';
      case 'tf':
        return '<div class="x-opts x-tf" role="radiogroup">' + [['true', 'True'], ['false', 'False']].map(([v, l]) =>
          `<label class="x-opt"><input type="radio" name="${id}" value="${v}" data-item="${id}" data-kind="tf" ${String(a) === v ? 'checked' : ''}><span>${l}</span></label>`).join('') + '</div>' +
          (it.justify ? `<label class="x-hint" for="in-${it.justify.id}">Justify your answer${it.justify.points ? ' (' + it.justify.points + ' pt' + (it.justify.points > 1 ? 's' : '') + ')' : ''}:</label><textarea id="in-${it.justify.id}" rows="3" data-item="${it.justify.id}" data-kind="text" placeholder="Explain why…">${esc(state.answers[it.justify.id] || '')}</textarea>` : '');
      case 'numeric':
        return `<div class="x-num"><input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" data-item="${id}" data-kind="numeric" value="${esc(a || '')}" aria-label="Your answer">${s.unit ? `<span class="x-unit">${esc(s.unit)}</span>` : ''}</div>` +
          (s.hint ? `<div class="x-hint">${s.hint}</div>` : '');
      case 'text':
        return `<textarea rows="${s.rows || 5}" data-item="${id}" data-kind="text" placeholder="Write your answer…">${esc(a || '')}</textarea>`;
      case 'grid': {
        const head = '<tr><th></th>' + s.columns.map(c => `<th>${c}</th>`).join('') + '</tr>';
        const body = s.rows.map((r, ri) => `<tr class="${r.total ? 'total' : ''}"><th scope="row">${r.label}</th>` + r.cells.map((v, ci) => {
          if (gridGiven(s, ri, ci)) return `<td class="given">${fmtNum(v)}</td>`;
          const key = ri + ',' + ci;
          return `<td><input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" data-item="${id}" data-kind="grid" data-cell="${key}" value="${esc((a && a[key]) || '')}" aria-label="${esc(strip(r.label))}, ${esc(strip(s.columns[ci]))}"></td>`;
        }).join('') + '</tr>').join('');
        return `<div class="x-grid-wrap"><table class="x-grid"><thead>${head}</thead><tbody>${body}</tbody></table></div><div class="x-hint">${s.hint || 'Type amounts with a minus sign for decreases (e.g. -7000). Leave a cell empty when the column is not affected.'}</div>`;
      }
      case 'journal': {
        const accounts = s.accounts || EXAM.accounts || [];
        const n = s.lines || Math.max(3, (s.answer || []).length + 1);
        const lines = (a && a.lines) || [];
        let rows = '';
        for (let i = 0; i < n; i++) {
          const l = lines[i] || {};
          rows += `<tr><td><select data-item="${id}" data-kind="journal" data-line="${i}" data-field="account" aria-label="Account, line ${i + 1}"><option value="">— account —</option>${accounts.map(ac => `<option ${l.account === ac ? 'selected' : ''}>${esc(ac)}</option>`).join('')}</select></td>` +
            `<td><input type="text" inputmode="decimal" autocomplete="off" data-item="${id}" data-kind="journal" data-line="${i}" data-field="dr" value="${esc(l.dr || '')}" aria-label="Debit, line ${i + 1}"></td>` +
            `<td><input type="text" inputmode="decimal" autocomplete="off" data-item="${id}" data-kind="journal" data-line="${i}" data-field="cr" value="${esc(l.cr || '')}" aria-label="Credit, line ${i + 1}"></td></tr>`;
        }
        return `<div class="x-grid-wrap" style="border:0"><table class="x-journal"><thead><tr><th>Account</th><th style="width:130px">Debit</th><th style="width:130px">Credit</th></tr></thead><tbody>${rows}</tbody></table></div>` +
          `<label class="x-noentry"><input type="checkbox" data-item="${id}" data-kind="journal" data-field="noEntry" ${a && a.noEntry ? 'checked' : ''}> No entry required</label>`;
      }
      case 'match': {
        const arr = Array.isArray(a) ? a : [];
        return '<table class="x-match"><tbody>' + s.items.map((m, i) =>
          `<tr><td>${m.text}</td><td style="width:45%"><select data-item="${id}" data-kind="match" data-idx="${i}" aria-label="Answer for item ${i + 1}"><option value="">— choose —</option>${s.choices.map((c, ci) => `<option value="${ci}" ${arr[i] === ci ? 'selected' : ''}>${esc(strip(c))}</option>`).join('')}</select></td></tr>`).join('') + '</tbody></table>';
      }
    }
    return '';
  }
  const TYPE_NAME = { mcq: 'Multiple choice', tf: 'True or false', numeric: 'Calculation', text: 'Written answer', grid: 'Table', journal: 'Journal entry', match: 'Matching', problem: 'Problem' };
  const ptsLabel = p => round2(p) + (p === 1 ? ' pt' : ' pts');

  /* ---------------- screens ---------------- */
  function topBar(extra) {
    return `<header class="x-top ${EXAM.courseClass || ''}"><div class="x-top-in"><nav class="crumbs"><a href="${HOME}">Course Folder</a><span class="sep">/</span><a href="${HUB}">Exams</a><span class="sep">/</span><span class="here">${esc(EXAM.shortTitle || EXAM.title)}</span></nav>${extra || ''}</div></header>`;
  }

  function renderCover() {
    stopTimer();
    document.body.className = EXAM.courseClass || '';
    const draft = readJSON(DRAFT_KEY, null);
    const h = history().attempts;
    const nQ = questions.length;
    const histRows = h.slice().reverse().slice(0, 8).map(at => `<tr><td>${new Date(at.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td><td class="n">${at.score20.toFixed(2)} / 20</td><td>${at.mode === 'timed' ? 'Timed' : 'Practice'}</td><td>${at.pending ? 'self-marking unfinished' : ''}</td></tr>`).join('');
    root.innerHTML = topBar() + `
      <div class="x-cover">
        <span class="kicker"><span class="dot"></span>${esc(EXAM.course)} · ${esc(EXAM.covers || '')}</span>
        <h1>${esc(EXAM.title)}</h1>
        ${EXAM.description ? `<p class="lede">${EXAM.description}</p>` : ''}
        <div class="x-facts">
          <div class="x-fact"><b>${EXAM.duration}</b><span>minutes</span></div>
          <div class="x-fact"><b>${nQ}</b><span>questions</span></div>
          <div class="x-fact"><b>${MAX}</b><span>points → mark / 20</span></div>
          <div class="x-fact"><b>${h.length ? Math.max(...h.map(x => x.score20)).toFixed(1) : '—'}</b><span>your best / 20</span></div>
        </div>
        <div class="x-rules"><h3>Instructions</h3><ul>${(EXAM.instructions || []).map(i => `<li>${i}</li>`).join('')}
          <li>Answers are only revealed after you submit. Then you get your mark out of 20, your score per topic, your weak spots, and a full correction.</li>
          ${SELF_ITEMS.length ? '<li>Written answers are marked by you, honestly, against the official rubric shown after you submit.</li>' : ''}</ul></div>
        <div class="x-modes">
          <label class="x-mode"><input type="radio" name="x-mode" value="timed" checked><div><b>Exam mode (recommended)</b><span>${EXAM.duration}-minute timer, auto-submits at 0:00. No notes, no lessons. Like the real thing.</span></div></label>
          <label class="x-mode"><input type="radio" name="x-mode" value="practice"><div><b>Practice mode</b><span>No time limit. Use it after a first timed attempt, to fix your weak spots.</span></div></label>
        </div>
        <div class="x-actions">
          <button class="x-btn primary" id="x-start">Start the exam</button>
          ${draft && draft.start ? '<button class="x-btn" id="x-resume">Resume the exam in progress</button><button class="x-btn ghost small" id="x-discard">Discard it</button>' : ''}
          <a class="x-btn ghost" href="${HUB}">All exams</a>
        </div>
        ${h.length ? `<div class="x-history"><table><thead><tr><th>Attempt</th><th class="n">Mark</th><th>Mode</th><th></th></tr></thead><tbody>${histRows}</tbody></table></div>` : '<p class="x-note">No attempts yet. Do it in exam mode first: your first score is the honest picture of where you are.</p>'}
      </div>`;
    document.getElementById('x-start').onclick = () => {
      const mode = (root.querySelector('input[name="x-mode"]:checked') || {}).value || 'timed';
      state = { mode, answers: {}, flags: {}, start: Date.now(), deadline: mode === 'timed' ? Date.now() + EXAM.duration * 60000 : 0 };
      saveDraft(); renderExam();
    };
    const r = document.getElementById('x-resume');
    if (r) r.onclick = () => { state = draft; if (state.mode === 'timed' && state.deadline && Date.now() >= state.deadline) submit(true); else renderExam(); };
    const d = document.getElementById('x-discard');
    if (d) d.onclick = () => { removeKey(DRAFT_KEY); renderCover(); };
    window.scrollTo(0, 0);
  }

  function renderExam() {
    document.body.className = EXAM.courseClass || '';
    let html = topBar(`<div class="x-status"><span class="x-count"><b id="x-answered">0</b> / ${questions.length} answered</span>${state.mode === 'timed' ? '<span class="x-timer" id="x-timer" aria-live="off">--:--</span>' : '<span class="x-timer">Practice</span>'}<button class="x-btn primary small" id="x-submit-top">Submit</button></div>`);
    html += '<div class="x-page"><main class="x-main">';
    EXAM.sections.forEach((sec, si) => {
      const secMax = questions.filter(e => e.si === si).reduce((a, e) => a + e.items.reduce((b, it) => b + it.points, 0), 0);
      html += `<div class="x-sec-h"><h2>${sec.title}</h2><p>${sec.intro ? sec.intro + ' · ' : ''}${ptsLabel(secMax)}</p></div>`;
      questions.filter(e => e.si === si).forEach(e => { html += renderQuestion(e); });
    });
    html += `<div class="x-submitbar" id="x-submitbar"><b>Finished?</b><span class="x-note">Check the palette: grey or empty boxes are questions you haven't fully answered.</span><div class="x-actions"><button class="x-btn primary" id="x-submit">Submit my exam</button></div><div id="x-confirm"></div></div>`;
    html += '</main><aside class="x-palette"><div class="x-pal-box"><h4>Questions</h4><div class="x-pal" id="x-pal"></div><div class="x-legend"><span><i style="background:var(--ink)"></i>answered</span><span><i style="background:var(--tint)"></i>partly answered</span><span><i style="box-shadow:inset 0 -3px 0 var(--warn)"></i>flagged for review</span></div></div></aside></div>';
    root.innerHTML = html;
    root.querySelectorAll('[data-item]').forEach(el => {
      el.addEventListener(el.tagName === 'SELECT' || el.type === 'radio' || el.type === 'checkbox' ? 'change' : 'input', onInput);
    });
    root.querySelectorAll('.x-flag').forEach(b => b.addEventListener('click', () => {
      const q = b.dataset.q; state.flags[q] = !state.flags[q]; saveDraft();
      b.classList.toggle('on', !!state.flags[q]); b.textContent = state.flags[q] ? '⚑ Flagged' : '⚐ Flag';
      document.getElementById('box-' + q).classList.toggle('flagged', !!state.flags[q]); paintPalette();
    }));
    const ask = () => askSubmit();
    document.getElementById('x-submit').onclick = ask;
    document.getElementById('x-submit-top').onclick = ask;
    paintPalette();
    startTimer();
    window.scrollTo(0, 0);
  }

  function renderQuestion(e) {
    const q = e.q, pts = e.items.reduce((a, it) => a + it.points, 0);
    let body = `<div class="x-prompt">${q.prompt || ''}</div>`;
    if (q.type === 'problem') {
      body += e.items.filter(it => !it.isJustify).map(it => `<div class="x-part"><div class="x-part-h"><span class="x-part-l">${it.label}</span><span class="x-q-pts">${ptsLabel(it.points + (it.justify ? it.justify.points : 0))}</span></div><div class="x-prompt">${it.spec.prompt || ''}</div>${renderInput(it)}</div>`).join('');
    } else {
      body += renderInput(e.items[0]);
    }
    return `<section class="x-q ${state.flags[e.qid] ? 'flagged' : ''}" id="box-${e.qid}"><div class="x-q-h"><span class="x-q-n">${e.n}</span><span class="x-q-type">${TYPE_NAME[q.type] || ''}</span><span class="x-q-pts">${ptsLabel(pts)}</span><button type="button" class="x-flag ${state.flags[e.qid] ? 'on' : ''}" data-q="${e.qid}">${state.flags[e.qid] ? '⚑ Flagged' : '⚐ Flag'}</button></div>${body}</section>`;
  }

  function onInput(ev) {
    const el = ev.target, id = el.dataset.item, kind = el.dataset.kind;
    const A = state.answers;
    if (kind === 'mcq') A[id] = Number(el.value);
    else if (kind === 'tf') A[id] = el.value === 'true';
    else if (kind === 'numeric' || kind === 'text') A[id] = el.value;
    else if (kind === 'grid') { A[id] = A[id] || {}; A[id][el.dataset.cell] = el.value; }
    else if (kind === 'journal') {
      A[id] = A[id] || { noEntry: false, lines: [] };
      if (el.dataset.field === 'noEntry') A[id].noEntry = el.checked;
      else { const i = Number(el.dataset.line); A[id].lines[i] = A[id].lines[i] || {}; A[id].lines[i][el.dataset.field] = el.value; }
    } else if (kind === 'match') { A[id] = Array.isArray(A[id]) ? A[id] : []; A[id][Number(el.dataset.idx)] = el.value === '' ? null : Number(el.value); }
    saveDraft(); paintPalette();
  }

  function paintPalette() {
    const pal = document.getElementById('x-pal');
    if (!pal) return;
    pal.innerHTML = questions.map(e => `<a href="#box-${e.qid}" class="${entryState(e)} ${state.flags[e.qid] ? 'flag' : ''}" title="Question ${e.n}">${e.n}</a>`).join('');
    const n = questions.filter(e => entryState(e) === 'done').length;
    const c = document.getElementById('x-answered'); if (c) c.textContent = n;
  }

  function startTimer() {
    stopTimer();
    if (state.mode !== 'timed') return;
    const tick = () => {
      const left = (state.deadline - Date.now()) / 1000;
      const el = document.getElementById('x-timer');
      if (el) {
        el.textContent = fmtTime(left);
        el.classList.toggle('warn', left <= 300 && left > 60);
        el.classList.toggle('danger', left <= 60);
      }
      if (left <= 0) { stopTimer(); submit(true); }
    };
    tick(); timerHandle = setInterval(tick, 1000);
  }
  function stopTimer() { if (timerHandle) { clearInterval(timerHandle); timerHandle = null; } }

  function askSubmit() {
    const missing = questions.filter(e => entryState(e) !== 'done').map(e => e.n);
    const box = document.getElementById('x-confirm');
    if (!missing.length) { submit(false); return; }
    box.innerHTML = `<div class="x-confirm"><b>${missing.length} question${missing.length > 1 ? 's are' : ' is'} not fully answered: ${missing.join(', ')}.</b><span>In a real exam a blank answer scores 0. Submit anyway?</span><div class="x-actions"><button class="x-btn danger" id="x-yes">Yes, submit now</button><button class="x-btn" id="x-no">Keep working</button></div></div>`;
    document.getElementById('x-submitbar').scrollIntoView({ block: 'center' });
    document.getElementById('x-yes').onclick = () => submit(false);
    document.getElementById('x-no').onclick = () => { box.innerHTML = ''; };
  }

  /* ---------------- grading ---------------- */
  function grade(it, ticks) {
    const s = it.spec, a = state.answers[it.id], max = it.points;
    const res = { got: 0, max, status: 'wrong' };
    switch (it.type) {
      case 'mcq': if (typeof a !== 'number') res.status = 'blank'; else if (a === s.answer) { res.got = max; res.status = 'right'; } break;
      case 'tf': if (a !== true && a !== false) res.status = 'blank'; else if (a === s.answer) { res.got = max; res.status = 'right'; } break;
      case 'numeric': {
        if (parseNum(a) === null) res.status = 'blank';
        else if (closeAny(a, s.answer, s.tol)) { res.got = max; res.status = 'right'; }
        else if (Array.isArray(s.alsoAccept) && s.alsoAccept.some(x => closeAny(a, x, s.tol))) { res.got = max; res.status = 'right'; }
        break;
      }
      case 'text': {
        const rub = s.rubric || [];
        const rubMax = rub.reduce((x, r) => x + numOr(r.points, 0), 0) || 1;
        const t = (ticks && ticks[it.id]) || null;
        if (!isAnswered(it) && !t) { res.status = 'blank'; break; }
        if (!t) { res.status = 'pending'; break; }
        const got = rub.reduce((x, r, i) => x + (t[i] ? numOr(r.points, 0) : 0), 0);
        res.got = round2(got / rubMax * max);
        res.status = res.got >= max - 1e-9 ? 'right' : (res.got > 0 ? 'partial' : 'wrong');
        break;
      }
      case 'grid': {
        let scored = 0, correct = 0, extra = 0; const cellRes = {};
        s.rows.forEach((r, ri) => r.cells.forEach((exp, ci) => {
          if (gridGiven(s, ri, ci)) return;
          const key = ri + ',' + ci, raw = a ? a[key] : '', v = parseNum(raw);
          const expected = typeof exp === 'number' ? exp : 0;
          if (expected !== 0) {
            scored++;
            const ok = closeAny(raw, expected, typeof s.tol === 'number' ? s.tol : 0.5);
            if (ok) correct++;
            cellRes[key] = ok ? 'ok' : 'no';
          } else if (v !== null && !(Math.abs(v) < 1e-9)) { extra++; cellRes[key] = 'no'; }
        }));
        const share = scored ? max / scored : 0;
        res.got = round2(Math.max(0, (correct - extra) * share));
        res.detail = { scored, correct, extra, cellRes };
        res.status = !isAnswered(it) ? 'blank' : (res.got >= max - 1e-9 ? 'right' : (res.got > 0 ? 'partial' : 'wrong'));
        break;
      }
      case 'journal': {
        const exp = s.answer || [];
        const ans = a || { noEntry: false, lines: [] };
        const filled = raw => String(raw || '').trim() !== '' && parseNum(raw) !== 0;   // "", "0" and "—" leave a line empty
        const lines = (ans.lines || []).filter(l => l && (l.account || filled(l.dr) || filled(l.cr))).map(l => {
          const dr = parseNum(l.dr), cr = parseNum(l.cr);
          const side = dr !== null && !isNaN(dr) && dr !== 0 ? (cr !== null && cr !== 0 ? 'both' : 'Dr') : (cr !== null && !isNaN(cr) && cr !== 0 ? 'Cr' : 'none');
          return { account: l.account || '', side, amount: side === 'Dr' ? dr : side === 'Cr' ? cr : NaN, raw: side === 'Dr' ? l.dr : side === 'Cr' ? l.cr : '', used: false };
        });
        if (!isAnswered(it)) { res.status = 'blank'; break; }
        if (!exp.length) {
          if (ans.noEntry && !lines.length) { res.got = max; res.status = 'right'; }
          res.detail = { matched: [], lines };
          break;
        }
        if (ans.noEntry) { res.detail = { matched: exp.map(() => false), lines }; break; }
        // the same account twice on the same side ("Cash 1,200" + "Cash 1,800") is judged as one line holding the total
        const groups = [];
        lines.forEach(l => {
          const g = (l.side === 'Dr' || l.side === 'Cr') && l.account ? groups.find(x => x.account === l.account && x.side === l.side) : null;
          if (g) g.lines.push(l); else groups.push({ account: l.account, side: l.side, lines: [l], used: false });
        });
        const totals = g => g.lines.reduce((acc, l) => { const out = []; acc.forEach(x => parseAll(l.raw).forEach(y => out.push(x + y))); return out.slice(0, 64); }, [0]);
        const matched = exp.map(e => {
          const g = groups.find(x => !x.used && x.account === e.account && x.side === e.side && totals(x).some(v => close(v, e.amount, 0.5)));
          if (g) { g.used = true; g.lines.forEach(l => { l.used = true; }); return true; } return false;
        });
        // a wrong line only loses its own share; lines beyond the number needed each cancel one correct line (no "list every account" gaming)
        const nMatch = matched.filter(Boolean).length, extras = Math.max(0, groups.length - exp.length);
        res.got = round2(Math.max(0, (nMatch - extras) / exp.length * max));
        res.detail = { matched, lines };
        res.status = res.got >= max - 1e-9 ? 'right' : (res.got > 0 ? 'partial' : 'wrong');
        break;
      }
      case 'match': {
        const arr = Array.isArray(a) ? a : [];
        const each = numOr(s.pointsEach, 1);
        const ok = s.items.map((m, i) => arr[i] === m.answer);
        res.got = round2(ok.filter(Boolean).length * each);
        res.detail = { ok };
        res.status = !isAnswered(it) ? 'blank' : (res.got >= max - 1e-9 ? 'right' : (res.got > 0 ? 'partial' : 'wrong'));
        break;
      }
    }
    return res;
  }

  function computeAll(ticks) {
    const per = {}; let got = 0, pendingPts = 0;
    items.forEach(it => { const r = grade(it, ticks); per[it.id] = r; got += r.got; if (r.status === 'pending') pendingPts += it.points; });
    const topics = {};
    items.forEach(it => {
      const k = it.topic;
      topics[k] = topics[k] || { label: k, got: 0, max: 0, review: it.review, course: EXAM.course };
      topics[k].got += per[it.id].got; topics[k].max += it.points;
      if (!topics[k].review && it.review) topics[k].review = it.review;
    });
    Object.values(topics).forEach(t => { t.got = round2(t.got); t.max = round2(t.max); });
    const sections = EXAM.sections.map((sec, si) => {
      const its = items.filter(it => it.entry.si === si);
      return { title: strip(sec.title), got: round2(its.reduce((x, it) => x + per[it.id].got, 0)), max: round2(its.reduce((x, it) => x + it.points, 0)) };
    });
    got = round2(got);
    return { per, got, max: MAX, score20: round2(got / MAX * 20), topics, sections, pendingPts: round2(pendingPts) };
  }

  /* ---------------- submit & results ---------------- */
  function submit(auto) {
    stopTimer();
    const used = Math.round((Date.now() - state.start) / 1000);
    const ticks = {};
    const R = computeAll(ticks);
    const h = history();
    const attempt = buildAttempt(R, used);
    h.attempts.push(attempt);
    writeJSON(KEY, h);
    removeKey(DRAFT_KEY);
    lastResult = { attemptIndex: h.attempts.length - 1, ticks, used, auto };
    renderResults();
  }
  function buildAttempt(R, used) {
    return {
      at: new Date().toISOString(), mode: state.mode, timeUsedSec: used, got: R.got, max: R.max, score20: R.score20,
      pending: R.pendingPts > 0, topics: R.topics, sections: R.sections, course: EXAM.course, title: EXAM.title,
      wrong: items.filter(it => ['wrong', 'blank', 'partial'].includes(R.per[it.id].status)).map(it => ({ q: it.entry.n + (it.label ? ' ' + it.label : ''), topic: it.topic, status: R.per[it.id].status }))
    };
  }
  function band(s20) {
    if (s20 >= 16) return ['b-great', 'Very good'];
    if (s20 >= 14) return ['b-good', 'Good'];
    if (s20 >= 10) return ['b-pass', 'Pass'];
    return ['b-fail', 'Below 10: fail'];
  }

  function renderResults() {
    const R = computeAll(lastResult.ticks);
    updateAttempt(R);
    const [bc, bl] = band(R.score20);
    const topics = Object.values(R.topics).map(t => ({ ...t, pct: t.max ? t.got / t.max : 0 })).sort((x, y) => x.pct - y.pct);
    const weak = topics.filter(t => t.pct < 0.6);
    const statusChip = p => p < 0.6 ? '<span class="chip weak">Weak</span>' : p < 0.8 ? '<span class="chip review">Review</span>' : '<span class="chip solid">Solid</span>';
    const barColor = p => p < 0.6 ? 'var(--bad)' : p < 0.8 ? 'var(--warn)' : 'var(--ok)';
    let html = topBar(`<div class="x-status"><a class="x-btn small" href="${HUB}">All exams</a><button class="x-btn primary small" id="x-retake">Retake</button></div>`);
    html += `<div class="x-results">
      <div class="x-score"><div><div class="x-score-big" id="x-big">${R.score20.toFixed(2)}<small> / 20</small></div><span class="x-band ${bc}" id="x-bandchip">${bl}</span></div>
        <div class="x-score-meta"><b>${esc(EXAM.title)}</b><span>Points: <b id="x-raw">${R.got}</b> / ${R.max} · Time used: ${fmtTime(lastResult.used)}${state.mode === 'timed' ? ' of ' + EXAM.duration + ':00' : ' (practice mode)'}${lastResult.auto ? ' · auto-submitted when time ran out' : ''}</span>
        <span id="x-sections">${sectionsText(R)}</span></div></div>
      <div id="x-pendingbox">${R.pendingPts > 0 ? `<div class="x-pending">${R.pendingPts} points are written answers waiting for your self-marking. Scroll to the correction, compare with the model answer, and tick what you really wrote. Your mark updates live.</div>` : ''}</div>
      <section style="display:flex;flex-direction:column;gap:12px"><h2 class="x-h2">Your weak spots</h2>
        <div class="x-weak ${weak.length ? '' : 'none'}" id="x-weakbox">${weakHtml(weak)}</div></section>
      <section style="display:flex;flex-direction:column;gap:12px"><h2 class="x-h2">Score by topic</h2>
        <div class="table-wrap"><table class="x-topics"><thead><tr><th>Topic</th><th class="n">Points</th><th>Level</th><th></th><th></th></tr></thead><tbody id="x-topicrows">${topics.map(t => `<tr><td>${esc(t.label)}</td><td class="n">${t.got}/${t.max}</td><td><div class="x-bar"><i style="width:${Math.round(t.pct * 100)}%;background:${barColor(t.pct)}"></i></div></td><td>${statusChip(t.pct)}</td><td>${t.review ? `<a href="${t.review}">Review</a>` : ''}</td></tr>`).join('')}</tbody></table></div></section>
      <section style="display:flex;flex-direction:column;gap:12px"><h2 class="x-h2">Send your result to Claude</h2>
        <p class="x-note">Copy this and paste it in the chat: Claude will adapt your study plan to your weak spots.</p>
        <div class="x-actions"><button class="x-btn" id="x-copy">Copy my result</button><span class="x-copied" id="x-copied"></span></div>
        <textarea class="x-text-copy" id="x-copytext" readonly>${esc(summaryText(R))}</textarea></section>
      <section style="display:flex;flex-direction:column;gap:12px"><h2 class="x-h2">Full correction</h2><div class="x-review">${questions.map(e => reviewQuestion(e, R)).join('')}</div></section>
      <div class="x-actions"><button class="x-btn primary" id="x-retake2">Retake this exam</button><a class="x-btn" href="${HUB}">Back to all exams</a></div>
    </div>`;
    root.innerHTML = html;
    root.querySelectorAll('[data-tick]').forEach(cb => cb.addEventListener('change', () => {
      const id = cb.dataset.tick, idx = Number(cb.dataset.idx);
      const n = (items.find(x => x.id === id).spec.rubric || []).length;
      lastResult.ticks[id] = lastResult.ticks[id] || new Array(n).fill(false);
      lastResult.ticks[id][idx] = cb.checked;
      refreshScore();
    }));
    root.querySelectorAll('[data-nocredit]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.nocredit, n = (items.find(x => x.id === id).spec.rubric || []).length;
      lastResult.ticks[id] = new Array(n).fill(false);
      root.querySelectorAll(`[data-tick="${id}"]`).forEach(cb => { cb.checked = false; });
      refreshScore();
    }));
    const retake = () => { lastResult = null; renderCover(); };
    document.getElementById('x-retake').onclick = retake;
    document.getElementById('x-retake2').onclick = retake;
    document.getElementById('x-copy').onclick = () => {
      const t = document.getElementById('x-copytext');
      const done = () => { document.getElementById('x-copied').textContent = 'Copied. Paste it in the chat with Claude.'; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t.value).then(done, () => { t.select(); document.execCommand('copy'); done(); });
      else { t.select(); document.execCommand('copy'); done(); }
    };
    window.scrollTo(0, 0);
  }
  function sectionsText(R) { return R.sections.map(s => `${esc(s.title)}: <b>${s.got}</b>/${s.max}`).join(' · '); }
  function weakHtml(weak) {
    if (!weak.length) return '<b>No topic below 60%.</b><span>Look at the topics marked "Review" in the table, then retake the exam in a few days to confirm.</span>';
    return `<b>Study these first (below 60%):</b><ol>${weak.slice(0, 6).map(t => `<li><b>${esc(t.label)}</b>: ${t.got}/${t.max} points (${Math.round(t.pct * 100)}%)${t.review ? ` · <a href="${t.review}">open the lesson section</a>` : ''}</li>`).join('')}</ol><span class="x-note">Re-read the section, redo its "Check yourself" questions, then retake this exam in practice mode.</span>`;
  }
  function refreshScore() {
    const R = computeAll(lastResult.ticks);
    updateAttempt(R);
    const [bc, bl] = band(R.score20);
    document.getElementById('x-big').innerHTML = `${R.score20.toFixed(2)}<small> / 20</small>`;
    const chip = document.getElementById('x-bandchip'); chip.className = 'x-band ' + bc; chip.textContent = bl;
    document.getElementById('x-raw').textContent = R.got;
    document.getElementById('x-pendingbox').innerHTML = R.pendingPts > 0 ? `<div class="x-pending">${R.pendingPts} points are still waiting for your self-marking.</div>` : '';
    const topics = Object.values(R.topics).map(t => ({ ...t, pct: t.max ? t.got / t.max : 0 })).sort((x, y) => x.pct - y.pct);
    const statusChip = p => p < 0.6 ? '<span class="chip weak">Weak</span>' : p < 0.8 ? '<span class="chip review">Review</span>' : '<span class="chip solid">Solid</span>';
    const barColor = p => p < 0.6 ? 'var(--bad)' : p < 0.8 ? 'var(--warn)' : 'var(--ok)';
    document.getElementById('x-topicrows').innerHTML = topics.map(t => `<tr><td>${esc(t.label)}</td><td class="n">${t.got}/${t.max}</td><td><div class="x-bar"><i style="width:${Math.round(t.pct * 100)}%;background:${barColor(t.pct)}"></i></div></td><td>${statusChip(t.pct)}</td><td>${t.review ? `<a href="${t.review}">Review</a>` : ''}</td></tr>`).join('');
    const weak = topics.filter(t => t.pct < 0.6);
    const wb = document.getElementById('x-weakbox'); wb.className = 'x-weak ' + (weak.length ? '' : 'none'); wb.innerHTML = weakHtml(weak);
    document.getElementById('x-copytext').value = summaryText(R);
    document.getElementById('x-sections').innerHTML = sectionsText(R);
    questions.forEach(e => {
      const el = document.querySelector(`[data-qpts="${e.n}"]`); if (!el) return;
      el.textContent = `${round2(e.items.reduce((x, it) => x + R.per[it.id].got, 0))}/${round2(e.items.reduce((x, it) => x + it.points, 0))}`;
    });
    items.filter(it => it.type === 'text').forEach(it => {
      const v = document.getElementById('v-' + it.id); if (!v) return;
      const r = R.per[it.id]; v.className = 'verdict ' + r.status; v.textContent = verdictText(r);
    });
  }
  function updateAttempt(R) {
    const h = history();
    if (!lastResult || !h.attempts[lastResult.attemptIndex]) return;
    const old = h.attempts[lastResult.attemptIndex];
    const fresh = buildAttempt(R, lastResult.used);
    fresh.at = old.at; fresh.mode = old.mode;
    h.attempts[lastResult.attemptIndex] = fresh;
    writeJSON(KEY, h);
  }
  function summaryText(R) {
    const topics = Object.values(R.topics).map(t => ({ ...t, pct: t.max ? t.got / t.max : 0 })).sort((x, y) => x.pct - y.pct);
    const wrong = items.filter(it => ['wrong', 'blank', 'partial'].includes(R.per[it.id].status));
    return [
      `EXAM RESULT: ${EXAM.title} (${EXAM.course}, ${EXAM.covers || ''})`,
      `Mark: ${R.score20.toFixed(2)}/20 (${R.got}/${R.max} pts), mode: ${state.mode}, time used: ${fmtTime(lastResult.used)}${R.pendingPts ? ', ' + R.pendingPts + ' pts not self-marked' : ''}`,
      'By topic (weakest first):',
      ...topics.map(t => `- ${t.label}: ${t.got}/${t.max} (${Math.round(t.pct * 100)}%)`),
      'Lost points on: ' + (wrong.length ? wrong.map(it => `Q${it.entry.n}${it.label ? it.label : ''} [${it.topic}] ${R.per[it.id].status}`).join('; ') : 'nothing'),
    ].join('\n');
  }
  function verdictText(r) {
    return { right: 'Correct', wrong: 'Wrong', blank: 'Not answered', partial: 'Partly right', pending: 'Mark yourself' }[r.status] + (r.status === 'pending' ? '' : ` · ${r.got}/${round2(r.max)}`);
  }

  /* ---------------- review rendering ---------------- */
  function answerText(it) {
    const s = it.spec, a = state.answers[it.id];
    switch (it.type) {
      case 'mcq': return typeof a === 'number' ? `(${LETTERS[a]}) ${s.options[a]}` : '<i>no answer</i>';
      case 'tf': return a === true ? 'True' : a === false ? 'False' : '<i>no answer</i>';
      case 'numeric': return a && String(a).trim() ? esc(a) + (s.unit ? ' ' + esc(s.unit) : '') : '<i>no answer</i>';
      case 'text': return a && a.trim() ? esc(a).replace(/\n/g, '<br>') : '<i>no answer</i>';
      default: return '';
    }
  }
  function correctText(it) {
    const s = it.spec;
    switch (it.type) {
      case 'mcq': return `(${LETTERS[s.answer]}) ${s.options[s.answer]}`;
      case 'tf': return s.answer ? 'True' : 'False';
      case 'numeric': return fmtNum(s.answer) + (s.unit ? ' ' + esc(s.unit) : '');
      default: return '';
    }
  }
  function reviewItem(it, R) {
    const r = R.per[it.id], s = it.spec;
    let h = `<div class="x-r-h">${it.label ? `<span class="x-part-l">${it.label}</span>` : ''}<span class="verdict ${r.status}" id="v-${it.id}">${verdictText(r)}</span>${it.review ? `<a href="${it.review}" style="font-size:14px">Review: ${esc(it.topic)}</a>` : `<span class="x-note">${esc(it.topic)}</span>`}</div>`;
    if (it.entry.q.type === 'problem' && s.prompt && !it.isJustify) h += `<div class="x-prompt" style="font-size:15px">${s.prompt}</div>`;
    if (['mcq', 'tf', 'numeric'].includes(it.type)) {
      h += `<div class="x-yours"><b>Your answer</b>${answerText(it)}</div>`;
      if (r.status !== 'right') h += `<div class="x-correct"><b>Correct answer</b>${correctText(it)}</div>`;
    }
    if (it.type === 'text') {
      h += `<div class="x-yours"><b>${it.isJustify ? 'Your justification' : 'Your answer'}</b>${answerText(it)}</div>`;
      if (s.model) h += `<div class="x-model"><b style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);display:block">Model answer</b>${s.model}</div>`;
      const t = lastResult.ticks[it.id] || [];
      h += `<div class="x-rubric"><b style="font-size:13px">Mark yourself honestly: tick each point your answer really contains</b>${(s.rubric || []).map((rb, i) => `<label><input type="checkbox" data-tick="${it.id}" data-idx="${i}" ${t[i] ? 'checked' : ''}><span>${rb.text} <b>(${rb.points} pt${rb.points === 1 ? '' : 's'})</b></span></label>`).join('')}<div><button type="button" class="x-btn small ghost" data-nocredit="${it.id}">My answer has none of these (0 pts)</button></div></div>`;
    }
    if (it.type === 'grid') h += reviewGrid(it, r);
    if (it.type === 'journal') h += reviewJournal(it, r);
    if (it.type === 'match') h += reviewMatch(it, r);
    if (s.explain) h += `<div class="x-explain">${s.explain}</div>`;
    return h;
  }
  function reviewGrid(it, r) {
    const s = it.spec, a = state.answers[it.id] || {}, cr = (r.detail && r.detail.cellRes) || {};
    const head = '<tr><th></th>' + s.columns.map(c => `<th>${c}</th>`).join('') + '</tr>';
    const body = s.rows.map((row, ri) => `<tr class="${row.total ? 'total' : ''}"><th scope="row">${row.label}</th>` + row.cells.map((exp, ci) => {
      if (gridGiven(s, ri, ci)) return `<td class="given">${fmtNum(exp)}</td>`;
      const key = ri + ',' + ci, mine = a[key] && String(a[key]).trim() ? esc(a[key]) : '', cls = cr[key] || '';
      const expected = typeof exp === 'number' && exp !== 0 ? fmtNum(exp) : '';
      return `<td class="${cls}">${mine || (expected ? '<span style="color:var(--muted)">·</span>' : '')}${cls === 'no' || (!mine && expected) ? `<span class="exp">${expected || 'leave empty'}</span>` : ''}</td>`;
    }).join('') + '</tr>').join('');
    return `<div class="x-grid-wrap"><table class="x-grid"><thead>${head}</thead><tbody>${body}</tbody></table></div><div class="x-hint">Green = correct. Red = wrong (the expected value is shown in green under it). ${r.detail ? `${r.detail.correct}/${r.detail.scored} required cells correct${r.detail.extra ? `, ${r.detail.extra} cell(s) filled that should be empty (each costs one cell)` : ''}.` : ''}</div>`;
  }
  function reviewJournal(it, r) {
    const s = it.spec, exp = s.answer || [];
    const mine = ((r.detail && r.detail.lines) || []).map(l => `<tr><td>${esc(l.account || '—')}</td><td class="n">${l.side === 'Dr' ? fmtNum(l.amount) : ''}</td><td class="n">${l.side === 'Cr' ? fmtNum(l.amount) : ''}</td><td>${l.used ? '✓' : '✗'}</td></tr>`).join('');
    const ans = state.answers[it.id] || {};
    const correct = exp.length ? exp.map(e => `<tr><td style="${e.side === 'Cr' ? 'padding-left:2em' : ''}">${esc(e.account)}</td><td class="n">${e.side === 'Dr' ? fmtNum(e.amount) : ''}</td><td class="n">${e.side === 'Cr' ? fmtNum(e.amount) : ''}</td></tr>`).join('') : '<tr><td colspan="3"><b>No entry required</b> (the financial position does not change)</td></tr>';
    return `<div class="x-yours"><b>Your entry</b>${ans.noEntry ? 'You ticked "No entry required".' : (mine ? `<div class="table-wrap"><table><thead><tr><th>Account</th><th class="n">Debit</th><th class="n">Credit</th><th></th></tr></thead><tbody>${mine}</tbody></table></div>` : '<i>no answer</i>')}</div>` +
      (r.status !== 'right' ? `<div class="x-correct"><b>Correct entry</b><div class="table-wrap"><table><thead><tr><th>Account</th><th class="n">Debit</th><th class="n">Credit</th></tr></thead><tbody>${correct}</tbody></table></div></div>` : '');
  }
  function reviewMatch(it, r) {
    const s = it.spec, a = Array.isArray(state.answers[it.id]) ? state.answers[it.id] : [];
    return `<div class="table-wrap"><table><thead><tr><th>Item</th><th>Your answer</th><th>Correct</th></tr></thead><tbody>${s.items.map((m, i) => `<tr><td>${m.text}</td><td>${typeof a[i] === 'number' ? esc(strip(s.choices[a[i]])) : '<i>—</i>'} ${a[i] === m.answer ? '✓' : '✗'}</td><td>${esc(strip(s.choices[m.answer]))}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function reviewQuestion(e, R) {
    const got = round2(e.items.reduce((x, it) => x + R.per[it.id].got, 0)), max = round2(e.items.reduce((x, it) => x + it.points, 0));
    return `<section class="x-r"><div class="x-r-h"><span class="x-q-n">${e.n}</span><span class="x-q-type">${TYPE_NAME[e.q.type] || ''}</span><span class="x-q-pts" data-qpts="${e.n}">${got}/${max}</span></div><div class="x-prompt">${e.q.prompt || ''}</div>${e.items.map(it => `<div class="${e.q.type === 'problem' || it.isJustify ? 'x-part' : ''}" style="display:flex;flex-direction:column;gap:8px">${reviewItem(it, R)}</div>`).join('')}${e.q.explain && e.q.type === 'problem' ? `<div class="x-explain">${e.q.explain}</div>` : ''}</section>`;
  }

  /* ---------------- boot ---------------- */
  window.__exam = { EXAM, items, questions, parseNum, grade: id => grade(items.find(i => i.id === id), {}) }; // for testing
  renderCover();
})();
