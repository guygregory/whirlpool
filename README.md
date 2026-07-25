# Whirlpool

A tiny full-screen water toy for phones. Hold the two buttons to squirt water in
opposing directions; hold both and the water spins up into a whirlpool.

- 2D top-down fluid: a coarse velocity grid (forces → viscosity → vorticity
  confinement → pressure projection → semi-Lagrangian advection) drives ~2400
  particles that make the flow visible.
- Multi-touch: both jets can be held at once, and you can also stir the water
  with a finger anywhere on screen.
- Gyroscope (optional extra): on iOS, tap **Tilt** once to allow motion access,
  then tilting the phone gently nudges the water. It is a garnish, not the
  main event.
- No build step, no dependencies — just `index.html`, `style.css`, `app.js`.

Designed for an iPhone 16 Pro held in portrait, with safe-area insets respected.

## Run locally

```
python3 -m http.server 8000
```

then open <http://localhost:8000> (motion access needs HTTPS or localhost).

## Publish to GitHub Pages

Repository **Settings → Pages → Build and deployment → Deploy from a branch**,
pick the default branch and the `/ (root)` folder. The site is served straight
from these files.
