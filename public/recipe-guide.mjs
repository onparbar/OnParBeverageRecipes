// Titles are matched conservatively so a missing guide never opens another cocktail.
const GUIDE_RECIPES = [
  ["blueberry-margarita-jose-cuervo", "Blueberry Margarita"],
  ["house-margarita-jose-cuervo", "House Margarita"],
  ["peach-margarita-jose-cuervo", "Peach Margarita"],
  ["raspberry-margarita-jose-cuervo", "Raspberry Margarita"],
  ["strawberry-margarita-jose-cuervo", "Strawberry Margarita"],
  ["watermelon-margarita-jose-cuervo", "Watermelon Margarita"],
  ["strawberry-senorita-jose-cuervo", "Strawberry Senorita"],
  ["blue-dot-svedka", "Blue Dot"],
  ["boozy-cucumber-lemonade-ketel-one", "Boozy Cucumber Lemonade"],
  ["espresso-martini-tito-s", "Espresso Martini"],
  ["lemon-drop-martini-absolut-citron", "Lemon Drop Martini"],
  ["pomegranate-martini-tito-s", "Pomegranate Martini"],
  ["spiked-arnold-palmer-tito-s", "Spiked Arnold Palmer"],
  ["spiked-cranberry-lemonade-tito-s", "Spiked Cranberry Lemonade"],
  ["spiked-pink-lemonade-tito-s", "Spiked Pink Lemonade"],
  ["spiked-strawberry-lemonade-tito-s", "Spiked Strawberry Lemonade"],
  ["vodka-cran-tito-s", "Vodka Cran"],
  ["crown-apple-rita", "Crown Apple Rita"],
  ["jacked-up-strawberry-lemonade-jack-daniels", "Jacked Up Strawberry Lemonade"],
  ["old-fashioned-bulleit", "Old Fashioned"],
  ["washington-apple-crown-royal-apple", "Washington Apple"],
  ["whiskey-sour-jack-daniels", "Whiskey Sour"],
  ["bacardi-sunset", "Bacardi Sunset"],
  ["whiskey-smash", "Whiskey Smash"],
  ["apple-jack-whiskey", "Apple Jack"],
  ["on-par-tee", "On Par Tee"],
];

function titleKey(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)/g, " ").replace(/\s+\d+\s*$/, "")
    .toLowerCase().replace(/[^a-z0-9]/g, "");
}

function html(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

export function getRecipeGuide(recipe) {
  const title = typeof recipe === "string" ? recipe : recipe?.title || recipe?.name || recipe?.displayName;
  const key = titleKey(title);
  const entry = GUIDE_RECIPES.find(([, name]) => titleKey(name) === key);
  return entry ? { id: entry[0], title: entry[1], src: `/guided-player/index.html?recipe=${entry[0]}&embed=1` } : null;
}

export function renderRecipeGuide(recipe, { compact = false } = {}) {
  const guide = getRecipeGuide(recipe);
  if (!guide) return '<section class="recipe-guide recipe-guide--unavailable"><p>A video guide is not available for this recipe yet.</p></section>';
  if (compact) return `<section class="recipe-guide recipe-guide--compact">
    <a class="recipe-guide__open" href="${html(guide.src)}" target="_blank" rel="noopener" aria-label="Open ${html(guide.title)} guide (opens in a new tab)">Open guide</a>
  </section>`;
  return `<section class="recipe-guide" aria-label="${html(guide.title)} video guide">
    <div class="recipe-guide__heading"><strong>Step-by-step guide</strong><a href="${html(guide.src)}" target="_blank" rel="noopener">Open guide</a></div>
    <p class="recipe-guide__hint">Press Next to start. Each step pauses until you’re ready. Use Back to repeat a step.</p>
    <iframe class="recipe-guide__frame" data-recipe-guide-src="${html(guide.src)}" title="${html(guide.title)} step-by-step guide" loading="lazy" allow="fullscreen" allowfullscreen></iframe>
  </section>`;
}

export function createRecipeGuide(recipe, options) {
  const template = document.createElement("template");
  template.innerHTML = renderRecipeGuide(recipe, options);
  return template.content.firstElementChild;
}

const frames = new Set();
let intersectionObserver;
let mutationObserver;
let refreshScheduled = false;

function pauseFrame(frame) {
  if (frame.hasAttribute("src")) {
    frame.contentWindow?.postMessage({ type: "onpar:guided-player:pause" }, window.location.origin);
  }
}

function isVisible(frame) {
  return !document.hidden && frame.getClientRects().length > 0;
}

function loadFrame(frame) {
  if (!frame.hasAttribute("src")) frame.src = frame.dataset.recipeGuideSrc;
}

// One observer supports cards, collapsed recipes and weekly-plan rerenders.
export function initializeRecipeGuides(root = document) {
  if (!mutationObserver) {
    if (typeof IntersectionObserver === "function") {
      intersectionObserver = new IntersectionObserver((entries) => {
        entries.forEach(({ target, isIntersecting }) => {
          if (isIntersecting && isVisible(target)) loadFrame(target);
          else pauseFrame(target);
        });
      });
    }
    mutationObserver = new MutationObserver(() => {
      if (refreshScheduled) return;
      refreshScheduled = true;
      requestAnimationFrame(() => {
        refreshScheduled = false;
        initializeRecipeGuides();
      });
    });
    mutationObserver.observe(document.body, {
      childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "open", "class"],
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) frames.forEach(pauseFrame);
    });
  }
  frames.forEach((frame) => {
    if (!frame.isConnected) {
      intersectionObserver?.unobserve(frame);
      frames.delete(frame);
    } else if (!isVisible(frame)) pauseFrame(frame);
    else if (!intersectionObserver) loadFrame(frame);
  });
  root.querySelectorAll("iframe[data-recipe-guide-src]").forEach((frame) => {
    if (frames.has(frame)) return;
    frames.add(frame);
    if (intersectionObserver) intersectionObserver.observe(frame);
    else if (isVisible(frame)) loadFrame(frame);
  });
}
