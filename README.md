# Whirlpool

A tiny full-screen water toy for phones. Hold the two buttons to squirt water in
opposing directions; hold both and the water spins up into a whirlpool.

- The two jets sit in lanes just inside the walls that run along the long edge
  of the screen, each firing along its wall and starting upstream so the stream
  gets a whole side and corner of runway. They are placed point-symmetrically
  about the centre, so together they form a pure couple and the entire basin
  turns as one vortex rather than breaking into counter-rotating eddies.
- 2D top-down fluid: a coarse velocity grid (forces → viscosity → vorticity
  confinement → pressure projection → semi-Lagrangian advection) drives ~2400
  particles that make the flow visible. A density pass quietly recycles a few
  particles per frame from crowded streams into the areas the flow has emptied,
  so the whole screen stays evenly sprinkled and the swirl reads clearly.
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
