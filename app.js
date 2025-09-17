// ===== Константы =====
const STORAGE_KEY = "quiz_state_v1";
const DATA_URL = "./data/questions.json";

// ===== Модель вопроса =====
class Question {
  constructor(q) {
    this.id = q.id;
    this.text = q.text;
    this.options = q.options;
    this.correctIndex = q.correctIndex;
    this.topic = q.topic || null;
  }

  isCorrect(idx) {
    return idx === this.correctIndex;
  }
}

// ===== Работа с localStorage =====
class Storage {
  static save(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  static load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.warn("Не удалось прочитать сохранение", e);
      return null;
    }
  }

  static clear() {
    localStorage.removeItem(STORAGE_KEY);
  }
}

// ===== Движок теста =====
class QuizEngine {
  constructor(quiz) {
    this.title = quiz.title;
    this.timeLimitSec = quiz.timeLimitSec || 300;
    this.passThreshold = quiz.passThreshold || 0.7;
    this.questions = quiz.questions.map((q) => new Question(q));

    this.currentIndex = 0;
    this.answers = {};
    this.remainingSec = this.timeLimitSec;
    this.isFinished = false;
    this._summary = null; // кеш последнего результата
  }

  get length() {
    return this.questions.length;
  }

  get currentQuestion() {
    return this.questions[this.currentIndex];
  }

  next() {
    if (this.currentIndex < this.length - 1) this.currentIndex++;
  }

  prev() {
    if (this.currentIndex > 0) this.currentIndex--;
  }

  goTo(idx) {
    if (idx < 0) idx = 0;
    if (idx >= this.length) idx = this.length - 1;
    this.currentIndex = idx;
  }

  select(optIdx) {
    if (this.isFinished) return;
    const q = this.currentQuestion;
    if (!q) return;
    if (optIdx < 0 || optIdx >= q.options.length) return;
    this.answers[q.id] = optIdx;
  }

  getSelected() {
    const q = this.currentQuestion;
    return q ? this.answers[q.id] : undefined;
  }

  tick() {
    if (this.isFinished) return;
    if (this.remainingSec > 0) {
      this.remainingSec--;
      if (this.remainingSec <= 0) this.finish();
    } else {
      this.finish();
    }
  }

  finish() {
    if (this.isFinished && this._summary) return this._summary;

    let correct = 0;
    this.questions.forEach((q) => {
      if (q.isCorrect(this.answers[q.id])) correct++;
    });

    const total = this.length;
    const percent = total ? correct / total : 0;
    const passed = percent >= this.passThreshold;

    this.isFinished = true;
    this._summary = { correct, total, percent, passed };
    return this._summary;
  }

  toState() {
    return {
      quizTitle: this.title,
      currentIndex: this.currentIndex,
      answers: this.answers,
      remainingSec: this.remainingSec,
      isFinished: this.isFinished,
    };
  }

  static fromState(quiz, state) {
    const eng = new QuizEngine(quiz);
    if (!state) return eng;
    if (state.quizTitle !== quiz.title) return eng;

    eng.currentIndex = state.currentIndex || 0;
    eng.answers = state.answers || {};
    eng.remainingSec = state.remainingSec ?? quiz.timeLimitSec;
    eng.isFinished = !!state.isFinished;
    return eng;
  }
}

// ===== DOM =====
const $ = (sel) => document.querySelector(sel);
const els = {
  title: $("#quiz-title"),
  progress: $("#progress"),
  timer: $("#timer"),
  qSection: $("#question-section"),
  qText: $("#question-text"),
  form: $("#options-form"),
  btnPrev: $("#btn-prev"),
  btnNext: $("#btn-next"),
  btnFinish: $("#btn-finish"),
  result: $("#result-section"),
  resultSummary: $("#result-summary"),
  btnReview: $("#btn-review"),
  btnRestart: $("#btn-restart"),
};

let engine;
let timerId;
let reviewMode = false;

// ===== Инициализация =====
document.addEventListener("DOMContentLoaded", async () => {
  const quiz = await loadQuiz();
  els.title.textContent = quiz.title || "Тест";

  const saved = Storage.load();
  engine = saved ? QuizEngine.fromState(quiz, saved) : new QuizEngine(quiz);

  bindEvents();
  renderAll();
  startTimer();
});

async function loadQuiz() {
  const res = await fetch(DATA_URL);
  const data = await res.json();
  if (!data?.questions?.length) throw new Error("Нет вопросов");
  return data;
}

// ===== Таймер =====
function startTimer() {
  stopTimer();
  timerId = setInterval(() => {
    engine.tick();
    persist();
    renderTimer();
    if (engine.isFinished) {
      stopTimer();
      renderResult(engine.finish());
    }
  }, 1000);
}
function stopTimer() {
  clearInterval(timerId);
  timerId = null;
}

// ===== События =====
function bindEvents() {
  els.btnPrev.addEventListener("click", () => {
    engine.prev();
    persist();
    renderAll();
  });

  els.btnNext.addEventListener("click", () => {
    engine.next();
    persist();
    renderAll();
  });

  els.btnFinish.addEventListener("click", () => {
    const summary = engine.finish();
    stopTimer();
    renderResult(summary);
    persist();
  });

  els.btnReview.addEventListener("click", () => {
    if (!engine.isFinished) engine.finish();
    reviewMode = true;
    renderReview();
  });

  els.btnRestart.addEventListener("click", () => {
    Storage.clear();
    window.location.reload();
  });

  els.form.addEventListener("change", (e) => {
    const t = e.target;
    if (t.name === "option") {
      engine.select(Number(t.value));
      persist();
      renderNav();
    }
  });
}

// ===== Рендер =====
function renderAll() {
  renderProgress();
  renderTimer();
  renderQuestion();
  renderNav();
}

function renderProgress() {
  els.progress.textContent = `Вопрос ${engine.currentIndex + 1} из ${engine.length}`;
}

function renderTimer() {
  const sec = engine.remainingSec;
  const m = String(Math.floor(sec / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  els.timer.textContent = `${m}:${s}`;
}

function renderQuestion() {
  const q = engine.currentQuestion;
  els.qText.textContent = q?.text || "—";
  els.form.innerHTML = "";

  q.options.forEach((opt, i) => {
    const id = `opt-${q.id}-${i}`;
    const label = document.createElement("label");
    label.className = "option";
    label.setAttribute("for", id);

    if (reviewMode) {
      const chosen = engine.answers[q.id];
      if (i === q.correctIndex) label.classList.add("correct");
      if (chosen === i && i !== q.correctIndex) label.classList.add("incorrect");
    }

    const input = document.createElement("input");
    input.type = "radio";
    input.name = "option";
    input.value = i;
    input.id = id;
    input.checked = engine.getSelected() === i;

    const span = document.createElement("span");
    span.textContent = opt;

    label.appendChild(input);
    label.appendChild(span);
    els.form.appendChild(label);
  });
}

function renderNav() {
  const has = Number.isInteger(engine.getSelected());
  els.btnPrev.disabled = engine.currentIndex === 0;
  els.btnNext.disabled = !(engine.currentIndex < engine.length - 1 && has);
  els.btnFinish.disabled = !(engine.currentIndex === engine.length - 1 && has);
}

function renderResult(summary) {
  els.qSection.classList.add("hidden");
  document.querySelector("nav.actions")?.classList.add("hidden");
  els.result.classList.remove("hidden");
  const pct = Math.round(summary.percent * 100);
  els.resultSummary.textContent = `${summary.correct}/${summary.total} (${pct}%) — ${
      summary.passed ? "Пройден ✅" : "Не пройден ❌"
  }`;
}

function renderReview() {
  const container = document.createElement("div");
  container.className = "review-list";

  engine.questions.forEach((q) => {
    const card = document.createElement("section");
    card.className = "card";

    // вопрос
    const title = document.createElement("p");
    title.textContent = q.text;
    card.appendChild(title);

    // варианты ответа
    q.options.forEach((opt, i) => {
      const row = document.createElement("div");
      row.className = "option";
      if (i === q.correctIndex) row.classList.add("correct");
      if (engine.answers[q.id] === i && i !== q.correctIndex)
        row.classList.add("incorrect");

      const marker = document.createElement("strong");
      marker.textContent = i === q.correctIndex ? "✔" : "•";

      const span = document.createElement("span");
      span.textContent = opt; // безопасный вывод (никаких <h1> не сработает как тег)

      row.appendChild(marker);
      row.appendChild(span);
      card.appendChild(row);
    });

    container.appendChild(card);
  });

  els.result.innerHTML = "";
  els.result.appendChild(container);
}


// ===== Сохранение =====
function persist() {
  Storage.save(engine.toState());
}
