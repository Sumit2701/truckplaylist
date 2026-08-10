// truckplaylist — bootstrap. Tiny, zero-dependency, no controls.
import { CONFIG } from '../config.js';
import { Scene } from './scene/scene.js';
import { initPlayer, startMusic, setVolume } from './audio/player.js';

// --- apply URL overrides so a link can tune the drive ------------------------
function applyOverrides() {
  const q = new URLSearchParams(location.search);
  if (q.has('speed')) CONFIG.scene.speed = Number(q.get('speed'));
  if (q.has('daylength')) CONFIG.scene.dayLength = Number(q.get('daylength'));
  if (q.has('time')) {
    const v = q.get('time');
    CONFIG.scene.startPhase = v === 'now' ? (new Date().getHours() / 24) : (Number(v) / 24);
  }
  if (q.has('provider')) CONFIG.provider = q.get('provider');
  if (q.has('badge')) CONFIG.scene.provider = q.get('badge');
}

applyOverrides();

const canvas = document.getElementById('scene');
const curtain = document.getElementById('curtain');
const startBtn = document.getElementById('start');
const hud = {
  root: document.getElementById('hud'),
  track: document.getElementById('hud-track'),
  sub: document.getElementById('hud-sub'),
  clock: document.getElementById('hud-clock'),
};
const err = document.getElementById('error');

const scene = new Scene(canvas, hud);

function showError(msg) {
  err.textContent = msg;
  err.classList.remove('hidden');
}

// --- music -------------------------------------------------------------------
const player = initPlayer({
  ready: () => {},
  meta: (m) => scene.setNowPlaying(m),
  error: (m) => showError(m),
});

let wakeLock = null;
async function acquireWakeLock() {
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch { /* not supported / denied — fine */ }
}

let started = false;
async function begin() {
  if (started) return;
  started = true;
  document.body.classList.add('running');
  setTimeout(() => scene.showHud(), 1200);
  await startMusic();
  await acquireWakeLock();
  setVolume(1); // set volume after player ready
}

startBtn.addEventListener('click', begin);
window.addEventListener('click', () => { if (started && player?.resume) player.resume(); });

// Keep wake lock alive if the tab stays visible.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && started) acquireWakeLock();
});

scene.startRequest = begin;
