const SKIPS_KEY = "watchlist.skips";
const SETTINGS_KEY = "watchlist.settings";
const FRIEND_KEY = "watchlist.friend";
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

const stage = document.getElementById("stage");
const poster = document.getElementById("poster");
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

const settings = loadSettings();
let filters = settings.filters;
let skips = readJson(SKIPS_KEY, {});
let friend = readJson(FRIEND_KEY, null);

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
  const saved = readJson(SETTINGS_KEY, {});
  return {
    skipDays: SKIP_WINDOWS.includes(saved.skipDays) ? saved.skipDays : 30,
    filters: { ...NO_FILTERS, ...saved.filters },
  };
}

function saveSettings() {
  writeJson(SETTINGS_KEY, { skipDays: settings.skipDays, filters });
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
  preloaded = new Image();
  preloaded.src = film.poster;
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
  writeJson(SKIPS_KEY, skips);
}

function show(film) {
  current = film;
  promptMark.hidden = true;
  openFilm.disabled = false;
  titleLine.textContent = film.title;
  metaLine.textContent = [film.year, film.director].filter(Boolean).join(" · ");
  whyLine.textContent = film.why || "";

  // Without a poster, or until it arrives, the empty teal frame stands in.
  poster.hidden = true;
  poster.alt = `Poster for ${film.title}`;
  if (film.poster) {
    poster.src = film.poster;
  } else {
    poster.removeAttribute("src");
  }
  refreshUpcoming();
}

function showNoMatch() {
  current = null;
  upcoming = null;
  poster.hidden = true;
  poster.removeAttribute("src");
  promptMark.hidden = true;
  openFilm.disabled = true;
  titleLine.textContent = "No films match";
  metaLine.textContent = "Clear a filter to see more.";
  whyLine.textContent = "";
}

function advance({ skipCurrent }) {
  if (!films.length) return;
  if (skipCurrent && current) rememberSkip(current);
  const next = upcoming && matches(upcoming) ? upcoming : pick(current && current.id);
  if (next) {
    show(next);
  } else {
    showNoMatch();
  }
}

poster.addEventListener("load", () => {
  poster.hidden = false;
});

poster.addEventListener("error", () => {
  poster.hidden = true;
});

stage.addEventListener("click", () => advance({ skipCurrent: true }));

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
  sheet.close();
  filtersChanged();
  advance({ skipCurrent: false });
}

// Sheets

function openSheet(title, render) {
  sheetTitle.textContent = title;
  sheetBody.replaceChildren(...render());
  if (!sheet.open) sheet.showModal();
  sheetBody.scrollTop = 0;
}

sheetClose.addEventListener("click", () => sheet.close());

sheet.addEventListener("click", (event) => {
  if (event.target === sheet) sheet.close();
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
        writeJson(SKIPS_KEY, skips);
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

  sections.push(group(
    "Soundtrack",
    el(
      "div",
      { class: "chips" },
      outLink("Spotify", `https://open.spotify.com/search/${query}`),
      outLink("Apple Music", `https://music.apple.com/search?term=${query}`),
    ),
    el("p", { class: "fine", style: "margin-top:8px", textContent: "Opens a search for the soundtrack." }),
  ));

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
  sheet.close();
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
              localStorage.removeItem(FRIEND_KEY);
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
        writeJson(FRIEND_KEY, friend);
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
    const details = el("details", {}, el("summary", { textContent: title }), panel);
    // Sections are built on first open so the sheet appears at once.
    details.addEventListener("toggle", () => {
      if (details.open && !panel.childElementCount) panel.append(...build());
    });
    return details;
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

async function loadInsights() {
  try {
    const response = await fetch("insights.json");
    if (response.ok) insights = await response.json();
  } catch {
    // Explore stays closed; picking films still works.
  }
  openExplore.disabled = !insights;
}

async function start() {
  try {
    localStorage.removeItem(LEGACY_SEEN_KEY);
  } catch {
    // Storage is optional.
  }
  await loadInsights();

  try {
    const response = await fetch("films.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    films = await response.json();
  } catch {
    titleLine.textContent = "Couldn’t load your watchlist";
    metaLine.textContent = "Check your connection and reopen the app.";
    promptMark.hidden = true;
    openTonight.disabled = true;
    return;
  }

  if (!films.length) {
    titleLine.textContent = "No films yet";
    metaLine.textContent = "Run the import script to add your watchlist.";
    promptMark.hidden = true;
    openTonight.disabled = true;
    return;
  }

  titleLine.textContent = "Watchlist";
  metaLine.textContent = plural(films.length, "film");
  renderLens();
  refreshUpcoming();
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

start();
