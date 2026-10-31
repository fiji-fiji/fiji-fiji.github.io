// Reads a poster's main colours so the background can take them on. Posters can be
// any brightness, so colours are capped: text stays readable on even a white poster.

const PALETTE_WIDTH = 24;
const PALETTE_HEIGHT = 36;
const PALETTE_SIZE = 4;
const HUE_BINS = 18;
const MIN_HUE_GAP_BINS = 2;
const NEUTRAL_CHROMA = 0.07;
const CHROMA_WEIGHT = 3;
// A colour counts once it covers this share of the poster. Below that, it's probably
// noise, and the poster really is black and white.
const MIN_COLOR_SHARE = 0.02;
const SATURATION_BOOST = 1.15;

// The most each colour may reflect, as WCAG relative luminance.
const LUMINANCE_VIVID = 0.16;
const LUMINANCE_BASE = 0.05;
const LUMINANCE_GLASS = 0.02;
const LUMINANCE_DEEP = 0.012;

function channelLuminance(value) {
  const unit = value / 255;
  return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
}

function luminance([red, green, blue]) {
  return 0.2126 * channelLuminance(red) + 0.7152 * channelLuminance(green) + 0.0722 * channelLuminance(blue);
}

// Darkening keeps the hue. Rounds down, so the result can't creep back over the limit.
function limitLuminance(color, limit) {
  if (luminance(color) <= limit) return color.map(Math.floor);
  let low = 0;
  let high = 1;
  for (let step = 0; step < 12; step += 1) {
    const factor = (low + high) / 2;
    if (luminance(color.map((channel) => channel * factor)) > limit) high = factor;
    else low = factor;
  }
  return color.map((channel) => Math.floor(channel * low));
}

function boostSaturation(color) {
  const grey = (color[0] + color[1] + color[2]) / 3;
  return color.map((channel) => Math.min(255, Math.max(0, grey + (channel - grey) * SATURATION_BOOST)));
}

function hueBin(red, green, blue, max, chroma) {
  let hue;
  if (max === red) hue = ((green - blue) / chroma + 6) % 6;
  else if (max === green) hue = (blue - red) / chroma + 2;
  else hue = (red - green) / chroma + 4;
  return Math.floor((hue / 6) * HUE_BINS) % HUE_BINS;
}

function rankColors(pixels) {
  const bins = Array.from({ length: HUE_BINS + 1 }, (_, index) => ({ index, pixels: 0, weight: 0, red: 0, green: 0, blue: 0 }));
  const neutral = bins[HUE_BINS];
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const red = pixels[offset];
    const green = pixels[offset + 1];
    const blue = pixels[offset + 2];
    const max = Math.max(red, green, blue);
    const chroma = max - Math.min(red, green, blue);
    const isNeutral = chroma / 255 < NEUTRAL_CHROMA;
    const bin = isNeutral ? neutral : bins[hueBin(red, green, blue, max, chroma)];
    const weight = isNeutral ? 1 : 1 + (chroma / 255) * CHROMA_WEIGHT;
    bin.pixels += 1;
    bin.weight += weight;
    bin.red += red * weight;
    bin.green += green * weight;
    bin.blue += blue * weight;
  }

  // Real colours always come first, so dark posters don't all end up with a grey background.
  const total = pixels.length / 4;
  const colored = bins
    .filter((bin) => bin !== neutral && bin.pixels >= total * MIN_COLOR_SHARE)
    .sort((a, b) => b.weight - a.weight);
  const chosen = [];
  for (const bin of colored) {
    const clash = chosen.some((other) => {
      const gap = Math.abs(other.index - bin.index);
      return Math.min(gap, HUE_BINS - gap) < MIN_HUE_GAP_BINS;
    });
    if (!clash) chosen.push(bin);
    if (chosen.length === PALETTE_SIZE) break;
  }
  if (!chosen.length && neutral.pixels) chosen.push(neutral);
  return chosen.map((bin) => [bin.red / bin.weight, bin.green / bin.weight, bin.blue / bin.weight]);
}

function paletteFromColors(colors) {
  const ranked = colors.length ? colors : [[20, 20, 20]];
  const main = ranked[0];
  const vivid = [];
  for (let index = 0; index < PALETTE_SIZE; index += 1) {
    vivid.push(limitLuminance(boostSaturation(ranked[index % ranked.length]), LUMINANCE_VIVID));
  }
  return {
    vivid,
    base: limitLuminance(main, LUMINANCE_BASE),
    glass: limitLuminance(main, LUMINANCE_GLASS),
    deep: limitLuminance(main, LUMINANCE_DEEP),
  };
}

const paletteCanvas = document.createElement("canvas");
paletteCanvas.width = PALETTE_WIDTH;
paletteCanvas.height = PALETTE_HEIGHT;
const paletteContext = paletteCanvas.getContext("2d", { willReadFrequently: true });
const paletteCache = new Map();

function posterPalette(image) {
  const key = image.currentSrc || image.src;
  if (paletteCache.has(key)) return paletteCache.get(key);
  paletteContext.drawImage(image, 0, 0, PALETTE_WIDTH, PALETTE_HEIGHT);
  const { data } = paletteContext.getImageData(0, 0, PALETTE_WIDTH, PALETTE_HEIGHT);
  const palette = paletteFromColors(rankColors(data));
  paletteCache.set(key, palette);
  return palette;
}
