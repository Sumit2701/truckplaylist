# truckplaylist · endless drive

An infinite, driver's-POV highway and playlist that start the moment you open
the page. A docked, music-app-style player bar gives you previous / next / pause,
a scrubber to seek, and a volume slider — so you can drive the mix your way while
the road scrolls under a living day/night sky.

## Run

```bash
npm start        # -> http://localhost:5173
```

Audio starts automatically on load (no click needed). If a browser blocks
autoplay, a "tap anywhere" hint appears — one tap starts it. After that it plays
forever with a screen wake-lock so it won't sleep.

## Music source

### YouTube (default — zero setup)
Plays the playlist in `config.js -> youtube.playlistId` (any public YouTube /
YouTube Music playlist id) on loop. Nothing to configure.

### Spotify (Web Playback SDK + PKCE)
1. Create a free app at <https://developer.spotify.com/dashboard>.
2. Copy the **Client ID** into `config.js -> spotify.clientId`.
3. Add your exact URL — `http://localhost:5173` — to the app's **Redirect URIs**.
4. Set `config.js -> provider: 'spotify'`, pick a playlist in
   `spotify.playlistUri` (e.g. `spotify:playlist:...`), then reload once.

The first load will bounce you through Spotify's login and return. It needs a
**Spotify Premium** account and a device/background playback session.

> The Web Playback SDK can't start audio until you're on a real
> `http://localhost` origin, which is why the server exists (no `file://`).

## Tune the drive with a URL

`?time=17` (hour to start at), `?time=now` (current hour), `?speed=5200`,
`?daylength=1200` (seconds per day/night cycle), `?provider=spotify|youtube`.

The clock is the drive: `?time=6` is sunrise, `12` is midday, `18` is dusk.
Set `config.js -> scene.dashboard: false` to lose the dash silhouette and get a
clean full-screen road.

## Structure

- `server.js` — zero-dependency static server (MIME + path safety).
- `config.js` — provider, playlist, and drive/scene settings.
- `src/main.js` — bootstrap + autostart + wake lock + player bar wiring / media session.
- `src/scene/scene.js` — infinite pseudo-3D road, sky, trees, lamps.
- `src/audio/player.js` — YouTube & Spotify sources + transport (play/pause, prev/next, seek).
- `src/lib/util.js` — math/colour helpers.
- `index.html` / `style.css` — UI shell, HUD and docked player bar.
