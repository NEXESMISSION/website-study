/* Course Folder: shared lesson behaviour.
   - builds the contents rail from <section class="lesson-section" id=… data-title=…>
   - makes multiple-choice / true-false exercises interactive (.ex[data-answer])
   - remembers answers and "section done" ticks in this browser (localStorage) */
(function () {
  const lessonId = document.body.dataset.lesson || location.pathname;
  const KEY = "course-folder:" + lessonId;
  let store = {};
  try { store = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { store = {}; }
  store.answers = store.answers || {};
  store.done = store.done || {};
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {} };

  const sections = Array.from(document.querySelectorAll("section.lesson-section[id]"));

  /* ---------- contents rail ---------- */
  const toc = document.getElementById("toc");
  if (toc && sections.length) {
    const items = sections.map(s => {
      const title = s.dataset.title || (s.querySelector("h2") || {}).textContent || s.id;
      return `<li><a href="#${s.id}" data-sec="${s.id}">${title}</a></li>`;
    }).join("");
    toc.innerHTML = `<h4>In this lesson</h4><ol>${items}</ol>`;
    const links = Array.from(toc.querySelectorAll("a"));
    const spy = () => {
      let current = sections[0].id;
      for (const s of sections) { if (s.getBoundingClientRect().top < 140) current = s.id; }
      links.forEach(a => a.classList.toggle("active", a.dataset.sec === current));
    };
    document.addEventListener("scroll", spy, { passive: true });
    spy();
  }

  /* ---------- "section done" toggles ---------- */
  sections.forEach(s => {
    if (s.dataset.noDone !== undefined) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "done-toggle";
    btn.innerHTML = `<span class="tick" aria-hidden="true"></span><span>I understand this part</span>`;
    btn.addEventListener("click", () => {
      store.done[s.id] = !store.done[s.id];
      save(); paintDone(); paintScore();
    });
    s.appendChild(btn);
    s._doneBtn = btn;
  });
  function paintDone() {
    sections.forEach(s => {
      const on = !!store.done[s.id];
      if (s._doneBtn) s._doneBtn.classList.toggle("on", on);
      const link = toc && toc.querySelector(`a[data-sec="${s.id}"]`);
      if (link) link.classList.toggle("tdone", on);
    });
  }

  /* ---------- interactive exercises ---------- */
  const quizzes = Array.from(document.querySelectorAll(".ex[data-answer]"));
  quizzes.forEach((ex, i) => {
    const id = ex.id || ("q" + (i + 1));
    ex._id = id;
    const opts = ex.querySelector(".opts");
    if (!opts) return;
    opts.addEventListener("click", e => {
      const btn = e.target.closest(".opt");
      if (!btn || opts.classList.contains("locked")) return;
      store.answers[id] = btn.dataset.k;
      save(); paintQuiz(ex); paintScore();
    });
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "done-toggle";
    reset.style.display = "none";
    reset.textContent = "Try again";
    reset.addEventListener("click", () => { delete store.answers[id]; save(); paintQuiz(ex); paintScore(); });
    ex.appendChild(reset);
    ex._reset = reset;
  });
  function paintQuiz(ex) {
    const picked = store.answers[ex._id];
    const answer = ex.dataset.answer;
    const opts = ex.querySelector(".opts");
    const buttons = Array.from(opts.querySelectorAll(".opt"));
    buttons.forEach(b => {
      b.classList.remove("right", "wrong");
      b.setAttribute("aria-pressed", "false");
    });
    let fb = ex.querySelector(".feedback");
    if (!picked) {
      opts.classList.remove("locked");
      if (fb) fb.remove();
      ex._reset.style.display = "none";
      return;
    }
    opts.classList.add("locked");
    buttons.forEach(b => {
      if (b.dataset.k === answer) b.classList.add("right");
      else if (b.dataset.k === picked) { b.classList.add("wrong"); b.setAttribute("aria-pressed", "true"); }
    });
    const ok = picked === answer;
    if (!fb) { fb = document.createElement("div"); opts.after(fb); }
    const why = ex.querySelector(".why");
    fb.className = "feedback " + (ok ? "ok" : "no");
    fb.innerHTML = `<b>${ok ? "Correct." : "Not quite. The answer is " + labelOf(ex, answer) + "."}</b>${why ? why.innerHTML : ""}`;
    ex._reset.style.display = ok ? "none" : "inline-flex";
  }
  function labelOf(ex, k) {
    const b = ex.querySelector(`.opt[data-k="${k}"]`);
    if (!b) return k;
    if (b.querySelector(".k")) return "(" + k + ")";
    return "“" + b.textContent.trim() + "”";
  }

  /* ---------- score in the top bar ---------- */
  const scoreEl = document.getElementById("score");
  function paintScore() {
    if (!scoreEl) return;
    const answered = quizzes.filter(q => store.answers[q._id]).length;
    const right = quizzes.filter(q => store.answers[q._id] === q.dataset.answer).length;
    const doneN = sections.filter(s => store.done[s.id]).length;
    const pct = sections.length ? Math.round(doneN / sections.length * 100) : 0;
    scoreEl.innerHTML =
      (quizzes.length ? `<span>Quiz <b>${right}/${quizzes.length}</b>${answered > right ? ` · ${answered - right} wrong` : ""}</span>` : "") +
      `<span>Done <b>${pct}%</b></span><span class="bar" aria-hidden="true"><i style="width:${pct}%"></i></span>`;
  }

  /* ---------- reset this lesson (answers + ticks), with a second click to confirm ---------- */
  if (scoreEl) {
    const rb = document.createElement("button");
    rb.type = "button";
    rb.className = "reset-lesson";
    rb.textContent = "Reset";
    rb.title = "Clear all your answers and ticks in this lesson";
    let armed = null;
    rb.addEventListener("click", () => {
      if (!armed) {
        rb.textContent = "Click again to reset";
        rb.classList.add("armed");
        armed = setTimeout(() => { armed = null; rb.textContent = "Reset"; rb.classList.remove("armed"); }, 4000);
        return;
      }
      clearTimeout(armed); armed = null;
      store.answers = {}; store.done = {}; save();
      quizzes.forEach(paintQuiz); paintDone(); paintScore();
      rb.textContent = "Reset done"; rb.classList.remove("armed");
      setTimeout(() => { rb.textContent = "Reset"; }, 2000);
    });
    scoreEl.after(rb);
  }

  quizzes.forEach(paintQuiz);
  paintDone();
  paintScore();
})();
