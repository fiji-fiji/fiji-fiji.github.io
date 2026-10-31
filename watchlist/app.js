const PROFILE_KEY = "watchlist.profile";
const LEGACY_PREFIX = "watchlist.";
const LEGACY_STATE = ["skips", "settings", "friend"];
const LEGACY_SEEN_KEY = "watchlist.seen";

const DAY = 24 * 60 * 60 * 1000;
const SKIP_WINDOWS = [7, 30, 90];
const RUNTIMES = [100, 120, 150];
const MOODS = ["Heavy", "Tense", "Romantic", "Funny", "Epic", "Dreamlike"];
const SEARCH_LIMIT = 25;
const TAG_MATCH = 3;
const TEXT_MATCH = 1;
const TMDB_URL = "https://www.themoviedb.org/movie/";
const NEEDS_EXPORT = "This needs your ratings and watched history. Import your full Letterboxd export to turn it on.";

// Gesture and animation tuning, in pixels, px per ms and ms.
const DRAG_SLOP = 8;
const SWIPE_DISTANCE = 90;
const SWIPE_SPEED = 0.5;
const SWIPE_TILT = 0.035;
const CLICK_GUARD = 300;
const SHEET_DRAG_DISTANCE = 110;
const SHEET_CLOSE_MS = 240;
const THEME_COLORS = { emilio: "#5f0f40", emma: "#05668d" };
const GLOW_SCALE = 1.25;
// How long the app can sit in the background before the Back list starts over. iOS often
// keeps it alive rather than relaunching, but a quick trip to another app shouldn't count.
const HISTORY_RESET_AFTER = 30 * 60 * 1000;
const CLEF_INSET = 10;
const CLEF_SIZE = 32;
const GLASS_ALPHA_ON_FILM = 0.7;
const MAX_POOLS = 3;
const MAX_LEAVING_CARDS = 2;
const POOL_FADE = 4500;
const POOL_LEAVE = 750;

const root = document.documentElement;
const stage = document.getElementById("stage");
const deck = document.getElementById("deck");
const pools = document.getElementById("pools");
const caption = document.querySelector(".caption");
const promptMark = document.getElementById("prompt");
const titleLine = document.getElementById("title");
const metaLine = document.getElementById("meta");
const whyLine = document.getElementById("why");
const lens = document.getElementById("lens");
const lensText = document.getElementById("lens-text");
const lensClear = document.getElementById("lens-clear");
const openTonight = document.getElementById("open-tonight");
const openFilm = document.getElementById("open-film");
const openExplore = document.getElementById("open-explore");
const sheet = document.getElementById("sheet");
const sheetTitle = document.getElementById("sheet-title");
const sheetBody = document.getElementById("sheet-body");
const sheetClose = document.getElementById("sheet-close");
const profileSwitch = document.getElementById("profile-switch");
const clef = document.getElementById("clef");
const goBackButton = document.getElementById("go-back");

const NO_FILTERS = {
  moods: [],
  maxRuntime: null,
  decades: [],
  composer: null,
  scoreFirst: false,
  friend: false,
  taste: false,
};

let films = [];
let insights = null;
let current = null;
let upcoming = null;
let preloaded = null;
let activeCard = null;
// The films shown so far, oldest first. Only kept in memory, so each launch starts afresh.
let shownFilms = [];
let hiddenSince = null;

const melt = createMelt();
const ost = createOstPlayer(renderClef);
let soundtracks = {};
const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const cssVar = (name) => getComputedStyle(root).getPropertyValue(name).trim();
const SPRING = cssVar("--spring");
const SPRING_SOFT = cssVar("--spring-soft");

function calm() {
  return motionQuery.matches;
}

let profiles = [];
let profile = null;
let loadId = 0;
let settings = { skipDays: 30 };
let filters = { ...NO_FILTERS };
let skips = {};
let friend = null;

// Each profile keeps its own skips, filters and friend list.
function stateKey(name) {
  return `watchlist.${profile.id}.${name}`;
}

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Without storage the app still works; filters and skips just reset on relaunch.
  }
}

function loadSettings() {
  const saved = readJson(stateKey("settings"), {});
  return {
    skipDays: SKIP_WINDOWS.includes(saved.skipDays) ? saved.skipDays : 30,
    filters: { ...NO_FILTERS, ...saved.filters },
  };
}

function saveSettings() {
  writeJson(stateKey("settings"), { skipDays: settings.skipDays, filters });
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key === "on") Object.entries(value).forEach(([name, fn]) => node.addEventListener(name, fn));
    else if (key.startsWith("aria-") || key === "for") node.setAttribute(key, value);
    else node[key] = value;
  }
  node.append(...children.filter((child) => child !== null && child !== undefined));
  return node;
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function decadeOf(film) {
  return film.year ? Math.floor(film.year / 10) * 10 : null;
}

// Picking

function normalizeKey(title, year) {
  const clean = title.toLowerCase().normalize("NFD").replace(/[^\p{L}\p{N}+]/gu, "");
  return `${clean}|${year || ""}`;
}

function isFriendFilm(film) {
  if (!friend) return false;
  return friend.ids.includes(film.id) || friend.keys.includes(normalizeKey(film.title, film.year));
}

function matches(film) {
  if (filters.moods.length && !filters.moods.some((mood) => film.moods.includes(mood))) return false;
  if (filters.maxRuntime && !(film.runtime && film.runtime < filters.maxRuntime)) return false;
  if (filters.decades.length && !filters.decades.includes(decadeOf(film))) return false;
  if (filters.composer && !film.composers.some((person) => person.name === filters.composer)) return false;
  if (filters.scoreFirst && !film.score) return false;
  if (filters.friend && !isFriendFilm(film)) return false;
  return true;
}

function isRecentlySkipped(film) {
  const at = skips[film.id];
  return Boolean(at) && Date.now() - at < settings.skipDays * DAY;
}

function chooseFrom(pool) {
  if (filters.taste) {
    const total = pool.reduce((sum, film) => sum + (film.taste || 1), 0);
    let point = Math.random() * total;
    for (const film of pool) {
      point -= film.taste || 1;
      if (point <= 0) return film;
    }
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

// Skipped films stay out for the chosen window. If that empties the pool, the
// film skipped longest ago comes back, and the one on screen never repeats at once.
function pick(excludeId) {
  const pool = films.filter(matches);
  if (!pool.length) return null;
  const others = pool.filter((film) => film.id !== excludeId);
  if (!others.length) return pool[0];
  const fresh = others.filter((film) => !isRecentlySkipped(film));
  if (fresh.length) return chooseFrom(fresh);
  return others.reduce((oldest, film) => (skips[film.id] < skips[oldest.id] ? film : oldest));
}

function preload(film) {
  preloaded = null;
  if (!film || !film.poster) return;
  const image = new Image();
  image.addEventListener("load", () => melt.prepare(image), { once: true });
  image.src = film.poster;
  preloaded = { film, image };
}

// Motion

function makeCard(film) {
  const card = el("span", { class: "card" });
  if (!film.poster) return card;
  const image = preloaded && preloaded.film === film ? preloaded.image : new Image();
  image.alt = `Poster for ${film.title}`;
  image.draggable = false;
  const reveal = () => image.classList.add("is-ready");
  if (image.complete && image.naturalWidth) {
    reveal();
  } else {
    image.addEventListener("load", reveal, { once: true });
    // Without a poster the empty frame stands in.
    image.addEventListener("error", () => image.remove(), { once: true });
  }
  if (!image.getAttribute("src")) image.src = film.poster;
  card.append(image);
  return card;
}

function retireCard(card, exit) {
  // On top of the new card, so that one is revealed as this one leaves.
  deck.append(card);
  // Blurring is costly, so fast tapping shouldn't stack up cards on their way out.
  const leaving = [...deck.children].filter((other) => other !== activeCard);
  leaving.slice(0, Math.max(0, leaving.length - MAX_LEAVING_CARDS)).forEach((other) => other.remove());
  let frames;
  let timing;
  if (calm()) {
    frames = [{ opacity: 1 }, { opacity: 0 }];
    timing = { duration: 200, easing: "linear", fill: "forwards" };
    const fade = card.animate(frames, timing);
    fade.onfinish = () => card.remove();
    fade.oncancel = () => card.remove();
    return;
  }
  if (exit && exit.direction) {
    const reach = exit.direction * (window.innerWidth + card.offsetWidth);
    frames = [
      { transform: `translateX(${exit.from}px) rotate(${exit.from * SWIPE_TILT}deg)`, opacity: 1 },
      { transform: `translateX(${reach}px) rotate(${exit.direction * 14}deg)`, opacity: 0.7 },
    ];
    timing = { duration: 340, easing: "cubic-bezier(0.25, 0.6, 0.4, 1)", fill: "forwards" };
  } else {
    // Used when a melt isn't possible, such as a film with no poster.
    frames = [
      { transform: "scale(1)", opacity: 1, filter: "blur(0px)" },
      { transform: "scale(1.03)", opacity: 0, filter: "blur(14px)" },
    ];
    timing = { duration: 620, easing: "ease-in-out", fill: "forwards" };
  }
  const animation = card.animate(frames, timing);
  const remove = () => card.remove();
  animation.onfinish = remove;
  animation.oncancel = remove;
}

function swapCard(card, exit) {
  const previous = activeCard;
  const swiped = Boolean(exit && exit.direction);
  activeCard = card;
  deck.append(card);

  if (previous && !swiped && !calm()) {
    if (melt.play(previous.querySelector("img"), card.querySelector("img"), card)) {
      previous.remove();
      return;
    }
  }
  melt.stop();
  if (previous) retireCard(previous, exit);
  if (!calm() && (!previous || swiped)) {
    card.animate(
      [{ transform: "scale(0.94)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }],
      { duration: 545, easing: SPRING },
    );
  }
}

function clearCards() {
  melt.stop();
  if (activeCard) retireCard(activeCard);
  activeCard = null;
}

// Fades in a pool of colour taken from the poster, over the previous one.
function applyPalette(palette, film) {
  if (current !== film) return;
  const box = document.querySelector(".poster-box").getBoundingClientRect();
  root.style.setProperty("--glow-x", `${box.left + box.width / 2}px`);
  root.style.setProperty("--glow-y", `${box.top + box.height / 2}px`);
  root.style.setProperty("--glow-size", `${box.height * GLOW_SCALE}px`);
  root.style.setProperty("--glass-rgb", palette.glass.join(", "));
  root.style.setProperty("--glass-alpha", GLASS_ALPHA_ON_FILM);
  root.style.setProperty("--page", `rgb(${palette.deep.join(", ")})`);
  // iOS can also colour its own edges from this.
  document.querySelector('meta[name="theme-color"]').content = `rgb(${palette.deep.join(", ")})`;

  const [first, second, third, fourth] = palette.vivid;
  const blobs = [[first, 0.95], [fourth, 0.7], [second, 0.9], [third, 0.8]].map(([color, alpha]) => {
    const blob = el("i");
    blob.style.setProperty("--blob", `rgba(${color.join(", ")}, ${alpha})`);
    return blob;
  });
  const glow = el("u");
  glow.style.setProperty("--glow", `rgba(${first.join(", ")}, 0.9)`);
  const pool = el("div", { class: "pool" }, ...blobs, glow, el("s"));
  pool.style.background = `rgb(${palette.base.join(", ")})`;
  pool.style.setProperty("--deep", palette.deep.join(", "));

  const older = [...pools.children];
  // Fast tapping shouldn't stack up layers; the ones underneath are already mostly covered.
  older.slice(0, Math.max(0, older.length - MAX_POOLS + 1)).forEach((old) => old.remove());
  pools.append(pool);
  // Force a style pass so the fade runs from zero.
  void pool.offsetWidth;
  pool.classList.add("is-on");
  older.forEach((old) => setTimeout(() => old.remove(), calm() ? 0 : POOL_FADE));
}

function setPool(film) {
  const fallback = () => applyPalette(paletteFromColors([hexToRgb(THEME_COLORS[profile.id] || THEME_COLORS.emilio)]), film);
  if (!film.poster) {
    fallback();
    return;
  }
  const image = new Image();
  image.addEventListener("load", () => applyPalette(posterPalette(image), film), { once: true });
  image.addEventListener("error", fallback, { once: true });
  image.src = film.poster;
}

// Back to the profile's own colours, as on the start screen.
function clearPools() {
  root.style.removeProperty("--glass-rgb");
  root.style.removeProperty("--glass-alpha");
  root.style.removeProperty("--page");
  document.querySelector('meta[name="theme-color"]').content = THEME_COLORS[root.dataset.theme] || THEME_COLORS.emilio;
  for (const pool of [...pools.children]) {
    pool.classList.add("is-leaving");
    setTimeout(() => pool.remove(), calm() ? 0 : POOL_LEAVE);
  }
}

function hexToRgb(hex) {
  return [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
}

function animateCaption() {
  if (calm()) return;
  caption.animate(
    [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }],
    { duration: 1800, easing: "ease-out" },
  );
}

function refreshUpcoming() {
  upcoming = pick(current && current.id);
  preload(upcoming);
}

function rememberSkip(film) {
  const now = Date.now();
  skips[film.id] = now;
  const oldest = now - Math.max(...SKIP_WINDOWS) * DAY;
  for (const id of Object.keys(skips)) {
    if (skips[id] < oldest) delete skips[id];
  }
  writeJson(stateKey("skips"), skips);
}

// Soundtrack

function soundtrackFor(film) {
  return film ? soundtracks[String(film.tmdb_id)] : undefined;
}

// Sits on the poster's bottom-right corner, but outside the tap area that changes films.
function placeClef() {
  const box = document.querySelector(".poster-box").getBoundingClientRect();
  const app = document.getElementById("app").getBoundingClientRect();
  root.style.setProperty("--clef-x", `${box.right - app.left - CLEF_SIZE - CLEF_INSET}px`);
  root.style.setProperty("--clef-y", `${box.bottom - app.top - CLEF_SIZE - CLEF_INSET}px`);
}

function renderClef() {
  const available = Boolean(soundtrackFor(current));
  const playing = Boolean(available && ost.current() === soundtrackFor(current));
  if (available) placeClef();
  clef.hidden = !available;
  clef.setAttribute("aria-pressed", String(playing));
  clef.setAttribute("aria-label", playing ? "Stop the soundtrack" : "Play the soundtrack");
  document.getElementById("now-playing")?.replaceChildren(playing ? `Playing: ${ost.trackName()}` : "");
}

function toggleSoundtrack() {
  const entry = soundtrackFor(current);
  if (!entry) return;
  if (ost.current() === entry) {
    ost.stop();
  } else {
    ost.play(entry);
  }
}

clef.addEventListener("click", toggleSoundtrack);
window.addEventListener("resize", () => {
  if (!clef.hidden) placeClef();
});

function metaParts(film) {
  const parts = [];
  if (film.year) parts.push(el("span", { class: "year", textContent: film.year }));
  if (film.year && film.director) parts.push(" · ");
  if (film.director) parts.push(el("span", { class: "director", textContent: film.director }));
  return parts;
}

function renderGoBack() {
  goBackButton.disabled = shownFilms.length === 0;
}

function show(film, exit, { remember = true } = {}) {
  if (remember && current) shownFilms.push(current);
  renderGoBack();
  current = film;
  promptMark.hidden = true;
  openFilm.disabled = false;
  titleLine.textContent = film.title;
  metaLine.replaceChildren(...metaParts(film));
  whyLine.textContent = film.why || "";
  animateCaption();
  swapCard(makeCard(film), exit);
  setPool(film);
  ost.stop();
  renderClef();
  refreshUpcoming();
}

function goBack() {
  const film = shownFilms.pop();
  if (!film) return;
  // Back on screen, so it no longer counts as skipped; leaving it again will count.
  delete skips[film.id];
  writeJson(stateKey("skips"), skips);
  show(film, undefined, { remember: false });
}

goBackButton.addEventListener("click", goBack);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    hiddenSince = Date.now();
    return;
  }
  if (hiddenSince !== null && Date.now() - hiddenSince >= HISTORY_RESET_AFTER) {
    shownFilms = [];
    renderGoBack();
  }
  hiddenSince = null;
});

function showNoMatch() {
  if (current) shownFilms.push(current);
  renderGoBack();
  current = null;
  upcoming = null;
  clearCards();
  clearPools();
  ost.stop();
  renderClef();
  promptMark.hidden = true;
  openFilm.disabled = true;
  animateCaption();
  titleLine.textContent = "No films match";
  metaLine.textContent = "Clear a filter to see more.";
  whyLine.textContent = "";
}

function advance({ skipCurrent, exit }) {
  if (!films.length) return;
  if (skipCurrent && current) rememberSkip(current);
  const next = upcoming && matches(upcoming) ? upcoming : pick(current && current.id);
  if (next) {
    show(next, exit);
  } else {
    showNoMatch();
  }
}

let ignoreClicksUntil = 0;
let stageDrag = null;

stage.addEventListener("click", () => {
  // A swipe already moved on, and its finger lift can also arrive as a click.
  if (performance.now() < ignoreClicksUntil) return;
  advance({ skipCurrent: true });
});

stage.addEventListener("pointerdown", (event) => {
  if (!activeCard || event.button) return;
  stageDrag = { id: event.pointerId, startX: event.clientX, lastX: event.clientX, lastTime: event.timeStamp, speed: 0, moved: false, card: activeCard };
});

stage.addEventListener("pointermove", (event) => {
  if (!stageDrag || event.pointerId !== stageDrag.id) return;
  const offset = event.clientX - stageDrag.startX;
  if (!stageDrag.moved) {
    if (Math.abs(offset) < DRAG_SLOP) return;
    stageDrag.moved = true;
    stage.setPointerCapture?.(event.pointerId);
    stageDrag.card.getAnimations().forEach((animation) => animation.cancel());
  }
  const elapsed = event.timeStamp - stageDrag.lastTime;
  if (elapsed > 0) stageDrag.speed = (event.clientX - stageDrag.lastX) / elapsed;
  stageDrag.lastX = event.clientX;
  stageDrag.lastTime = event.timeStamp;
  stageDrag.card.style.transform = `translateX(${offset}px) rotate(${offset * SWIPE_TILT}deg)`;
});

function endStageDrag(event, cancelled) {
  if (!stageDrag || event.pointerId !== stageDrag.id) return;
  const drag = stageDrag;
  stageDrag = null;
  if (!drag.moved) return;
  ignoreClicksUntil = performance.now() + CLICK_GUARD;
  const offset = event.clientX - drag.startX;
  const flung = Math.abs(offset) > SWIPE_DISTANCE || Math.abs(drag.speed) > SWIPE_SPEED;
  if (!cancelled && flung) {
    drag.card.style.transform = "";
    advance({ skipCurrent: true, exit: { direction: Math.sign(offset) || 1, from: offset } });
    return;
  }
  drag.card.style.transform = "";
  if (!calm()) {
    drag.card.animate(
      [{ transform: `translateX(${offset}px) rotate(${offset * SWIPE_TILT}deg)` }, { transform: "none" }],
      { duration: 545, easing: SPRING },
    );
  }
}

stage.addEventListener("pointerup", (event) => endStageDrag(event, false));
stage.addEventListener("pointercancel", (event) => endStageDrag(event, true));

// iOS only applies :active press states once a touch listener exists.
document.addEventListener("touchstart", () => {}, { passive: true });

// Filters

function lensParts() {
  const parts = [...filters.moods];
  if (filters.maxRuntime) parts.push(`under ${filters.maxRuntime} min`);
  parts.push(...filters.decades.map((decade) => `${decade}s`));
  if (filters.composer) parts.push(`scored by ${filters.composer}`);
  if (filters.scoreFirst) parts.push("score-first");
  if (filters.friend && friend) parts.push(`with ${friend.name}`);
  if (filters.taste) parts.push("my taste");
  return parts;
}

function renderLens() {
  const parts = lensParts();
  lens.hidden = parts.length === 0;
  openTonight.classList.toggle("is-active", parts.length > 0);
  lensText.textContent = `${parts.join(" · ")} — ${plural(films.filter(matches).length, "film")}`;
}

function filtersChanged() {
  saveSettings();
  renderLens();
  refreshUpcoming();
}

lensClear.addEventListener("click", () => {
  filters = { ...NO_FILTERS };
  filtersChanged();
  if (!current) advance({ skipCurrent: false });
});

function applyAndShow() {
  closeSheet();
  filtersChanged();
  advance({ skipCurrent: false });
}

// Sheets

function openSheet(title, render) {
  sheetTitle.textContent = title;
  sheetBody.replaceChildren(...render());
  clearTimeout(sheetCloseTimer);
  sheet.classList.remove("is-closing");
  sheet.style.removeProperty("--drag-y");
  sheet.style.transform = "";
  if (!sheet.open) sheet.showModal();
  sheetBody.scrollTop = 0;
}

let sheetCloseTimer = null;

function closeSheet() {
  if (!sheet.open || sheet.classList.contains("is-closing")) return;
  const finish = () => {
    sheet.classList.remove("is-closing");
    sheet.style.removeProperty("--drag-y");
    if (sheet.open) sheet.close();
  };
  if (calm()) {
    finish();
    return;
  }
  sheet.classList.add("is-closing");
  sheetCloseTimer = setTimeout(finish, SHEET_CLOSE_MS);
}

sheetClose.addEventListener("click", closeSheet);

sheet.addEventListener("click", (event) => {
  if (event.target === sheet) closeSheet();
});

// Escape on a keyboard: play the same exit as every other way of closing.
sheet.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeSheet();
});

// Pull the sheet down by its header to dismiss it.
const sheetHead = document.querySelector(".sheet-head");
let sheetDrag = null;

sheetHead.addEventListener("pointerdown", (event) => {
  if (event.target.closest("button")) return;
  sheetDrag = { id: event.pointerId, startY: event.clientY, lastY: event.clientY, lastTime: event.timeStamp, speed: 0 };
  sheetHead.setPointerCapture?.(event.pointerId);
});

sheetHead.addEventListener("pointermove", (event) => {
  if (!sheetDrag || event.pointerId !== sheetDrag.id) return;
  const elapsed = event.timeStamp - sheetDrag.lastTime;
  if (elapsed > 0) sheetDrag.speed = (event.clientY - sheetDrag.lastY) / elapsed;
  sheetDrag.lastY = event.clientY;
  sheetDrag.lastTime = event.timeStamp;
  sheet.style.animation = "none";
  sheet.style.transform = `translateY(${Math.max(0, event.clientY - sheetDrag.startY)}px)`;
});

function endSheetDrag(event) {
  if (!sheetDrag || event.pointerId !== sheetDrag.id) return;
  const offset = Math.max(0, event.clientY - sheetDrag.startY);
  const flung = offset > SHEET_DRAG_DISTANCE || sheetDrag.speed > SWIPE_SPEED;
  sheetDrag = null;
  sheet.style.animation = "";
  sheet.style.transform = "";
  if (offset > 0 && flung) {
    sheet.style.setProperty("--drag-y", `${offset}px`);
    closeSheet();
  } else if (offset > 0 && !calm()) {
    sheet.animate([{ transform: `translateY(${offset}px)` }, { transform: "none" }], { duration: 545, easing: SPRING });
  }
}

sheetHead.addEventListener("pointerup", endSheetDrag);
sheetHead.addEventListener("pointercancel", endSheetDrag);

// Sections open and close smoothly; browsers can't animate <details> height on their own.
function toggleDetails(details) {
  const panel = details.querySelector(":scope > .panel");
  panel.getAnimations().forEach((animation) => animation.cancel());
  const opening = !details.open;
  if (opening && details.fillPanel) {
    panel.append(...details.fillPanel());
    details.fillPanel = null;
  }
  details.open = true;
  if (calm()) {
    details.open = opening;
    return;
  }
  const height = `${panel.offsetHeight}px`;
  panel.style.overflow = "hidden";
  const frames = [{ height: "0px", opacity: 0 }, { height, opacity: 1 }];
  const animation = panel.animate(opening ? frames : [...frames].reverse(), {
    duration: opening ? 450 : 240,
    easing: opening ? SPRING_SOFT : "ease-in",
  });
  animation.onfinish = () => {
    panel.style.overflow = "";
    details.open = opening;
  };
}

sheetBody.addEventListener("click", (event) => {
  const summary = event.target.closest("summary");
  if (!summary) return;
  event.preventDefault();
  toggleDetails(summary.parentElement);
});

sheet.addEventListener("close", () => {
  if (films.length) {
    saveSettings();
    renderLens();
  }
});

function group(heading, ...children) {
  return el("section", { class: "group" }, heading ? el("h3", { textContent: heading }) : null, ...children);
}

function note(text) {
  return el("p", { class: "note", textContent: text });
}

function fine(text) {
  return el("p", { class: "fine", textContent: text });
}

function chip(label, isOn, onToggle) {
  const button = el("button", {
    type: "button",
    class: "chip",
    textContent: label,
    "aria-pressed": String(isOn),
    on: { click: () => onToggle(button) },
  });
  return button;
}

function multiChips(options, key, onChange) {
  return el("div", { class: "chips" }, ...options.map(([label, value]) => chip(
    label,
    filters[key].includes(value),
    (button) => {
      const on = !filters[key].includes(value);
      filters = {
        ...filters,
        [key]: on ? [...filters[key], value] : filters[key].filter((item) => item !== value),
      };
      button.setAttribute("aria-pressed", String(on));
      onChange();
    },
  )));
}

function singleChips(options, isSelected, select) {
  const buttons = options.map(([label, value]) => chip(label, isSelected(value), () => {
    select(value);
    buttons.forEach((button, index) => {
      button.setAttribute("aria-pressed", String(isSelected(options[index][1])));
    });
  }));
  return el("div", { class: "chips" }, ...buttons);
}

function toggleChip(label, key, onChange) {
  return chip(label, filters[key], (button) => {
    filters = { ...filters, [key]: !filters[key] };
    button.setAttribute("aria-pressed", String(filters[key]));
    onChange();
  });
}

// Tonight

function renderTonight() {
  const action = el("button", { type: "button", class: "primary" });
  const update = () => {
    const count = films.filter(matches).length;
    action.textContent = count ? `Show one of ${plural(count, "film")}` : "No films match";
    action.disabled = count === 0;
  };
  action.addEventListener("click", applyAndShow);

  const decades = [...new Set(films.map(decadeOf).filter(Boolean))].sort((a, b) => a - b);
  const runtimeOptions = [["Any length", null], ...RUNTIMES.map((minutes) => [`Under ${minutes} min`, minutes])];
  const skippedCount = Object.keys(skips).length;
  const forget = el("button", {
    type: "button",
    class: "chip",
    textContent: `Forget ${plural(skippedCount, "skipped film")}`,
    disabled: skippedCount === 0,
    on: {
      click: () => {
        skips = {};
        writeJson(stateKey("skips"), skips);
        forget.textContent = "Forgotten";
        forget.disabled = true;
      },
    },
  });

  const extras = [toggleChip("Score-first", "scoreFirst", update)];
  if (insights && insights.has_taste) extras.push(toggleChip("Weight by my taste", "taste", update));

  update();
  return [
    group("Mood", multiChips(MOODS.map((mood) => [mood, mood]), "moods", update)),
    group("Length", singleChips(runtimeOptions, (value) => filters.maxRuntime === value, (value) => {
      filters = { ...filters, maxRuntime: value };
      update();
    })),
    group("Decade", multiChips(decades.map((decade) => [`${decade}s`, decade]), "decades", update)),
    group("Focus", el("div", { class: "chips" }, ...extras)),
    group(
      "Don’t re-suggest skipped films for",
      singleChips(SKIP_WINDOWS.map((days) => [`${days} days`, days]), (value) => settings.skipDays === value, (value) => {
        settings.skipDays = value;
        saveSettings();
      }),
      el("div", { class: "chips", style: "margin-top:8px" }, forget),
    ),
    el("div", { class: "sticky-action" }, action),
  ];
}

openTonight.addEventListener("click", () => openSheet("Tonight", renderTonight));

// This film

function soundtrackQuery(film) {
  const composer = film.composers[0] ? film.composers[0].name : "";
  return `${film.title} ${composer} soundtrack`.replace(/\s+/g, " ");
}

function outLink(label, href, className = "chip") {
  return el("a", { class: className, href, target: "_blank", rel: "noopener", textContent: label });
}

function renderFilm() {
  const film = current;
  const query = encodeURIComponent(soundtrackQuery(film));
  const { stream, rent, link } = film.providers;
  const sections = [];

  if (film.why) sections.push(group("Why this film?", note(film.why)));

  const scoreParts = [];
  if (film.composers.length) {
    scoreParts.push(el("div", { class: "chips" }, ...film.composers.map((person) => el("button", {
      type: "button",
      class: "chip",
      textContent: `More by ${person.name}`,
      on: { click: () => filterByComposer(person.name) },
    }))));
  } else {
    scoreParts.push(note("TMDB doesn’t credit a composer for this film."));
  }
  if (film.score) {
    scoreParts.push(el("p", { class: "note", style: "margin-top:10px", textContent: film.score.tags.join(" · ") }));
  }
  sections.push(group("Score", ...scoreParts));

  const soundtrack = soundtrackFor(film);
  if (soundtrack) {
    const toggle = chip("Play or stop", ost.current() === soundtrack, () => {
      toggleSoundtrack();
      toggle.setAttribute("aria-pressed", String(ost.current() === soundtrack));
    });
    sections.push(group(
      "Soundtrack",
      note(`${soundtrack.album} · ${soundtrack.artist}`),
      el(
        "div",
        { class: "chips", style: "margin-top:10px" },
        toggle,
        outLink("Full album on Spotify", soundtrack.spotify),
        outLink("Apple Music", soundtrack.apple),
      ),
      el("p", {
        id: "now-playing",
        class: "fine",
        style: "margin-top:8px",
        textContent: ost.current() === soundtrack ? `Playing: ${ost.trackName()}` : "",
      }),
      el("p", {
        class: "fine",
        style: "margin-top:4px",
        textContent: "The app plays Apple Music’s preview of each track, about 30 seconds long.",
      }),
    ));
  } else {
    sections.push(group(
      "Soundtrack",
      note("No soundtrack album was found for this film."),
      el(
        "div",
        { class: "chips", style: "margin-top:10px" },
        outLink("Search Spotify", `https://open.spotify.com/search/${query}`),
        outLink("Search Apple Music", `https://music.apple.com/search?term=${query}`),
      ),
    ));
  }

  const streamParts = [note(stream.length ? stream.join(", ") : "Not on a subscription service in France right now.")];
  if (rent.length) streamParts.push(note(`To rent: ${rent.slice(0, 5).join(", ")}`));
  if (link) streamParts.push(el("div", { style: "margin-top:10px" }, outLink("All options", link)));
  if (insights) {
    streamParts.push(el("p", {
      class: "fine",
      style: "margin-top:8px",
      textContent: `Checked ${insights.updated}. Streaming data from JustWatch.`,
    }));
  }
  sections.push(group("Where to stream in France", ...streamParts));

  if (film.runtime) sections.push(group("Length", note(`${film.runtime} min`)));
  return sections;
}

function filterByComposer(name) {
  filters = { ...filters, composer: name };
  applyAndShow();
}

openFilm.addEventListener("click", () => {
  if (current) openSheet(current.title, renderFilm);
});

// Explore

function stateLabel(state) {
  if (state === "watched") return "Watched";
  if (state === "watchlist") return "On your watchlist";
  return null;
}

function filmLine(film) {
  return [film.year, stateLabel(film.state)].filter(Boolean).join(" · ");
}

function tmdbRow(film, subtitle) {
  return el(
    "a",
    { class: "row", href: `${TMDB_URL}${film.tmdb_id}`, target: "_blank", rel: "noopener" },
    el("span", { class: "row-title", textContent: film.title }),
    subtitle ? el("span", { class: "row-sub", textContent: subtitle }) : null,
  );
}

function filmByTmdb(tmdbId) {
  return films.find((film) => film.tmdb_id === tmdbId);
}

function showFromExplore(film) {
  closeSheet();
  show(film);
}

// A film on the watchlist opens in the app; anything else opens on TMDB.
function resultRow(film, subtitle) {
  const own = filmByTmdb(film.tmdb_id);
  if (!own) return tmdbRow(film, subtitle);
  return el(
    "button",
    { type: "button", class: "row", on: { click: () => showFromExplore(own) } },
    el("span", { class: "row-title", textContent: film.title }),
    subtitle ? el("span", { class: "row-sub", textContent: subtitle }) : null,
  );
}

function searchEntries() {
  const own = films.map((film) => ({
    film,
    tags: film.score ? film.score.tags : [],
    text: [film.title, film.director, ...film.composers.map((person) => person.name), ...film.keywords, ...film.genres, ...film.moods],
    sub: () => [film.year, film.composers.map((person) => person.name).join(", ")].filter(Boolean).join(" · "),
  }));
  const ownIds = new Set(films.map((film) => film.tmdb_id));
  const others = (insights ? insights.score_first : []).filter((film) => !ownIds.has(film.tmdb_id)).map((film) => ({
    film,
    tags: film.tags,
    text: [film.title, film.director, ...film.composers],
    sub: () => [film.year, film.composers.join(", "), stateLabel(film.state) || "Not on your watchlist"].filter(Boolean).join(" · "),
  }));
  return [...own, ...others];
}

function runSearch(query) {
  const tokens = query.toLowerCase().split(/[\s,]+/).filter(Boolean);
  if (!tokens.length) return [];
  const scored = [];
  for (const entry of searchEntries()) {
    const tags = entry.tags.map((tag) => tag.toLowerCase());
    const text = entry.text.filter(Boolean).map((item) => item.toLowerCase());
    let score = 0;
    let hits = 0;
    for (const token of tokens) {
      if (tags.some((tag) => tag.includes(token))) {
        score += TAG_MATCH;
        hits += 1;
      } else if (text.some((item) => item.includes(token))) {
        score += TEXT_MATCH;
        hits += 1;
      }
    }
    if (hits) scored.push({ entry, score });
  }
  scored.sort((a, b) => b.score - a.score || a.entry.film.title.localeCompare(b.entry.film.title));
  return scored.slice(0, SEARCH_LIMIT).map(({ entry }) => entry);
}

function searchPanel() {
  const results = el("div");
  const input = el("input", {
    type: "search",
    class: "search",
    placeholder: "solo cello, sparse, melancholic",
    "aria-label": "Search by composer, instrument or mood",
    on: {
      input: () => {
        const found = runSearch(input.value);
        results.replaceChildren(...(input.value.trim() && !found.length ? [note("Nothing matches that.")] : []));
        results.append(...found.map((entry) => {
          const tagLine = entry.tags.length ? ` · ${entry.tags.join(", ")}` : "";
          return resultRow(entry.film, `${entry.sub()}${tagLine}`);
        }));
      },
    },
  });
  const tagged = films.filter((film) => film.score).length + (insights ? insights.score_first.length : 0);
  return [input, results, el("p", {
    class: "fine",
    style: "margin-top:8px",
    textContent: `Instruments and moods are hand-tagged on ${tagged} scores. Other films only match on title, composer, genre and TMDB keywords.`,
  })];
}

function composerSubtitle(row) {
  const parts = [`${row.watchlist} on watchlist`];
  if (insights.has_history) {
    parts.push(`${row.watched} watched`);
    parts.push(`${row.five_star} at 5★`);
  }
  return parts.join(" · ");
}

function composersPanel() {
  const rows = insights.composers.flatMap((row) => {
    const items = [];
    if (row.watchlist) {
      items.push(el(
        "button",
        { type: "button", class: "row", on: { click: () => { filterByComposer(row.name); } } },
        el("span", { class: "row-title", textContent: row.name }),
        el("span", { class: "row-sub", textContent: composerSubtitle(row) }),
      ));
    } else {
      items.push(el(
        "div",
        { class: "row" },
        el("span", { class: "row-title", textContent: row.name }),
        el("span", { class: "row-sub", textContent: composerSubtitle(row) }),
      ));
    }
    if (row.discover && row.discover.length) {
      items.push(el("p", {
        class: "fine",
        textContent: `Unseen: ${row.discover.map((film) => `${film.title}${film.year ? ` (${film.year})` : ""}`).join(", ")}`,
      }));
    }
    return items;
  });
  const intro = insights.has_history
    ? "Ranked by 5★ films, then watched, then watchlist. Tap one to pick from their films on your watchlist."
    : `Ranked by your watchlist. Tap one to pick from their films. Import your full Letterboxd export to add watched and 5★ counts and unseen suggestions.`;
  return [note(intro), ...rows];
}

function pairsPanel() {
  const rows = insights.pairs.map((pair) => {
    const progress = insights.has_history
      ? `${pair.watched} of ${pair.total} watched · ${pair.watchlist} on watchlist`
      : `${pair.watchlist} of ${pair.total} on your watchlist`;
    return el(
      "details",
      {},
      el(
        "summary",
        {},
        el(
          "span",
          {},
          el("span", { class: "row-title", textContent: `${pair.director} × ${pair.composer}` }),
          el("span", { class: "row-sub", textContent: progress }),
        ),
      ),
      el("div", { class: "panel" }, ...pair.films.map((film) => resultRow(film, filmLine(film)))),
    );
  });
  return [
    note(insights.has_history
      ? "Every film each pair made together, and how far you’ve got."
      : "Every film each pair made together. Your full Letterboxd export would add which ones you’ve seen."),
    ...rows,
  ];
}

function scoreFirstPanel() {
  const own = films.filter((film) => film.score);
  const action = el("button", {
    type: "button",
    class: "primary",
    textContent: `Pick from the ${plural(own.length, "score-first film")} on your watchlist`,
    on: {
      click: () => {
        filters = { ...filters, scoreFirst: true };
        applyAndShow();
      },
    },
  });
  const others = insights.score_first.filter((film) => film.state !== "watched");
  return [
    note("Films where the music is central. This is a hand-picked list, not a ranking from data."),
    el("div", { style: "margin:10px 0" }, action),
    ...own.map((film) => resultRow(film, `${[film.composers.map((person) => person.name).join(", ")].filter(Boolean)} · ${film.score.tags.join(", ")}`)),
    el("h3", { style: "margin:16px 0 4px", class: "fine", textContent: "Not on your watchlist" }),
    ...others.map((film) => tmdbRow(film, [film.year, film.composers.join(", "), film.tags.join(", ")].filter(Boolean).join(" · "))),
  ];
}

function blindSpotsPanel() {
  if (!insights.has_history) return [note(NEEDS_EXPORT)];
  return [
    note("Highly rated, widely seen films in the genres you rate highest, that you’ve never logged."),
    ...insights.blind_spots.map((row) => group(row.genre, ...row.films.map((film) => tmdbRow(film, film.year ? String(film.year) : null)))),
  ];
}

function tastePanel() {
  if (!insights.has_history) return [note(NEEDS_EXPORT)];
  if (!insights.has_taste) return [note(`You’ve rated ${insights.rated_count} films; this needs at least 10.`)];
  const on = filters.taste;
  return [
    note(`Based on your ${insights.rated_count} ratings, films by directors, composers and genres you rate highly come up more often.`),
    el("div", { class: "chips", style: "margin-top:10px" }, chip("Weight picks by my taste", on, (button) => {
      filters = { ...filters, taste: !filters.taste };
      button.setAttribute("aria-pressed", String(filters.taste));
      filtersChanged();
    })),
  ];
}

// Quoted fields can contain commas and line breaks, as in "Paris, Texas".
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field || row.length) rows.push([...row, field.replace(/\r$/, "")]);
  return rows;
}

function friendFromCsv(text, filename) {
  const [header, ...rows] = parseCsv(text.replace(/^﻿/, ""));
  const uri = header ? header.indexOf("Letterboxd URI") : -1;
  const name = header ? header.indexOf("Name") : -1;
  const year = header ? header.indexOf("Year") : -1;
  if (uri < 0 || name < 0) return null;
  const complete = rows.filter((row) => row[name]);
  const match = filename.match(/^watchlist-(.+?)-\d{4}-/);
  return {
    name: match ? match[1] : "friend",
    ids: complete.map((row) => row[uri]).filter(Boolean),
    keys: complete.map((row) => normalizeKey(row[name], year >= 0 ? row[year] : "")),
  };
}

function moviePanel() {
  const status = el("div", { style: "margin-top:12px" });

  function renderStatus(message) {
    const parts = [];
    if (message) parts.push(note(message));
    if (friend) {
      const shared = films.filter(isFriendFilm);
      parts.push(note(`${plural(shared.length, "film")} on both your watchlist and ${friend.name}’s.`));
      if (shared.length) {
        parts.push(el("button", {
          type: "button",
          class: "primary",
          style: "margin-top:10px",
          textContent: `Pick one for you and ${friend.name}`,
          on: {
            click: () => {
              filters = { ...filters, friend: true };
              applyAndShow();
            },
          },
        }));
      }
      parts.push(el("div", { class: "chips", style: "margin-top:10px" }, el("button", {
        type: "button",
        class: "chip",
        textContent: `Remove ${friend.name}’s list`,
        on: {
          click: () => {
            friend = null;
            try {
              localStorage.removeItem(stateKey("friend"));
            } catch {
              // Nothing was stored, so there is nothing to remove.
            }
            filters = { ...filters, friend: false };
            filtersChanged();
            renderStatus();
          },
        },
      })));
    }
    status.replaceChildren(...parts);
  }

  const input = el("input", {
    type: "file",
    id: "friend-file",
    class: "file-input",
    accept: ".csv,text/csv",
    on: {
      change: async () => {
        const file = input.files[0];
        input.value = "";
        if (!file) return;
        const parsed = friendFromCsv(await file.text(), file.name);
        if (!parsed) {
          renderStatus("That isn’t a Letterboxd watchlist CSV. If it’s a zip, unzip it and choose watchlist.csv.");
          return;
        }
        friend = parsed;
        writeJson(stateKey("friend"), friend);
        filtersChanged();
        renderStatus();
      },
    },
  });
  renderStatus();
  return [
    note("Ask your friend to export their Letterboxd watchlist as a CSV and send it to you. It stays on this phone."),
    el(
      "div",
      { style: "margin-top:10px" },
      input,
      el("label", { for: "friend-file", class: "chip file-label", textContent: "Choose their CSV" }),
    ),
    status,
  ];
}

function renderExplore() {
  const section = (title, build) => {
    const panel = el("div", { class: "panel" });
    // Sections are built on first open so the sheet appears at once.
    return el("details", { fillPanel: build }, el("summary", { textContent: title }), panel);
  };
  const about = el(
    "div",
    { class: "panel" },
    fine("Film data and posters from TMDB. This app uses the TMDB API but is not endorsed or certified by TMDB. Streaming data from JustWatch. Watchlist from your Letterboxd export."),
  );
  if (insights) about.append(fine(`Last updated ${insights.updated}.`));
  return [
    section("Search by score", searchPanel),
    section("Composers", composersPanel),
    section("Director × composer", pairsPanel),
    section("Score-first films", scoreFirstPanel),
    section("Match my taste", tastePanel),
    section("Blind spots", blindSpotsPanel),
    section("Movie night with a friend", moviePanel),
    el("details", {}, el("summary", { textContent: "About the data" }), about),
  ];
}

openExplore.addEventListener("click", () => {
  if (insights) openSheet("Explore", renderExplore);
});

// Start

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

// State saved before there were profiles belongs to the first profile, the app's original owner.
function migrateLegacyState() {
  try {
    localStorage.removeItem(LEGACY_SEEN_KEY);
    for (const name of LEGACY_STATE) {
      const oldKey = `${LEGACY_PREFIX}${name}`;
      const saved = localStorage.getItem(oldKey);
      if (saved !== null) {
        localStorage.setItem(`watchlist.${profiles[0].id}.${name}`, saved);
        localStorage.removeItem(oldKey);
      }
    }
  } catch {
    // Storage is optional.
  }
}

function renderSwitch() {
  profileSwitch.hidden = profiles.length < 2;
  if (!profileSwitch.childElementCount) {
    profileSwitch.style.setProperty("--count", profiles.length);
    profileSwitch.append(
      el("span", { class: "switch-thumb" }, el("b")),
      ...profiles.map((option) => el("button", {
        type: "button",
        textContent: option.name,
        on: { click: (event) => selectProfile(option, event.currentTarget) },
      })),
    );
  }
  profiles.forEach((option, index) => {
    const selected = option.id === profile.id;
    profileSwitch.querySelectorAll("button")[index].setAttribute("aria-pressed", String(selected));
    if (selected) profileSwitch.style.setProperty("--index", index);
  });
}

// The new palette spreads across the screen like a ripple from the switch.
let rippleAnimation = null;

function flowTheme(id, origin) {
  const previous = root.dataset.theme;
  root.dataset.theme = id;
  document.querySelector('meta[name="theme-color"]').content = THEME_COLORS[id] || THEME_COLORS.emilio;
  if (!origin || previous === id || calm()) return;

  const incoming = document.querySelector(`.water[data-water="${id}"]`);
  const outgoing = document.querySelector(`.water[data-water="${previous}"]`);
  if (!incoming || !outgoing) return;
  if (rippleAnimation) rippleAnimation.cancel();
  document.querySelectorAll(".water.is-leaving").forEach((water) => water.classList.remove("is-leaving"));
  outgoing.classList.add("is-leaving");

  const box = origin.getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  const reach = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  const animation = incoming.animate(
    { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${reach}px at ${x}px ${y}px)`] },
    { duration: 760, easing: "cubic-bezier(0.3, 0.7, 0.2, 1)" },
  );
  rippleAnimation = animation;
  animation.onfinish = () => {
    outgoing.classList.remove("is-leaving");
    rippleAnimation = null;
  };
}

function resetStage() {
  shownFilms = [];
  renderGoBack();
  current = null;
  upcoming = null;
  preload(null);
  clearCards();
  clearPools();
  ost.stop();
  promptMark.hidden = false;
  openFilm.disabled = true;
  animateCaption();
  titleLine.textContent = "";
  metaLine.textContent = "";
  whyLine.textContent = "";
  renderClef();
}

// Fetching the other profiles lets the service worker keep them for offline use.
function cacheOtherProfiles() {
  for (const option of profiles) {
    if (option.id !== profile.id) {
      fetch(`p/${option.id}/films.json`).catch(() => {});
      fetch(`p/${option.id}/insights.json`).catch(() => {});
    }
  }
}

async function selectProfile(option, origin) {
  if (profile && option.id === profile.id) return;
  closeSheet();
  flowTheme(option.id, origin);
  loadId += 1;
  const thisLoad = loadId;
  profile = option;
  try {
    localStorage.setItem(PROFILE_KEY, option.id);
  } catch {
    // Storage is optional.
  }

  // Nothing from the previous profile may be picked while this one loads.
  films = [];
  insights = null;
  settings = loadSettings();
  filters = settings.filters;
  skips = readJson(stateKey("skips"), {});
  friend = readJson(stateKey("friend"), null);
  renderSwitch();
  resetStage();
  lens.hidden = true;
  openTonight.classList.remove("is-active");
  openExplore.disabled = true;
  openTonight.disabled = true;
  metaLine.textContent = "Loading…";

  let loaded;
  let loadedInsights = null;
  try {
    [loaded, loadedInsights] = await Promise.all([
      fetchJson(`p/${option.id}/films.json`),
      fetchJson(`p/${option.id}/insights.json`).catch(() => null),
    ]);
  } catch {
    if (thisLoad !== loadId) return;
    titleLine.textContent = `Couldn’t load ${option.name}’s watchlist`;
    metaLine.textContent = "Check your connection and try again.";
    promptMark.hidden = true;
    return;
  }
  // A newer tap on the switch wins over a slower response.
  if (thisLoad !== loadId) return;

  films = loaded;
  insights = loadedInsights;
  openExplore.disabled = !insights;

  if (!films.length) {
    titleLine.textContent = "No films yet";
    metaLine.textContent = "Run the import script to add this watchlist.";
    promptMark.hidden = true;
    return;
  }

  openTonight.disabled = false;
  titleLine.textContent = profiles.length > 1 ? `${option.name}’s watchlist` : "Watchlist";
  metaLine.textContent = plural(films.length, "film");
  renderLens();
  refreshUpcoming();
  cacheOtherProfiles();
}

function savedProfile() {
  try {
    return profiles.find((option) => option.id === localStorage.getItem(PROFILE_KEY));
  } catch {
    return undefined;
  }
}

async function start() {
  // Soundtracks are optional: without this file the films simply have no button.
  fetchJson("ost.json").then((data) => {
    soundtracks = data;
    renderClef();
  }).catch(() => {});
  try {
    profiles = await fetchJson("profiles.json");
  } catch {
    titleLine.textContent = "Couldn’t load your watchlist";
    metaLine.textContent = "Check your connection and reopen the app.";
    promptMark.hidden = true;
    openTonight.disabled = true;
    return;
  }
  migrateLegacyState();
  await selectProfile(savedProfile() || profiles[0]);
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

start();
