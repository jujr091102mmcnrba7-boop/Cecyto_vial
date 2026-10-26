const faultGrid = document.querySelector("#fault-grid");
const quizWelcome = document.querySelector(".quiz-welcome");
const quizActive = document.querySelector("#quiz-active");
const quizResults = document.querySelector("#quiz-results");

let faults = [];
let questions = [];
let currentQuestion = 0;
let selectedAnswers = [];

const categoryClasses = {
  Movilidad: "category-mobility",
  "Seguridad vial": "category-safety",
  Alcoholímetro: "category-alcohol",
  "Justicia Cívica": "category-civic"
};

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "No se pudo completar la solicitud.");
  }
  return data;
}

function renderFaults(category = "Todas") {
  const visible = category === "Todas" ? faults : faults.filter((fault) => fault.category === category);
  if (visible.length === 0) {
    faultGrid.innerHTML = '<p class="loading-message">No hay faltas en esta categoría.</p>';
    return;
  }
  faultGrid.innerHTML = visible.map((fault) => `
    <article class="fault-card">
      <div class="fault-card-top"><span class="fault-icon ${categoryClasses[fault.category] || ""}" aria-hidden="true">${escapeHtml(fault.icon)}</span><span class="category-tag ${categoryClasses[fault.category] || ""}">${escapeHtml(fault.category)}</span></div>
      <h3>${escapeHtml(fault.title)}</h3>
      <p>${escapeHtml(fault.description)}</p>
      <p class="sanction-note">${escapeHtml(fault.sanctionNote)}</p>
      <a class="legal-reference" href="${escapeHtml(fault.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(fault.legalReference)} <span aria-hidden="true">↗</span></a>
      <div class="prevention"><span aria-hidden="true">↗</span><span>${escapeHtml(fault.recommendation)}</span></div>
    </article>`).join("");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function renderQuestion() {
  const question = questions[currentQuestion];
  const progress = (currentQuestion / questions.length) * 100;
  quizActive.innerHTML = `
    <div class="progress-label"><span>PREGUNTA ${String(currentQuestion + 1).padStart(2, "0")} <span class="progress-muted">/ ${String(questions.length).padStart(2, "0")}</span></span><span>${Math.round(progress)}% COMPLETADO</span></div>
    <div class="progress-track"><span style="width:${progress}%"></span></div>
    <p class="question-text">${escapeHtml(question.question)}</p>
    <fieldset class="answer-options"><legend class="visually-hidden">Elige una respuesta</legend>${question.options.map((option, index) => `
      <label class="answer-option"><input type="radio" name="answer" value="${index}"><span class="option-marker">${String.fromCharCode(65 + index)}</span><span>${escapeHtml(option)}</span></label>`).join("")}
    </fieldset>
    <p class="quiz-error" id="quiz-error" role="alert" hidden></p>
    <button class="button button-primary quiz-next" id="next-question" type="button">Confirmar respuesta <span aria-hidden="true">→</span></button>`;
  document.querySelector("#next-question").addEventListener("click", submitAnswer);
}

function submitAnswer() {
  const selected = quizActive.querySelector('input[name="answer"]:checked');
  const error = quizActive.querySelector("#quiz-error");
  if (!selected) {
    error.textContent = "Elige una opción para continuar.";
    error.hidden = false;
    return;
  }
  error.hidden = true;
  selectedAnswers.push({
    questionId: questions[currentQuestion].id,
    selectedIndex: Number(selected.value)
  });
  currentQuestion += 1;
  if (currentQuestion < questions.length) {
    renderQuestion();
    return;
  }
  finishQuiz();
}

async function finishQuiz() {
  quizActive.innerHTML = '<p class="loading-message">Revisando tus respuestas…</p>';
  try {
    const result = await requestJson("/api/assessments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers: selectedAnswers })
    });
    showResults(result);
  } catch (error) {
    quizActive.innerHTML = `<p class="quiz-error" role="alert">${escapeHtml(error.message)}</p><button class="button button-primary quiz-next" id="retry-results" type="button">Intentar de nuevo</button>`;
    document.querySelector("#retry-results").addEventListener("click", finishQuiz);
  }
}

function showResults(result) {
  quizActive.hidden = true;
  quizResults.hidden = false;
  const percentage = Math.round((result.score / result.total) * 100);
  const message = percentage === 100
    ? "¡Excelente! Tus decisiones ayudan a cuidar el camino."
    : percentage >= 60
      ? "¡Buen trabajo! Sigue reforzando tus conocimientos."
      : "Cada respuesta es una oportunidad para aprender. Inténtalo de nuevo.";
  quizResults.innerHTML = `
    <div class="result-score">${result.score}<span>/${result.total}</span></div>
    <p class="result-label">RESPUESTAS CORRECTAS · ${percentage}%</p>
    <h3>${message}</h3>
    <div class="result-review">${result.results.map((answer, index) => `<p class="${answer.correct ? "review-correct" : "review-incorrect"}"><span>${answer.correct ? "✓" : "↗"} Pregunta ${index + 1}</span>${escapeHtml(answer.explanation)}</p>`).join("")}</div>
    <button class="button button-primary quiz-start" id="restart-quiz" type="button">Volver a intentarlo <span aria-hidden="true">↻</span></button>`;
  document.querySelector("#restart-quiz").addEventListener("click", startQuiz);
}

function startQuiz() {
  currentQuestion = 0;
  selectedAnswers = [];
  quizWelcome.hidden = true;
  quizResults.hidden = true;
  quizActive.hidden = false;
  renderQuestion();
}

document.querySelectorAll(".filter-chip").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".filter-chip").forEach((chip) => {
      const active = chip === button;
      chip.classList.toggle("selected", active);
      chip.setAttribute("aria-pressed", String(active));
    });
    renderFaults(button.dataset.category);
  });
});

document.querySelector("#start-quiz").addEventListener("click", startQuiz);

Promise.all([requestJson("/api/faults"), requestJson("/api/questions")])
  .then(([faultData, questionData]) => {
    faults = faultData;
    questions = questionData;
    document.querySelector("#all-count").textContent = String(faults.length).padStart(2, "0");
    renderFaults();
  })
  .catch((error) => {
    faultGrid.innerHTML = `<p class="loading-message" role="alert">${escapeHtml(error.message)} Recarga la página para volver a intentarlo.</p>`;
  });
