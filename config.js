// ---------------------------------------------------------------------------
// truckplaylist — configuration
//
// Everything here can also be overridden with URL params, e.g.
//   ?playlist=PL...          ?provider=spotify        ?speed=4200
//   ?daylength=600           ?time=now                ?quality=low
// ---------------------------------------------------------------------------

export const CONFIG = {
  // 'youtube'  — works with zero setup, no login, no API key.
  // 'spotify'  — needs a Spotify Premium account + a one-time login (see README).
  provider: 'youtube',

  youtube: {
    // Any public YouTube / YouTube Music playlist id (the `list=` part of the URL).
    // Default: "Lofi Fruits — lofi hip hop beats to study, relax & sleep to".
    playlistId: 'PLMRKdK25AuPVjHl9Kdb-gkBy0Cm7Zi2xo', // 90s Bollywood hits
    shuffle: true,
    volume: 55, // 0-100
  },

  spotify: {
    clientId: '', // from developer.spotify.com/dashboard — required for provider:'spotify'
    playlistUri: 'spotify:playlist:37i9dQZF1DX3Ogo9pFvBkY', // Ambient Chill
    // Must be registered verbatim in your Spotify app's Redirect URIs.
    redirectUri: location.origin + location.pathname,
    shuffle: true,
    volume: 0.55, // 0-1
  },

  scene: {
    speed: 5200,       // world units per second. ~26 road segments/sec.
    dayLength: 1200,   // seconds for one full day -> night -> day cycle
    startPhase: 0.30,  // 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.78 = sunset
    quality: 'auto',   // 'auto' | 'low' | 'medium' | 'high'
    cabin: true,       // draw the Indian truck cab: dash, jhalar, garland, wheel
    showNowPlaying: true,
    hideCursor: true,
    keepAwake: true,   // hold a screen wake lock so the display doesn't sleep
  },
};
