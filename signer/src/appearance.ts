// Use the same preference key as the landing page. This module is bundled into
// both signing surfaces and never reads a request, wallet, or transaction.
const media = window.matchMedia("(prefers-color-scheme: dark)");
const button = document.getElementById("theme-toggle");

function apply(theme: string) {
  document.documentElement.dataset.theme = theme;
  button?.setAttribute("aria-label", `Switch to ${theme === "dark" ? "light" : "dark"} theme`);
}

function sync() {
  let saved: string | null = null;
  try { saved = localStorage.getItem("kovan-theme"); } catch { /* System theme works without storage. */ }
  apply(saved === "light" || saved === "dark" ? saved : media.matches ? "dark" : "light");
}

sync();
button?.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  apply(next);
  try { localStorage.setItem("kovan-theme", next); } catch { /* Keep this tab's choice. */ }
});
window.addEventListener("storage", sync);
media.addEventListener("change", sync);
