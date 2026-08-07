# Impact Exchange — restyle without restructuring

Same pages, same routes, same components. This is palette + type + background + a handful of component rules. No About page required.

## Files

| File | What it is |
|---|---|
| `impact-exchange-palettes.html` | **Open this first.** Ten palettes × four background settings, switchable live on the real layout, each with its own chart palette and a worked donut. Standalone, no build step. Delete the `.sw` block before shipping. |
| `palettes.py` | The ten palettes as data, plus the WCAG checker. `python3 palettes.py` audits every UI colour pair. |
| `series_gen.py` | Solves each palette's 5 chart colours against the dataviz six checks and writes `series.json`. |
| `palette-charts.png` | All ten donuts + swatch lists side by side. |
| `palette-pages.png` | All ten full pages side by side. |
| `impact-exchange-mockup.html` | The earlier single-palette version, kept for reference. |
| `contours-a.svg` | Abstract topographic line drawing. 36 KB, vector, scales to any viewport. |
| `contours-b.svg` | Alternate, calmer, more directional. Swap in if A is too busy. |
| `watercolor.svg` | Watercolour washes. Pure SVG filters — no raster, no image request, ~2 KB. |

The mockup has both SVGs inlined as data URIs, so it's a single file. In production, serve them from `/static/` and reference by URL instead.

## The background, in about 20 lines

Two fixed layers behind everything. They don't scroll, don't affect layout, and can't intercept clicks:

```css
body::before, body::after{
  content:""; position:fixed; inset:0; z-index:-2; pointer-events:none;
  background:center/cover no-repeat;
}
body::before{ background-image:url(/static/watercolor.svg); opacity:.50; }
body::after { background-image:url(/static/contours-a.svg); opacity:.15;
  /* keep the busiest part of the pattern in the margins, not under the numbers */
  mask-image:radial-gradient(ellipse 62% 55% at 50% 45%, transparent 35%, #000 100%);
}
```

Then the rule that actually makes it work:

```css
.panel, .card{
  background:rgba(251,247,240,.90);
  backdrop-filter:blur(3px);
  border:1px solid var(--rule); border-radius:4px;
}
```

**Content sits on its own sheet of paper.** The background lives in the margins and gutters and shows faintly through the panels; it never sits directly behind a number. This is the whole trick — decorative backgrounds fail on data-dense pages when people skip this step and end up with 3% contrast loss on every table cell.

Tuning: `.15` / `.50` is the "you notice it on the second look" setting. Push contours to `.22` and drop the wash to `0` for something crisper (that's the *Contours only* variant); the reverse is softer and more Lightcone-ish. Above about `.30` on the contours the page starts to feel like stationery.

### If you want a different pattern

`gen_contours.py` regenerates the line drawing — change `seed` for an entirely different landscape, `nlev` for line density. The watercolour is hand-editable SVG: the five `<ellipse>` elements are the blooms, `baseFrequency` on the `feTurbulence` filters controls how ragged the bleeding edges are, and `scale` on `feDisplacementMap` controls how far the pigment spreads. The `#grain` filter at the bottom is the paper tooth — that's what stops it looking like a CSS gradient.

## No red and green

The market UI carries no bid/ask colour pair at all. Direction is encoded three
other ways, all of which were already there:

* **Position** — asks sit above the last-price divider, bids below it.
* **Column** — bid quantities left of the price, ask quantities right.
* **Glyph** — ▲ / ▼ on the percentage changes, in `--ink-muted`, not in colour.

Depth bars are a single `--depth` tint (the accent at 11%) on both sides, so the
book reads as one texture rather than a scoreboard. The Buy/Sell segmented control
underlines the active tab in the accent regardless of side. `Buy` and `Sell` in the
open-orders table are plain muted ink.

The cost is real and worth naming: a trader scanning a live book benefits from the
colour pair, and this removes it. For a demo whose job is to explain an idea to
funders, reading as *calm and considered* beats reading as *fast*.

## Palettes

Open `impact-exchange-palettes.html` and use the switcher. Each palette restyles
the backgrounds and the chart colours too, so you are comparing whole systems.

| | Direction | Character |
|---|---|---|
| 1 | **Terracotta & Teal** | Warm, editorial, closest to Lightcone Commons. |
| 2 | **Ink & Cinnabar** | Cool grey paper, near-black text, grey contour lines. The austere end; the background nearly disappears. |
| 3 | **Oxblood & Sage** | Bookish and antique. Reads like a well-set hardback. |
| 4 | **Prussian & Ochre** | Cool and institutional. A research desk rather than a startup. |
| 5 | **Marigold & Ultramarine** | The bright one. Nearest the surplus.dev register. |
| 6 | **Slate & Apricot** | Cool grey-blue with one warm accent. Quiet and modern. |
| 7 | **Aubergine & Straw** | Deep purple on warm straw. The most unusual, and the most memorable. |
| 8 | **Moss & Clay** | Earthy and horticultural — green accent, clay secondary, oat paper. |
| 9 | **Petrol & Sand** | Deep sea-green on sand. Calm, and the least like anything else here. |
| 10 | **Ember on Char** | Dark mode. Washes switch to `screen` blending. |

`python3 palettes.py` audits all ten against WCAG AA on nine UI pairs each — body
text, muted text, accent links, accent-on-panel, input text, button labels, and
control borders at the 3:1 non-text threshold:

```
$ python3 palettes.py
All 10 palettes pass WCAG AA on every checked UI pair.
```

Five needed a border or accent darkened by a few points to clear threshold. Keep
the script and re-run it if you nudge anything — border contrast is the check
everyone ships broken, because it looks fine on the screen you designed it on.

## Chart colours

Each palette carries five extra hues for charts, listed with their hex codes in the
**Palette** panel of the mockup and demonstrated on the **Portfolio composition**
donut beside it.

These were **solved, not picked**. `series_gen.py` takes five hue anchors chosen to
sit in the accent's family, then searches lightness and chroma until the set clears
five checks against *that palette's own paper*:

| Check | Threshold |
|---|---|
| Lightness band | OKLCH L 0.43–0.77 light, 0.48–0.67 dark |
| Chroma floor | C ≥ 0.10 — below this a hue reads as grey and stops doing identity work |
| Colour-blind separation | ΔE ≥ 8 on touching pairs under simulated protanopia and deuteranopia |
| Normal-vision floor | ΔE ≥ 15 on the same pairs unsimulated |
| Contrast vs paper | ≥ 3:1 |

Two details worth knowing. A donut **wraps** — the last segment touches the first —
so the wrap-around pair is in the pairlist, which a stock adjacent-pairs check would
miss. And the search runs tightest-first: a narrow lightness window and a low chroma
ceiling keep the five hues reading as one family, and it only loosens when a tier
can't satisfy the checks. All ten solved in the tightest tier, so nothing is more
saturated than it had to be.

Two changes that fell out of the checks rather than from taste:

* The donut's percentage labels sit **outside** the ring in ink, with short leader
  lines. Inside-the-arc labels would be paper-on-series, and the series colours are
  solved to about 3:1 against paper — fine for a mark, short of the 4.5:1 that small
  text needs.
* Segments are separated by a 2px ring in the paper colour, so touching fills never
  share an edge.

If you change a palette, re-run `python3 series_gen.py` — it rewrites `series.json`,
and `build_explorer.py` picks it up. Don't hand-edit the series hexes; the whole
point is that they're derived.

## Component changes worth making

**Depth bars in the order book.** Absolutely-positioned tinted spans behind each row, width proportional to size, bids anchored right and asks anchored left so they mirror around the price column. One tint for both sides (see *No red and green* above). ~8 lines of CSS, and it turns a column of numbers into a picture of the market. Highest value-per-line change on the page.

**Side-by-side layout.** `grid-template-columns: 1fr 316px` puts the order book and the order form next to each other instead of stacked. The current top-to-bottom run of tables is most of why it reads as a spreadsheet.

**Table discipline.** Header rows in `--paper-alt`, 11.5px uppercase with `.07em` letter-spacing, `--ink-muted`. Body rows 34px tall, hairline separators, numbers right-aligned. Zebra-stripe the trade history and leaderboard; don't stripe the order book — the stripes fight the depth reading.

**No shadows, radii ≤ 4px.** Panels are separated by a hairline and whitespace. Elevation would fight the paper metaphor.

**Demo strip.** The thin bar at the top saying prices come from public funding histories rather than real trades. Being loud about that is a credibility feature, not a caveat.

**Market cards.** The three cards across the top give the page somewhere to *start* — currently it opens cold on the leaderboard. Sparklines from the actual price history; they're the honest version of "add an image."

## Order of work

1. Drop in the tokens and the two fonts. Restyle globally. *Biggest delta per line.*
2. Table + form component rules.
3. Background layers + the `.panel` paper rule.
4. Depth bars and the side-by-side grid.
5. Market cards with sparklines.
6. Charts, using the `--s1`…`--s5` tokens.

Steps 1–2 alone get you most of the way; the background is what makes it feel deliberate rather than merely tidy.
