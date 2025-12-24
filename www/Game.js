const cases = [
  {
    text: "Homme 65 ans, tabagique, toux chronique, amaigrissement, hémoptysie.",
    choices: ["BPCO", "Cancer du poumon", "Pneumonie", "Tuberculose"],
    answer: 1,
    explanation: "Tabagisme + hémoptysie + amaigrissement = cancer broncho-pulmonaire."
  }
];

let i = 0;

function showCase() {
  const c = cases[i];
  caseText.textContent = c.text;
  choices.innerHTML = "";

  c.choices.forEach((ch, idx) => {
    const btn = document.createElement("button");
    btn.textContent = ch;
    btn.onclick = () => check(idx);
    choices.appendChild(btn);
  });
}

function check(idx) {
  const c = cases[i];
  feedback.textContent = idx === c.answer ? "✅ Correct !" : "❌ Faux. " + c.explanation;
  i++;
  setTimeout(showCase, 1500);
}

showCase();
