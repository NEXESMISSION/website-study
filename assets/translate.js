/* Course Folder: translate the selected text.
   Select any text on a lesson or exam page → a small bar appears → French or Arabic.
   Uses the free MyMemory translation service (the selected text is sent to it), with a
   Google Translate link as a fallback. */
(function () {
  if (window.__cfTranslate) return;
  window.__cfTranslate = true;

  const css = `
  .cf-tr-bar{position:absolute;z-index:9999;display:flex;gap:6px;padding:5px;background:#0F1726;border-radius:10px;box-shadow:0 6px 20px rgba(15,23,38,.25)}
  .cf-tr-bar button{font:600 13px/1 "Figtree","Segoe UI",system-ui,sans-serif;color:#fff;background:transparent;border:1px solid rgba(255,255,255,.35);border-radius:7px;padding:7px 10px;cursor:pointer}
  .cf-tr-bar button:hover,.cf-tr-bar button:focus-visible{background:rgba(255,255,255,.15);outline:none}
  .cf-tr-pop{position:fixed;z-index:10000;left:50%;bottom:16px;transform:translateX(-50%);width:min(560px,calc(100vw - 32px));max-height:50vh;overflow:auto;background:#fff;color:#0F1726;border:1px solid #E7E9EE;border-radius:14px;box-shadow:0 12px 40px rgba(15,23,38,.22);padding:14px 16px;font:15px/1.55 "Figtree","Segoe UI",system-ui,sans-serif}
  .cf-tr-pop .h{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px;font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#667085}
  .cf-tr-pop .x{font:inherit;font-size:18px;line-height:1;border:0;background:none;cursor:pointer;color:#667085;padding:2px 6px}
  .cf-tr-pop .src{color:#667085;font-size:13.5px;border-left:3px solid #E7E9EE;padding-left:10px;margin-bottom:10px;max-height:5.5em;overflow:hidden}
  .cf-tr-pop .out{font-size:16px;white-space:pre-wrap}
  .cf-tr-pop .out[dir=rtl]{font-size:18px;text-align:right}
  .cf-tr-pop a{font-size:13px;color:#2A4BD7}
  .cf-tr-pop .foot{margin-top:10px;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}
  @media (prefers-color-scheme: dark){.cf-tr-pop{background:#151C26;color:#E7ECF3;border-color:#263143}.cf-tr-pop a{color:#88A3FF}}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  const bar = document.createElement('div');
  bar.className = 'cf-tr-bar'; bar.hidden = true;
  bar.innerHTML = '<button type="button" data-l="fr">Français</button><button type="button" data-l="ar">العربية</button>';
  document.body.appendChild(bar);
  let pop = null, picked = '';

  const selectedText = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return '';
    const node = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
    if (node && node.closest && node.closest('input, textarea, select, .cf-tr-pop, .cf-tr-bar')) return '';
    return sel.toString().replace(/\s+/g, ' ').trim();
  };
  function showBar() {
    const t = selectedText();
    if (!t || t.length > 2500) { bar.hidden = true; return; }
    picked = t;
    const r = window.getSelection().getRangeAt(0).getBoundingClientRect();
    bar.hidden = false;
    const w = bar.offsetWidth;
    let left = window.scrollX + r.left + r.width / 2 - w / 2;
    left = Math.max(window.scrollX + 8, Math.min(left, window.scrollX + document.documentElement.clientWidth - w - 8));
    let top = window.scrollY + r.top - bar.offsetHeight - 8;
    if (r.top < 60) top = window.scrollY + r.bottom + 8;
    bar.style.left = left + 'px'; bar.style.top = top + 'px';
  }
  let t1 = null;
  document.addEventListener('selectionchange', () => { clearTimeout(t1); t1 = setTimeout(showBar, 250); });
  document.addEventListener('mousedown', e => { if (!bar.contains(e.target)) bar.hidden = true; });

  // MyMemory accepts up to ~500 characters per request: split on sentence ends
  function chunks(text) {
    const parts = text.match(/[^.!?;:]+[.!?;:]*\s*/g) || [text];
    const out = []; let cur = '';
    parts.forEach(p => {
      if ((cur + p).length > 450) { if (cur) out.push(cur); cur = p.length > 450 ? '' : p; if (p.length > 450) for (let i = 0; i < p.length; i += 450) out.push(p.slice(i, i + 450)); }
      else cur += p;
    });
    if (cur.trim()) out.push(cur);
    return out;
  }
  async function translate(text, lang) {
    const res = [];
    for (const c of chunks(text)) {
      const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(c.trim()) + '&langpair=en|' + lang;
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const tr = j && j.responseData && j.responseData.translatedText;
      if (!tr || j.responseStatus >= 400 || /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(tr)) throw new Error('service limit');
      res.push(tr);
    }
    const div = document.createElement('div'); div.innerHTML = res.join(' '); // decode HTML entities
    return div.textContent;
  }
  function openPop(text, lang) {
    if (pop) pop.remove();
    pop = document.createElement('div');
    pop.className = 'cf-tr-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Translation');
    const name = lang === 'fr' ? 'French' : 'Arabic';
    const g = 'https://translate.google.com/?sl=en&tl=' + lang + '&op=translate&text=' + encodeURIComponent(text.slice(0, 4000));
    pop.innerHTML = `<div class="h"><span>Translation · ${name}</span><button type="button" class="x" aria-label="Close">×</button></div>
      <div class="src"></div><div class="out"${lang === 'ar' ? ' dir="rtl" lang="ar"' : ' lang="fr"'}>Translating…</div>
      <div class="foot"><span style="font-size:12.5px;color:#667085">Machine translation: check key terms with the lesson's “In French” lines.</span><a href="${g}" target="_blank" rel="noopener">Open in Google Translate</a></div>`;
    pop.querySelector('.src').textContent = text;
    pop.querySelector('.x').onclick = () => { pop.remove(); pop = null; };
    document.body.appendChild(pop);
    translate(text, lang).then(t => { if (pop) pop.querySelector('.out').textContent = t; })
      .catch(() => { if (pop) pop.querySelector('.out').textContent = 'The translation service did not answer (no internet, or its daily limit). Use “Open in Google Translate” below.'; });
  }
  bar.addEventListener('click', e => {
    const b = e.target.closest('button[data-l]'); if (!b) return;
    bar.hidden = true; openPop(picked, b.dataset.l);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { bar.hidden = true; if (pop) { pop.remove(); pop = null; } } });
})();
