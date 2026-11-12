/* Course Folder · one-card-at-a-time study engine.
   Data: <script type="application/json" id="cards-data">{ id, kicker, title, back, cards:[...] }</script>
   Card kinds:
     learn  { title, html }                                   → "Got it" button
     mcq    { title, html, options:[...], answer:index, hint, explain }
     number { title, html, answer:number, tol?, unit?, hint, explain }
   A question card must be answered correctly to go on. 1st wrong try → hint, 2nd wrong try → full explanation,
   then the student may continue (the card is added to "review later"). Progress is saved in this browser. */
(function () {
  const D = JSON.parse(document.getElementById('cards-data').textContent);
  const KEY = 'course-folder:cards:' + D.id;
  const root = document.getElementById('cards');
  let st = { i: 0, wrong: {}, done: {} };
  try { st = Object.assign(st, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const N = D.cards.length;


  function parseNum(raw) {
    let s = String(raw || '').trim().replace(/[−–—]/g, '-').replace(/\s/g, '');
    if (!s) return NaN;
    s = s.replace(/[a-zA-Z€$%]+$/g, '');
    if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
    else s = s.replace(',', '.');
    if (/^-?\d*\.?\d+\/\d+$/.test(s)) { const [a, b] = s.split('/'); return parseFloat(a) / parseFloat(b); }
    return /^-?(\d+\.?\d*|\.\d+)$/.test(s) ? parseFloat(s) : NaN;
  }

  root.innerHTML = `
    <div class="c-top"><div class="c-top-in"><a href="${esc(D.back || '../index.html')}">← Back</a><div class="c-bar"><i></i></div><span class="c-count"></span></div></div>
    <div class="c-wrap"><div class="c-head"><span class="kicker">${esc(D.kicker || '')}</span><h1>${esc(D.title)}</h1></div>
    <div id="c-slot"></div>
    <div class="c-foot"><button type="button" id="c-prev">← Previous card</button><button type="button" id="c-restart">Start this unit again</button></div></div>`;
  const slot = document.getElementById('c-slot');
  const bar = root.querySelector('.c-bar i'), count = root.querySelector('.c-count');

  function paintTop() {
    const shown = Math.min(st.i, N);
    bar.style.width = (shown / N * 100) + '%';
    count.textContent = st.i >= N ? 'Finished' : `Card ${st.i + 1} / ${N}`;
  }

  function show() {
    paintTop(); save();
    if (st.i >= N) return showEnd();
    const c = D.cards[st.i];
    const isQ = c.kind === 'mcq' || c.kind === 'number';
    let h = `<article class="card" aria-live="polite"><span class="tag${isQ ? ' q' : ''}">${isQ ? 'Your turn' : 'Learn'}</span>`;
    if (c.title) h += `<h2>${c.title}</h2>`;
    h += `<div class="body">${c.html || ''}</div>`;
    if (c.kind === 'mcq') h += `<div class="opts">${c.options.map((o, k) => `<button type="button" class="opt" data-k="${k}"><span class="k">${'abcdefgh'[k]}</span><span>${o}</span></button>`).join('')}</div>`;
    if (c.kind === 'number') h += `<div class="num"><input type="text" inputmode="decimal" autocomplete="off" aria-label="Your answer" placeholder="Your answer">${c.unit ? `<span class="unit">${esc(c.unit)}</span>` : ''}<button type="button" class="btn" data-check>Check</button></div>`;
    h += `<div class="fbslot"></div><div class="actions">`;
    h += isQ ? `<button type="button" class="btn" data-next hidden>Next →</button>` : `<button type="button" class="btn" data-next>Got it →</button>`;
    h += `</div></article>`;
    slot.innerHTML = h;
    const card = slot.querySelector('.card'), fb = card.querySelector('.fbslot'), next = card.querySelector('[data-next]');
    let tries = 0;
    next.onclick = () => { st.done[st.i] = true; st.i++; show(); window.scrollTo({ top: 0 }); };
    const finish = ok => {
      if (!ok) st.wrong[st.i] = true;
      next.hidden = false; next.focus();
    };
    const verdict = (ok) => {
      if (ok) { fb.innerHTML = `<div class="fb ok"><b>Correct!</b>${c.explain || ''}</div>`; finish(tries === 0); return; }
      tries++;
      if (tries === 1) fb.innerHTML = `<div class="fb hint"><b>Not yet. Hint:</b>${c.hint || 'Read the card again slowly and try once more.'}</div>`;
      else { fb.innerHTML = `<div class="fb bad"><b>Here is the answer, step by step:</b>${c.explain || ''}</div>`; reveal(); finish(false); }
    };
    function reveal() {
      if (c.kind === 'mcq') { card.querySelectorAll('.opt').forEach(b => { b.disabled = true; if (+b.dataset.k === c.answer) b.classList.add('right'); }); }
      if (c.kind === 'number') { const inp = card.querySelector('input'); inp.disabled = true; card.querySelector('[data-check]').disabled = true; }
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
        if (isNaN(v)) { fb.innerHTML = `<div class="fb hint"><b>Type a number.</b>For example 12 or 3.5 (a comma also works: 3,5).</div>`; return; }
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
    slot.innerHTML = `<article class="card end"><span class="tag">Unit finished</span><h2>Well done! ${firstTry} / ${qIdx.length} right on the first try.</h2>
      ${review.length ? `<p>Look again at these cards:</p><ul>${review.map(i => `<li><a href="#" data-go="${i}">Card ${i + 1}${D.cards[i].title ? ': ' + D.cards[i].title : ''}</a></li>`).join('')}</ul>` : '<p>Perfect. You can go to the next unit.</p>'}
      ${D.next ? `<div class="actions"><a class="btn" href="${esc(D.next.href)}" style="text-decoration:none">${esc(D.next.label)} →</a></div>` : ''}
      <p class="small">Tell Claude your score in the chat: "${esc(D.title)}: ${firstTry}/${qIdx.length}".</p></article>`;
    slot.querySelectorAll('[data-go]').forEach(a => a.onclick = e => { e.preventDefault(); st.i = +a.dataset.go; show(); });
  }

  document.getElementById('c-prev').onclick = () => { if (st.i > 0) { st.i--; show(); } };
  let armed = null;
  const rb = document.getElementById('c-restart');
  rb.onclick = () => {
    if (!armed) { rb.textContent = 'Click again to start over'; armed = setTimeout(() => { armed = null; rb.textContent = 'Start this unit again'; }, 4000); return; }
    clearTimeout(armed); armed = null; rb.textContent = 'Start this unit again';
    st = { i: 0, wrong: {}, done: {} }; show();
  };
  show();
})();
