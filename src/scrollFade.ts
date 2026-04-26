// Auto-hide scrollbar driver. While the user is actively scrolling anywhere
// in the document, add `tc-scrolling` to <html>; remove it after IDLE_MS of
// quiet so the thumb fades back to transparent. CSS in index.css owns the
// visual transition — this module just toggles the class.

const IDLE_MS = 1200;
let timer: number | null = null;

function ping(): void {
  document.documentElement.classList.add("tc-scrolling");
  if (timer != null) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    document.documentElement.classList.remove("tc-scrolling");
    timer = null;
  }, IDLE_MS);
}

// `capture: true` so we catch scrolls on inner elements (scroll events do
// not bubble). `passive: true` keeps the main thread free.
const opts: AddEventListenerOptions = { capture: true, passive: true };
window.addEventListener("scroll", ping, opts);
window.addEventListener("wheel", ping, opts);
window.addEventListener("touchmove", ping, opts);
