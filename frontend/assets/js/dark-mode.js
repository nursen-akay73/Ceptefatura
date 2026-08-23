(function applyThemeBoot() {
  const saved = localStorage.getItem("ceptefatura-theme");
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = saved === "dark" || ((saved === "system" || !saved) && systemDark);
  if (dark) document.documentElement.setAttribute("data-theme", "dark");
  else document.documentElement.removeAttribute("data-theme");
})();

function currentThemePref() {
  return localStorage.getItem("ceptefatura-theme") || "system";
}

function applyCepteTheme(pref) {
  if (pref === "light" || pref === "dark" || pref === "system") {
    localStorage.setItem("ceptefatura-theme", pref);
  }
  const saved = currentThemePref();
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = saved === "dark" || (saved === "system" && systemDark);
  if (dark) document.documentElement.setAttribute("data-theme", "dark");
  else document.documentElement.removeAttribute("data-theme");
  syncThemeToggle();
  document.dispatchEvent(new CustomEvent("cf-theme-change", { detail: { pref: saved, dark } }));
}

function syncThemeToggle() {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const btn = document.getElementById("theme-toggle");
  const label = document.getElementById("theme-label");
  if (btn) {
    btn.classList.toggle("is-on", isDark);
    btn.setAttribute("aria-pressed", isDark ? "true" : "false");
    btn.setAttribute("aria-label", isDark ? "Koyu modu kapat" : "Koyu modu aç");
  }
  if (label) label.textContent = isDark ? "Açık" : "Kapalı";
}

function initThemeToggle() {
  const btn = document.getElementById("theme-toggle");
  syncThemeToggle();
  if (!btn || btn.dataset.bound === "1") return;
  btn.dataset.bound = "1";
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    applyCepteTheme(isDark ? "light" : "dark");
  });
}

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (currentThemePref() === "system") applyCepteTheme("system");
});

document.addEventListener("DOMContentLoaded", initThemeToggle);
