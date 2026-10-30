const SEEN_KEY = "watchlist.seen";

const stage = document.getElementById("stage");
const poster = document.getElementById("poster");
const prompt = document.getElementById("prompt");
const title = document.getElementById("title");
const meta = document.getElementById("meta");
const credit = document.getElementById("credit");

let films = [];
let seen = readSeen();
let current = null;
let upcoming = null;
let preloaded = null;

function readSeen() {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY)) || []);
  } catch {
    return new Set();
  }
}

function writeSeen() {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
  } catch {
    // Without storage the app still works; repeats just become possible after a relaunch.
  }
}

// Every film comes up once before any repeats; the film on screen is never drawn twice in a row.
function pick(excludeId) {
  let pool = films.filter((film) => !seen.has(film.id) && film.id !== excludeId);
  if (!pool.length) {
    seen = new Set(excludeId ? [excludeId] : []);
    writeSeen();
    pool = films.filter((film) => film.id !== excludeId);
  }
  if (!pool.length) pool = films;
  return pool[Math.floor(Math.random() * pool.length)];
}

function preload(film) {
  preloaded = null;
  if (!film.poster) return;
  preloaded = new Image();
  preloaded.src = film.poster;
}

function show(film) {
  current = film;
  seen.add(film.id);
  writeSeen();

  prompt.hidden = true;
  credit.hidden = true;
  title.textContent = film.title;
  meta.textContent = [film.year, film.director].filter(Boolean).join(" · ");

  // Without a poster, or until it arrives, the empty teal frame stands in.
  poster.hidden = true;
  poster.alt = `Poster for ${film.title}`;
  if (film.poster) {
    poster.src = film.poster;
  } else {
    poster.removeAttribute("src");
  }

  upcoming = pick(film.id);
  preload(upcoming);
}

poster.addEventListener("load", () => {
  poster.hidden = false;
});

poster.addEventListener("error", () => {
  poster.hidden = true;
});

stage.addEventListener("click", () => {
  if (!films.length) return;
  show(upcoming || pick(current && current.id));
});

async function start() {
  try {
    const response = await fetch("films.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    films = await response.json();
  } catch {
    title.textContent = "Couldn’t load your watchlist";
    meta.textContent = "Check your connection and reopen the app.";
    prompt.hidden = true;
    return;
  }

  if (!films.length) {
    title.textContent = "No films yet";
    meta.textContent = "Run the import script to add your watchlist.";
    prompt.hidden = true;
    return;
  }

  title.textContent = "Watchlist";
  meta.textContent = `${films.length} ${films.length === 1 ? "film" : "films"}`;
  upcoming = pick(null);
  preload(upcoming);
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

start();
