/* Course Folder · one-card-at-a-time study engine (English ⇄ Arabic).
   Data: <script type="application/json" id="cards-data">
     { id, kicker, title, back, next?:{href,label}, ar?:{kicker,title}, cards:[...] }</script>
   Card kinds:
     learn  { title, why?, html }                                  → "Got it" button
     mcq    { title?, html, options:[...], answer:index, hint, explain }
     number { title?, html, answer:number, tol?, unit?, hint, explain }
   Every card may carry  ar:{ ...same text fields in Arabic... }  — used when the reader switches to Arabic.
   In Arabic text, wrap math in <span class="m">…</span> so it stays left-to-right.
   A question must be answered correctly to go on. "Give me a hint" is free; 1st wrong try → hint,
   2nd wrong try → full explanation (card goes to "look again"). Progress + language are saved in this browser. */
(function () {
  const D = JSON.parse(document.getElementById('cards-data').textContent);
  const KEY = 'course-folder:cards:' + D.id, LKEY = 'course-folder:lang';
  const root = document.getElementById('cards');
  let st = { i: 0, wrong: {}, done: {} };
  try { st = Object.assign(st, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
  let lang = 'en';
  try { if (localStorage.getItem(LKEY) === 'ar') lang = 'ar'; } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const N = D.cards.length;

  const T = {
    en: { learn: 'Learn', q: 'Your turn', why: 'Why learn this?', gotit: 'Got it →', next: 'Next →', check: 'Check',
      ph: 'Your answer', hintBtn: 'Give me a hint', hint: 'Hint:', notYet: 'Not yet. Hint:', notYet2: 'Not yet. Read the hint again and try once more.',
      answer: 'Here is the answer, step by step:', correct: 'Correct!', typeNum: 'Type a number.', typeNumEx: 'For example 12 or 3.5 (a comma also works: 3,5).',
      back: '← Back', prev: '← Previous card', restart: 'Start this unit again', arm: 'Click again to start over',
      card: 'Card', finished: 'Finished', unitDone: 'Unit finished', well: (a, b) => `Well done! ${a} / ${b} right on the first try.`,
      again: 'Look again at these cards:', perfect: 'Perfect. You can go to the next unit.', tell: 'Tell Claude your score in the chat:', toggle: 'عربي' },
    ar: { learn: 'تعلّم', q: 'دورك', why: 'لماذا نتعلّم هذا؟', gotit: 'فهمت ←', next: 'التالي ←', check: 'تحقّق',
      ph: 'إجابتك', hintBtn: 'أعطني تلميحًا', hint: 'تلميح:', notYet: 'ليس بعد. تلميح:', notYet2: 'ليس بعد. اقرأ التلميح مرة أخرى وحاول من جديد.',
      answer: 'هذا هو الحل خطوة بخطوة:', correct: 'صحيح!', typeNum: 'اكتب رقمًا.', typeNumEx: 'مثلًا 12 أو 3.5 (الفاصلة تعمل أيضًا: 3,5).',
      back: '→ رجوع', prev: '→ البطاقة السابقة', restart: 'ابدأ هذه الوحدة من جديد', arm: 'اضغط مرة أخرى للبدء من جديد',
      card: 'البطاقة', finished: 'انتهت', unitDone: 'انتهت الوحدة', well: (a, b) => `أحسنت! ${a} من ${b} صحيحة من المحاولة الأولى.`,
      again: 'راجع هذه البطاقات:', perfect: 'ممتاز. يمكنك الانتقال إلى الوحدة التالية.', tell: 'أرسل نتيجتك لـ Claude في المحادثة:', toggle: 'English' }
  };
  const t = k => T[lang][k];
  const L = (o, f) => (lang === 'ar' && o.ar && o.ar[f] != null) ? o.ar[f] : o[f];

  function parseNum(raw) {
    let s = String(raw || '').trim()
      .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 1632)).replace(/٫/g, '.')
      .replace(/[−–—]/g, '-').replace(/\s/g, '');
    if (!s) return NaN;
    s = s.replace(/[a-zA-Z€$%؀-ۿ()/]+$/g, '');
    if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
    else s = s.replace(',', '.');
    if (/^-?\d*\.?\d+\/\d+$/.test(s)) { const [a, b] = s.split('/'); return parseFloat(a) / parseFloat(b); }
    return /^-?(\d+\.?\d*|\.\d+)$/.test(s) ? parseFloat(s) : NaN;
  }

  let slot, bar, count;
  function frame() {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    root.innerHTML = `
      <div class="c-top"><div class="c-top-in"><a href="${esc(D.back || '../index.html')}">${t('back')}</a><div class="c-bar"><i></i></div><span class="c-count"></span><button type="button" class="c-lang" id="c-lang" lang="${lang === 'ar' ? 'en' : 'ar'}">${t('toggle')}</button></div></div>
      <div class="c-wrap"><div class="c-head"><span class="kicker">${esc(L(D, 'kicker') || '')}</span><h1>${esc(L(D, 'title'))}</h1></div>
      <div id="c-slot"></div>
      <div class="c-foot"><button type="button" id="c-prev">${t('prev')}</button><button type="button" id="c-restart">${t('restart')}</button></div></div>`;
    slot = document.getElementById('c-slot');
    bar = root.querySelector('.c-bar i'); count = root.querySelector('.c-count');
    document.getElementById('c-lang').onclick = () => {
      lang = lang === 'ar' ? 'en' : 'ar';
      try { localStorage.setItem(LKEY, lang); } catch (e) {}
      frame(); show();
    };
    document.getElementById('c-prev').onclick = () => { if (st.i > 0) { st.i--; show(); } };
    let armed = null;
    const rb = document.getElementById('c-restart');
    rb.onclick = () => {
      if (!armed) { rb.textContent = t('arm'); armed = setTimeout(() => { armed = null; rb.textContent = t('restart'); }, 4000); return; }
      clearTimeout(armed); armed = null; rb.textContent = t('restart');
      st = { i: 0, wrong: {}, done: {} }; show();
    };
  }

  function paintTop() {
    bar.style.width = (Math.min(st.i, N) / N * 100) + '%';
    count.textContent = st.i >= N ? t('finished') : `${t('card')} ${st.i + 1} / ${N}`;
  }

  function show() {
    paintTop(); save();
    if (st.i >= N) return showEnd();
    const c = D.cards[st.i];
    const isQ = c.kind === 'mcq' || c.kind === 'number';
    const title = L(c, 'title'), why = L(c, 'why'), hint = L(c, 'hint'), explain = L(c, 'explain') || '';
    let h = `<article class="card" aria-live="polite"><span class="tag${isQ ? ' q' : ''}">${isQ ? t('q') : t('learn')}</span>`;
    if (title) h += `<h2>${title}</h2>`;
    if (why) h += `<div class="why"><b>${t('why')}</b>${why}</div>`;
    h += `<div class="body">${L(c, 'html') || ''}</div>`;
    if (c.kind === 'mcq') h += `<div class="opts">${L(c, 'options').map((o, k) => `<button type="button" class="opt" data-k="${k}"><span class="k">${'abcdefgh'[k]}</span><span>${o}</span></button>`).join('')}</div>`;
    if (c.kind === 'number') { const u = L(c, 'unit'); h += `<div class="num"><input type="text" inputmode="decimal" autocomplete="off" aria-label="${t('ph')}" placeholder="${t('ph')}">${u ? `<span class="unit">${esc(u)}</span>` : ''}<button type="button" class="btn" data-check>${t('check')}</button></div>`; }
    h += `<div class="fbslot"></div><div class="actions">`;
    h += isQ ? `<button type="button" class="btn" data-next hidden>${t('next')}</button>${hint ? `<button type="button" class="btn sec" data-hint>${t('hintBtn')}</button>` : ''}` : `<button type="button" class="btn" data-next>${t('gotit')}</button>`;
    h += `</div></article>`;
    slot.innerHTML = h;
    const card = slot.querySelector('.card'), fb = card.querySelector('.fbslot'), next = card.querySelector('[data-next]'), hb = card.querySelector('[data-hint]');
    let tries = 0, hintShown = false;
    next.onclick = () => { st.done[st.i] = true; st.i++; show(); window.scrollTo({ top: 0 }); };
    const hideHint = () => { if (hb) hb.hidden = true; };
    if (hb) hb.onclick = () => { hintShown = true; hideHint(); fb.innerHTML = `<div class="fb hint"><b>${t('hint')}</b>${hint}</div>`; };
    const finish = ok => { if (!ok) st.wrong[st.i] = true; hideHint(); next.hidden = false; next.focus(); };
    const verdict = ok => {
      if (ok) { fb.innerHTML = `<div class="fb ok"><b>${t('correct')}</b>${explain}</div>`; finish(tries === 0); return; }
      tries++;
      if (tries === 1) { fb.innerHTML = hintShown ? `<div class="fb hint"><b>${t('notYet2')}</b>${hint || ''}</div>` : `<div class="fb hint"><b>${t('notYet')}</b>${hint || ''}</div>`; hintShown = true; hideHint(); }
      else { fb.innerHTML = `<div class="fb bad"><b>${t('answer')}</b>${explain}</div>`; reveal(); finish(false); }
    };
    function reveal() {
      if (c.kind === 'mcq') card.querySelectorAll('.opt').forEach(b => { b.disabled = true; if (+b.dataset.k === c.answer) b.classList.add('right'); });
      if (c.kind === 'number') { card.querySelector('input').disabled = true; card.querySelector('[data-check]').disabled = true; }
    }
    if (c.kind === 'mcq') card.querySelectorAll('.opt').forEach(b => b.onclick = () => {
      const k = +b.dataset.k;
      if (k === c.answer) { card.querySelectorAll('.opt').forEach(x => { x.disabled = true; x.classList.remove('picked-bad'); }); b.classList.add('right'); verdict(true); }
      else { b.classList.add('picked-bad'); b.disabled = true; verdict(false); }
    });
    if (c.kind === 'number') {
      const inp = card.querySelector('input'), chk = card.querySelector('[data-check]');
      const go = () => {
        const v = parseNum(inp.value);
        if (isNaN(v)) { fb.innerHTML = `<div class="fb hint"><b>${t('typeNum')}</b>${t('typeNumEx')}</div>`; return; }
        const tol = typeof c.tol === 'number' ? c.tol : Math.max(Math.abs(c.answer) * 0.005, 0.005);
        const ok = Math.abs(v - c.answer) <= tol + 1e-9;
        if (ok) { inp.disabled = true; chk.disabled = true; }
        verdict(ok);
      };
      chk.onclick = go; inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
      inp.focus();
    }
  }

  function showEnd() {
    const qIdx = D.cards.map((c, i) => (c.kind === 'mcq' || c.kind === 'number') ? i : -1).filter(i => i >= 0);
    const firstTry = qIdx.filter(i => !st.wrong[i]).length;
    const review = qIdx.filter(i => st.wrong[i]);
    const nm = i => { const ti = L(D.cards[i], 'title'); return `${t('card')} ${i + 1}${ti ? ': ' + ti : ''}`; };
    slot.innerHTML = `<article class="card end"><span class="tag">${t('unitDone')}</span><h2>${t('well')(firstTry, qIdx.length)}</h2>
      ${review.length ? `<p>${t('again')}</p><ul>${review.map(i => `<li><a href="#" data-go="${i}">${nm(i)}</a></li>`).join('')}</ul>` : `<p>${t('perfect')}</p>`}
      ${D.next ? `<div class="actions"><a class="btn" href="${esc(D.next.href)}" style="text-decoration:none">${esc(L(D.next, 'label'))} →</a></div>` : ''}
      <p class="small">${t('tell')} "${esc(D.title)}: ${firstTry}/${qIdx.length}".</p></article>`;
    slot.querySelectorAll('[data-go]').forEach(a => a.onclick = e => { e.preventDefault(); st.i = +a.dataset.go; show(); });
  }

  frame();
  show();
})();
