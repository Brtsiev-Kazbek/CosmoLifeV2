# CosmoLife

An open-world space sim in the Elite tradition: an infinite procedural galaxy, a
supply-and-demand economy, faction warfare, contracts, colonisation, and seamless landing
on planets where you leave the ship, walk through a town and go inside a building. One
continuous world — there is no loading screen between orbit and pavement.

## The one principle

**There are no assets.** Every ship, town, building, planet, star, sound and colour is
generated at runtime from an integer seed. The whole project is source code: no `.glb`,
no `.png`, no `.mp3`, no `assets/` directory. One seed gives one galaxy on any machine,
in any run.

## Running it

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # simulation tests, no renderer needed
npm run typecheck
```

## Layout

| path | what lives there |
|---|---|
| `src/lib/` | PRNG, noise, vector maths, fixed-step loop, serialisation |
| `src/render/` | the only code that knows three.js exists |
| `src/procgen/` | galaxy, systems, terrain, settlements, ships — pure generators |
| `src/sim/` | economy, flight, routing, factions — pure logic, no rendering |
| `src/states/` | screens: flight, maps, port, on-foot |
| `src/ui/` | lit components for HUD and screens |
| `src/workers/` | terrain and settlement building, off the frame |
| `tests/vitest/` | simulation and generation, headless |
| `tests/playwright/` | scripted run through every screen, with screenshots |

## The rules the code is held to

1. **No `Math.random`.** Only the seeded MRG32k3a in `src/lib/rng.ts`. Every procedural
   thing gets a *derived* stream — `rng.derive("settlement", i)` — never a shared counter,
   so adding one entity cannot shift everything generated after it.
2. **Determinism over convenience.** No `for...in`, no sort without an explicit id
   tie-break, no iteration over a collection whose order came from a hash.
3. **No wall clock in the simulation.** Fixed step only; one game day is 300 real seconds.
4. **Honest flat shading.** Vertices are split per triangle, the normal comes from the
   triangle, the facet colour lives in the vertex colour. Never `flatShading: true` over
   smoothed geometry.
5. **One boundary with the renderer.** Generators return typed arrays; converting them to
   a `BufferGeometry` happens in exactly one place. That is what lets generation run in a
   Worker and be tested without a browser.
6. **Pure logic in its own modules** — approach, lead, HUD mode, market valuation, course
   plotting, production, freight — all covered by headless tests.
7. **Zero allocation per frame** on hot paths.
8. **100% localisation**, including strings that live in data tables.

Rules 1, 2, 3 and 5 are enforced by watchdog tests in `tests/vitest/guards.test.ts`, not
by good intentions.
