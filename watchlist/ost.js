// Plays a film's soundtrack: Apple's preview of each track in album order, faded in and out.
// iOS ignores audio.volume, so the fades go through Web Audio. If that isn't available
// the music still plays, just without them.

const OST_FADE_IN = 1.4;
const OST_FADE_OUT = 1.2;
const OST_TRACK_FADE = 1.0;
const OST_GAIN_FLOOR = 0.0001;

function createOstPlayer(onChange) {
  const audio = new Audio();
  // Needed for Web Audio to hear the file. Without it the output would be silent.
  audio.crossOrigin = "anonymous";
  audio.preload = "auto";

  let context = null;
  let gain = null;
  let entry = null;
  let index = 0;
  let stopTimer = null;
  let failures = 0;
  let trackFading = false;
  let attempt = 0;
  let lastFailedAttempt = 0;

  function setUpAudioGraph() {
    if (context) return;
    try {
      // Without this, iOS would silence Web Audio when the ringer switch is off.
      if (navigator.audioSession) navigator.audioSession.type = "playback";
      const Context = window.AudioContext || window.webkitAudioContext;
      context = new Context();
      gain = context.createGain();
      gain.gain.value = OST_GAIN_FLOOR;
      context.createMediaElementSource(audio).connect(gain);
      gain.connect(context.destination);
    } catch {
      context = null;
      gain = null;
    }
  }

  function ramp(target, seconds) {
    if (!gain) return;
    const now = context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(Math.max(gain.gain.value, OST_GAIN_FLOOR), now);
    gain.gain.exponentialRampToValueAtTime(Math.max(target, OST_GAIN_FLOOR), now + seconds);
  }

  function setMediaSession(track) {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.name,
      artist: entry.artist,
      album: entry.album,
    });
  }

  function playTrack(fadeSeconds) {
    const track = entry.tracks[index];
    trackFading = false;
    audio.src = track.preview;
    setMediaSession(track);
    ramp(1, fadeSeconds);
    onChange();
    attempt += 1;
    const thisAttempt = attempt;
    audio.play().catch((error) => {
      // Changing track interrupts the previous play(), which isn't a failure.
      if (error.name !== "AbortError") handleFailure(thisAttempt);
    });
  }

  function next() {
    index = (index + 1) % entry.tracks.length;
    playTrack(OST_TRACK_FADE);
  }

  // A bad file reports twice, through play() and an error event, but is only one failure.
  function handleFailure(failedAttempt) {
    if (!entry || failedAttempt !== attempt || failedAttempt === lastFailedAttempt) return;
    lastFailedAttempt = failedAttempt;
    failures += 1;
    if (failures >= entry.tracks.length) {
      stop();
      return;
    }
    next();
  }

  audio.addEventListener("playing", () => {
    failures = 0;
  });
  audio.addEventListener("ended", () => {
    if (entry) next();
  });
  audio.addEventListener("error", () => {
    if (entry && audio.getAttribute("src")) handleFailure(attempt);
  });
  // Each preview is short, so dip between tracks rather than cutting.
  audio.addEventListener("timeupdate", () => {
    if (entry && !trackFading && audio.duration - audio.currentTime < OST_TRACK_FADE) {
      trackFading = true;
      ramp(0, OST_TRACK_FADE);
    }
  });

  // Must be called from a tap, or iOS won't allow the sound.
  function play(newEntry) {
    clearTimeout(stopTimer);
    setUpAudioGraph();
    if (context && context.state === "suspended") context.resume();
    entry = newEntry;
    index = 0;
    failures = 0;
    playTrack(OST_FADE_IN);
  }

  function stop() {
    if (!entry) return;
    entry = null;
    onChange();
    const finish = () => {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    };
    if (gain) {
      ramp(0, OST_FADE_OUT);
      stopTimer = setTimeout(finish, OST_FADE_OUT * 1000);
    } else {
      finish();
    }
  }

  return {
    play,
    stop,
    current: () => entry,
    trackName: () => (entry ? entry.tracks[index].name : null),
  };
}
