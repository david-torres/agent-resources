# ENCLAVE — Aspirant V1: measured page geometry

Source PDF: `/home/dave/Documents/Enclave/ENCLAVE___Aspirant_V1.pdf`
172 pages, 612 x 792 pt, Affinity 3.2.3 / PDFlib, tagged.

**Every number below came from a command that was run.** Method: one
whole-book extraction with

```
pdftotext -bbox-layout ENCLAVE___Aspirant_V1.pdf aspirant-bbox-full.xhtml   # 10.3 MB
pdftotext -layout     ENCLAVE___Aspirant_V1.pdf book-layout.txt             # 172 \f-separated pages
```

parsed by `bbox.py` (in this scratchpad) into `pages.pkl`: a list of 172 pages,
each a list of `block {xMin,xMax,yMin,yMax, lines[]}`, each line a list of
`word {xMin,yMin,xMax,yMax,t}`. All coordinates are poppler's top-left origin
(yMin = distance down from the top of the page).

Preserved artifacts in this scratchpad:

| file | what |
|---|---|
| `aspirant-bbox-full.xhtml` | whole-book `-bbox-layout` dump |
| `book-layout.txt` | whole-book `-layout` dump |
| `bbox.py` | the parser used for every measurement here |
| `pages.pkl`, `layout_pages.pkl` | parsed forms |
| `aspirant-p18-bbox.xhtml` … `aspirant-p23-bbox.xhtml` | one full Gunslinger block, per-page |
| `aspirant-signature-entry-words.txt` | three complete signature entries, word-by-word with bboxes |

---

## 1. The page cadence, confirmed empirically

**Confirmed. The twelve class blocks start at PDF pages 18, 24, 30, 36, 42, 48,
54, 60, 66, 72, 78, 84** — a strict stride of 6, contiguous, no interstitials.

| # | class | PDF first page | printed page (from footer) |
|---|---|---|---|
| 1 | Gunslinger | 18 | 13 |
| 2 | Illusionist | 24 | 19 |
| 3 | Librarian | 30 | 25 |
| 4 | Thane | 36 | 31 |
| 5 | Thunderbird | 42 | 37 |
| 6 | Wanderer | 48 | 43 |
| 7 | Berserker | 54 | 49 |
| 8 | Freerunner | 60 | 55 |
| 9 | Infiltrator | 66 | 61 |
| 10 | Samaritan | 72 | 67 |
| 11 | Vessel | 78 | 73 |
| 12 | Witchfinder | 84 | 79 |

The printed page number is literally present as a text block on every page of
the block, at `y = 764.84–783.11`, line height 18.27 (72 such blocks across the
12 class blocks = 12 x 6). It is at `xMin = 292.82` on even PDF pages and
`xMin = 304.82` on odd. So PDF page = printed page + 5 is confirmed against the
real footer, not assumed.

### The cover-page detector: both proposed markers are individually exact

Tested against all 172 pages.

**Marker A — centred stat line.** A block with exactly one line, line height
`24.00 ± 0.5`, `yMin < 120`, text matching `^\+{1,3}Stat(,\s*\+{1,3}Stat)*$`
after whitespace removal, and horizontal centre `|(xMin+xMax)/2 − 300.24| < 1.0`.

Matches: `[18, 24, 30, 36, 42, 48, 54, 60, 66, 72, 78, 84]` — **12 hits, 0 false
positives, 0 false negatives.**

All twelve stat lines are at `yMin = 76.73, yMax = 100.73` and are centred on
`x = 300.24` to the hundredth (e.g. p18 `202.49–397.99`, p72 `193.44–407.04`,
p78 `217.14–383.34`).

**Marker B — `Challenge Level:`.** Any line starting `Challenge Level:` with
`yMin > 700`.

Matches: `[18, 24, 30, 36, 42, 48, 54, 60, 66, 72, 78, 84]` — **12 hits, 0 FP,
0 FN.** Observed y: `710.2` (p30, p42, p48) or `722.2/722.7` (the other nine).
The x spread is `95.39–335.00` (High) / `99.32–331.06` (Low) / `101.51–328.89`
(Mid) — i.e. it is a centred line too, centre `215.19` on even pages.

**Conjunction (A AND B): 12/12, 0 FP, 0 FN.** Either one alone would do; use
both for belt-and-braces.

**Caution — a looser stat-line regex does produce a false positive.** Matching
`^\+{1,3}\s*[A-Z][a-z]+` against the first line of any block, with no geometry
constraint, additionally hits **page 96**. The 24.00-pt height + centre-on-300.24
constraints are what make it exact.

---

## 2. The class name source

**The cover page (offset +0) carries no class-name text.** Page 18's complete
text inventory is: the stat line, the quote, the attribution, three prose
paragraphs, the Examples heading + list, "Quick Tips" + three tips,
"Challenge Level: Low", and the page number. The word "Gunslinger" does appear
on page 18, but only inside a Quick Tip sentence ("Stuck on which Stats to give
your Gunslinger besides Skill and Sensory?") — it is prose, not a title. The
display name on the cover is outlined vector art, as stated.

**The running header carries the name.** It appears on offsets **+1, +2, +4, +5**
and is **absent on +0 and +3**, for all twelve classes without exception.

**Band: `yMin = 23.23`, `yMax = 38.86`, line height 15.63 — identical on all 48
header pages.** No other text on any class page occupies `yMin < 40` except the
occasional signature item name that overflows the top of a column (see §11).

The header text is exactly the class name, one block, one line, no decoration:

```xml
<block xMin="271.370000" yMin="23.230000" xMax="352.140000" yMax="38.860000">
  <line xMin="271.370000" yMin="23.230000" xMax="352.140000" yMax="38.860000">
    <word xMin="271.370000" yMin="23.230000" xMax="352.140000" yMax="38.860000">Gunslinger</word>
```

It is **identical in text on every page of a class block that has it**, but its
`xMin` differs by parity because it is centred and the page centre shifts (§3):

| class | odd-page header x | even-page header x | delta |
|---|---|---|---|
| Gunslinger | 271.37–352.14 | 259.85–340.62 | 11.52 |
| Illusionist | 276.00–347.52 | 264.48–336.00 | 11.52 |
| Librarian | 277.66–345.86 | 266.14–334.34 | 11.52 |
| Thane | 289.69–333.83 | 278.17–322.31 | 11.52 |
| Thunderbird | 265.18–358.34 | 253.66–346.82 | 11.52 |
| Wanderer | 276.07–347.45 | 264.55–335.93 | 11.52 |
| Berserker | 277.42–346.10 | 265.90–334.58 | 11.52 |
| Freerunner | 271.44–352.08 | 259.92–340.56 | 11.52 |
| Infiltrator | 271.49–352.03 | 259.97–340.51 | 11.52 |
| Samaritan | 273.50–350.03 | 261.98–338.51 | 11.52 |
| Vessel | 291.92–331.59 | 280.40–320.07 | 11.52 |
| Witchfinder | 267.42–356.10 | 255.90–344.58 | 11.52 |

Header centres: **306.755 on odd pages, 300.235 on even pages.**

**Recommended rule for the extractor:** class name = the text of the single
block with `22.5 < yMin < 24.0` on page `start+1`. Do not look for it on the
cover or on `start+3`.

---

## 3. Recto/verso margin mirroring — MEASURED

**Claim partly confirmed, partly false. The delta is 11.52 pt for almost
everything, but the note/bullet indent on Signature pages shifts by 16.32 pt,
not 11.52.** The footer page number shifts by 12.00. So it is *not* one
constant offset.

Every structural x below is exact to the hundredth on **all** pages of that
kind, across all twelve classes (verified by taking the set of distinct line
`xMin` values on each of the 24 signature pages and 24 ability pages).

### 3a. Signature pages (offsets +2 = even/verso, +3 = odd/recto)

Measured on p20/p21 (Gunslinger), p32/p33 (Librarian), p74/p75 (Samaritan), and
confirmed identical on the other nine class pairs.

| element | even (verso) left col | odd (recto) left col | delta | even right col | odd right col | delta |
|---|---|---|---|---|---|---|
| signature description, full-width lines | **40.80** | **52.32** | 11.52 | **317.28** | **328.80** | 11.52 |
| signature name | **43.20** | **54.72** | 11.52 | **319.68** | **331.20** | 11.52 |
| **item name** (leftmost body text) / item description | **45.60** | **57.12** | 11.52 | **322.08** | **333.60** | 11.52 |
| item note, depth 1 | **64.80** | **81.12** | **16.32** | **341.28** | **357.60** | **16.32** |
| item note, depth 2 | **84.00** | **100.32** | **16.32** | **360.48** | **376.80** | **16.32** |
| "Default Enchantment" divider | **124.97** | **136.49** | 11.52 | **401.44** | **412.96** | 11.52 |
| signature description, wrapped first lines | **136.80** | **148.32** | 11.52 | **413.28** | **424.80** | 11.52 |
| column right text edge (max observed xMax) | 280.71–283.14 | 294.23–294.86 | ~11.6 | 558.45–559.56 | 571.09–571.45 | ~11.7 |

**The real per-side values, since the mirroring is not uniform:**

* Note depth-1 indent measured **from the item-name left edge**:
  `64.80 − 45.60 = 19.20` on verso, `81.12 − 57.12 = 24.00` on recto.
  Right column: `341.28 − 322.08 = 19.20` verso, `357.60 − 333.60 = 24.00` recto.
* The depth step itself is **19.20 on both sides** (`84.00−64.80 = 19.20`,
  `100.32−81.12 = 19.20`, `360.48−341.28 = 19.20`, `376.80−357.60 = 19.20`).
* So: the note text frame sits 19.2 pt inside the column on verso pages and
  24.0 pt inside on recto pages. Everything else in the entry mirrors at 11.52.

Column pitch within one page: `322.08 − 45.60 = 276.48`, and
`401.44 − 124.97 = 276.47`. Same on both parities.

### 3b. Ability pages (offsets +1 = odd/recto, +4 = even/verso)

Here **everything, including the note indents, mirrors at exactly 11.52.**
Measured p19 (odd) vs p22 (even), Gunslinger; confirmed on all 24 ability pages.

| element | even (verso) | odd (recto) | delta |
|---|---|---|---|
| ability description | 166.08 | 177.60 | 11.52 |
| `Paired Action:` label | 60.78 | 72.30 | 11.52 |
| paired-action text | 130.80 | 142.32 | 11.52 |
| note depth 1 | **84.00** | **95.52** | **11.52** |
| note depth 2 | **103.20** | **114.72** | **11.52** |
| `Sample Perks` (centred) | 277.79–322.69 (c=300.24) | 289.31–334.21 (c=311.76) | 11.52 |
| perk name (centred) | c = 96.24 | c = 107.76 | 11.52 |
| perk body | 161.28 | 172.80 | 11.52 |
| `(Compounded)` | 109.94–160.61 | 121.46–172.13 | 11.52 |
| compounded body | 181.94 | 193.46 | 11.52 |
| meter-label right edge | 499.68 / 508.88 | 511.20 | 11.52 |

Note depth step on ability pages = `103.20 − 84.00 = 19.20` (verso),
`114.72 − 95.52 = 19.20` (recto). Same 19.20 as signatures, but here the offset
from the page's own margin is the same on both sides.

### 3c. Expanded Tips (offset +5) — always odd

Offsets +1, +3, +5 are always odd PDF pages and +0, +2, +4 always even
(because every class starts on an even page). So the Tips page has **no parity
variant at all**: Player column `xMin = 72.00`, Conduit column `xMin = 348.48`,
on all twelve.

### 3d. The footer does NOT use 11.52

Page number `xMin = 292.82` (even) vs `304.82` (odd) → **delta 12.00**, with
identical glyph widths (`14.36` for a two-digit number on both). This is a
genuine 0.48 pt divergence from the body-column shift. Do not derive parity from
the footer.

---

## 4. Signature page two-column partition

Each Signature page carries **two columns of three entries each**, so the
+2/+3 spread is 4 columns x 3 = **12 signature entries per class**. That matches
the 144 "Default Enchantment" occurrences on class pages (12 x 12).

### Column x-bands

Split point: `x = 306` cleanly separates them (no line crosses it).

| page | parity | left column (min xMin .. max xMax) | right column (min xMin .. max xMax) |
|---|---|---|---|
| 20 | even | 40.80 .. 283.14 | 317.28 .. 558.45 |
| 21 | odd | 52.32 .. 294.23 | 328.80 .. 571.18 |
| 26 | even | 40.80 .. 280.71 | 317.28 .. 559.39 |
| 27 | odd | 52.32 .. 294.42 | 328.80 .. 571.11 |
| 32 | even | 40.80 .. 281.97 | 317.28 .. 559.29 |
| 33 | odd | 52.32 .. 294.58 | 328.80 .. 571.17 |
| 38 | even | 40.80 .. 282.89 | 317.28 .. 559.34 |
| 39 | odd | 52.32 .. 294.43 | 328.80 .. 571.45 |

Gutter between the columns: verso `283.14 → 317.28` (34.1 pt),
recto `294.86 → 328.80` (33.9 pt).

### Do the columns share baselines? **No.**

Counting distinct `yMin` values on p20: 32 in the left column, 32 in the right,
only **3** coincide within ±0.6. p33: 40 left, 49 right, **1** shared. p21: 37/47,
6 shared. The only systematic coincidence is the top of the page — when both
columns start their first entry at `yMin = 117.57` — which happens on most but
not all pages. **The two columns are laid out independently; do not pair by
baseline, partition by x.**

### Entries per column: 3 and 3, on 23 of 24 pages

Detected by item-name blocks (display font, line height 19.5–20.9). All 24
signature pages give **3 left + 3 right**, with one apparent exception
(`Infiltrator p69` reports 4 left) which is an artifact of a **two-line item
name** ("Tranquilizer / Darts") being counted per line rather than per block.
Counting blocks, it is 3+3 everywhere. See §11.

### Entry boundaries: use "Default Enchantment" — verified one per entry

"Default Enchantment" appears exactly **12 times per class** for all twelve
classes (see the §11 table), i.e. exactly 6 per signature page, 3 per column,
**exactly one per signature entry**. It is a centred divider label, not prose:

* verso pages: `xMin = 124.97, xMax = 199.03` (left col), `401.44 .. 475.51` (right col)
* recto pages: `xMin = 136.49, xMax = 210.56` (left col), `412.96 .. 487.04` (right col)
* width always **74.06**, centre always the column centre (162.0 / 438.5 verso,
  173.5 / 450.0 recto)

### Real y-boundaries between the three entries in a column

Item-name `yMin` values (the top of each entry) and the `Default Enchantment`
`yMin` values (the internal divider) for two real pages:

**PDF page 20 (Gunslinger, verso, cols 1–2)**

| | left column | right column |
|---|---|---|
| entry 1 name | Cowboy Hat @ **117.57** | Sharps Rifle @ **117.57** |
| entry 1 divider | 203.16 | 188.53 |
| entry 2 name | Bandolier @ **292.55** | Coach Gun @ **286.77** |
| entry 2 divider | 378.14 | 367.33 |
| entry 3 name | Revolver @ **458.18** | Saddler @ **437.97** |
| entry 3 divider | 529.14 | 532.93 |
| last body line | 583.48 | 576.65 |

**PDF page 21 (Gunslinger, recto, cols 3–4)**

| | left column | right column |
|---|---|---|
| entry 1 name | Wild Rag @ **117.57** | Bowie Knife @ **117.57** |
| entry 1 divider | 222.13 | 202.93 |
| entry 2 name | Duster @ **303.57** | Rollups @ **293.24** |
| entry 2 divider | 414.13 | 427.80 |
| entry 3 name | Derringer @ **502.77** | Hip Flask @ **518.12** |
| entry 3 divider | 607.33 | 608.27 |
| last body line | 651.03 / 660.03 | 679.00 |

Entry tops are **not** at fixed y. Observed range of the first entry's `yMin` in
a column across all 24 pages: **40.77** (Blank Check, Samaritan p75 right column
— above the normal header band!) to **155.20** (Jackboots, Witchfinder p87 left).
So: **partition by x into two columns, then within a column split at each
item-name block.** Do not use fixed y bands.

---

## 5. Signature entry internal structure

Full word-level dumps of three real entries are in
`aspirant-signature-entry-words.txt`. Excerpt (Gunslinger / Cowboy Hat,
PDF p20, left column, entry 1):

```
LINE x=  45.600- 131.584 y= 117.568- 138.448 h=20.88  blockX=  45.600 blockLines=1
    <word xMin="45.600"  yMin="117.568" xMax="101.520" yMax="138.448">Cowboy</word>
    <word xMin="105.440" yMin="117.568" xMax="131.584" yMax="138.448">Hat</word>
LINE x=  64.800- 248.968 y= 143.493- 156.543 h=13.05  blockX=  64.800 blockLines=5
    <word xMin="64.800"  yMin="143.493" xMax="98.620"  yMax="156.543">Provides</word>
    <word xMin="107.010" yMin="143.493" xMax="130.610" yMax="156.543">Ward</word>
    <word xMin="139.538" yMin="143.493" xMax="167.128" yMax="156.543">against</word>   <-- gap 130.61 -> 139.54
LINE x= 132.038- 137.408 y= 144.362- 151.970 h= 7.61  blockX= 132.038 blockLines=1
    <word xMin="132.038" yMin="144.362" xMax="137.408" yMax="151.970">M</word>          <-- detached superscript, sits IN the gap
```

### The item name is distinguished by font size, not by x

Item name line height is **20.88** in most entries, **19.57/19.58** where the
name is long (the book auto-fits). Body text on the same page is
10.44 / 11.74 / 11.75 / 13.05 / 14.35 / 14.36. So the item name is the tallest
line in the entry and is always ≥ 18.0, while no body line exceeds 14.36. The
item **description** (when present) is at the *same* xMin as the name but at
14.35–14.36, e.g. p20 `Sharps Rifle` name 322.08 @ h=20.88, description
"Single-shot, falling block-action firearm." 322.08 @ h=14.36.

Not every item has a description (Cowboy Hat, Bandolier, Bowie Knife have none).

### Where meters live — a right-hand gutter inside the column

Meters are **label + value on one shared baseline**, at `y ≈ itemName.yMin +
10.3`, right-packed in the column. Measured extents over all 24 signature pages:

| parity | column | meter VALUE xMin range | meter VALUE xMax range |
|---|---|---|---|
| even (verso) | left | 245.86 .. 255.46 | 260.90 .. 274.72 |
| even (verso) | right | 521.14 .. 533.50 | 537.38 .. 551.09 |
| odd (recto) | left | 257.81 .. 273.81 | 272.43 .. 289.42 |
| odd (recto) | right | 534.28 .. 547.10 | 548.90 .. 559.96 |

Labels sit immediately left of the value (e.g. p20 `Ammunition` 170.66–223.20
with `Mid` 246.65–264.55 at the same `yMin = 468.47`; p21 `Uses` 493.20–511.20
with `3x` 538.29–548.90 at `yMin = 528.40`). Labels are right-ragged (they are
right-aligned as a group but wrap to two lines when long, e.g. p44
`Durability / Boost` at 203.17 then 222.12).

Meters are **optional** — Cowboy Hat, Bandolier, Wild Rag, Duster have none.
Observed labels: Ammunition, Quantity, Uses, Damage, Range, Projectile Speed,
Durability Boost, Endurance Boost. Values: Low / Mid / High / High+ / Nx.

### Where "Default Enchantment" sits

Dead centre of the column, between the item's notes (above) and the signature
(below). Fixed x per parity+column (see §4). It is its own single-line block.
It is a *divider*, not a heading of a list: exactly one per entry.

### "In Honor of" dedications DO appear in signature entries

**15 of the 53** dedications are on signature pages; the other **38** are on
ability pages. None on cover or Tips pages. Line height always **7.83** — smaller
than every body font — which is the reliable discriminator. Example, p21 right
column, Rollups entry:

```
BLOCK x= 342.87- 403.53 y= 451.78- 459.61
    x= 342.87- 403.53 y= 451.78- 459.61 | In Honor of Cowboy Will
```

It is interleaved *inside* the signature description's y-range (here the
description runs 441.76–480.50), and on p50 it lands literally between two
wrapped lines (`In Honor of Xela` at y=372.85, between description lines at
371.83 and 380.83). **Filter it out by height (7.83) before reflowing the
paragraph, or it will be spliced into the sentence.**

### The signature name and description SHARE baselines

This is the main reading-order trap. The signature description is a text frame
that wraps around a vector diamond; the name sits to its left on the same
line(s). p20, Cowboy Hat's signature:

```
BLOCK x=  43.20- 102.56 y= 217.11- 228.86 | Hats Off to You            <- name
BLOCK x=  40.80- 280.51 y= 217.11- 255.86                              <- description
    x= 136.80 y= 217.11 | Portray a Turning Point of newfound          <- same yMin as the name
    x= 136.80 y= 226.11 | appreciation or admiration for an ally,
    x=  40.80 y= 235.11 | culminating in a tip of this hat, to instantly share an Expertise with
    x=  40.80 y= 244.11 | them (implicit or Pitched), using whoever's Stat(s) are higher.
```

The indented first lines are always at `colLeft + 91.20` (`136.80 − 45.60`,
`148.32 − 57.12`, `413.28 − 322.08`, `424.80 − 333.60` — 91.20 in all four).
The un-indented continuation is at `colLeft − 4.80` (40.80 / 52.32 / 317.28 /
328.80). The number of indented lines varies (2 is typical), and short
descriptions step out only part-way (observed intermediate values 79.79, 88.80,
365.28) rather than going to the full width.

**Reading order for one signature entry:**

1. item name — tallest block (h ≥ 18) at `colLeft`
2. meters — label/value pairs in the right gutter at `name.yMin + ~10.3` (optional)
3. item description — `colLeft`, h 14.35/14.36 (optional)
4. item notes — `colLeft + 19.20` (verso) / `+24.00` (recto), depth 2 a further +19.20
5. `Default Enchantment` — the centred 74.06-wide divider
6. signature name — `colLeft − 2.40`, tallest remaining block, may be 2 lines
7. signature description — sort by `(yMin, xMin)` **and drop any line with
   `xMin` inside the name's x-range**, because the name shares the baseline
8. `In Honor of …` — h 7.83, anywhere in 6–7; lift it out before reflow

Within each line, detached superscript blocks (§7) must be re-inserted by
`xMin`, since they land in the word gaps of the host line.

---

## 6. Note nesting without bullets — the leading threshold

**The two leadings ARE cleanly separable. This is not ambiguous.**

### 6a. Expanded Tips (offset +5) — the page the spec expected

**The indent step is 18.72 pt, not 19.2**, and there are only **two** depth
levels.

Distinct `xMin` values across all twelve Tips pages (p23, 29, 35, 41, 47, 53,
59, 65, 71, 77, 83, 89):

```
Player  column:  72.00 (374 lines)   90.72 (64 lines)      step = 18.72
Conduit column: 348.48 (368 lines)  367.20 (89 lines)      step = 18.72
```

No third level exists (`72.00 + 2*18.72 = 109.44` never occurs).

**Leadings, measured over all twelve pages:**

| | value | count |
|---|---|---|
| wrapped continuation line (same note) | **12.00** | 606 |
| " (two jitter cases on p83, italic run) | 11.73 / 12.27 | 1 + 1 |
| **new note** (last line of note N → first line of note N+1) | **20.39** | **263 of 263** |

**Threshold: 16.00 pt.** The observed gap is 12.27 → 20.39, i.e. 8.1 pt of clear
air. There is no overlap whatsoever. Paragraph space = `20.39 − 12.00 = 8.39`.

Example, p23 Player column: note at `yMin = 132.01, 144.01, 156.01` (3 wrapped
lines, +12.00 each), next note begins at `176.40` (+20.39).

Pleasantly, pdftotext also puts **each note in its own `<block>`** on these
pages, so block boundaries already encode it — but the leading rule is what to
rely on, since the block grouping is not trustworthy elsewhere (§7).

Depth-1 example, p23 Conduit column:

```
BLOCK x= 348.48- 570.77 y= 313.19- 364.85   (depth 0)
    "Scarier for a Gunslinger than a powerful enemy is an unknown one. ..."
BLOCK x= 367.20- 548.80 y= 369.58- 397.24   (depth 1, +18.72)
    ""Keeping the number of enemies vague helps a lot with pacing." — Xela"
```

### 6b. Notes on Signature pages and Ability pages — step is 19.20

Here the step is **19.20**, and again exactly two levels.

Signature pages (24 pages), note-line `xMin` census:
`64.80 / 84.00` and `341.28 / 360.48` (verso), `81.12 / 100.32` and
`357.60 / 376.80` (recto). Level-3 positions (103.20 / 119.52 / 379.68 / 396.00)
**never occur**.

Ability pages (24 pages): `84.00 / 103.20` (verso), `95.52 / 114.72` (recto).
Level 3 (122.40 / 133.92) **never occurs**.

Leadings inside note blocks on these pages — the book uses two body sizes
(auto-fit per entry), so there are two leading pairs:

| body line height | wrapped | new note | gap |
|---|---|---|---|
| 13.05 | **10.00** | **14.33** | 4.33 |
| 11.75 | **9.00** | **13.29 / 13.30** | 4.29 |

Signature pages: wrapped 10.00 (480 pairs) / 9.00 (31); new 14.33 (152) /
13.29–13.30 (14). Ability pages: wrapped 10.00 (56) / 9.00 (57); new 14.33 (66) /
13.29–13.30 (81).

**A fixed threshold of 11.50 separates every observed pair** (max wrapped 10.00,
min new 13.29). A more robust form, since font size varies per entry:

* wrapped = `0.766 x lineHeight` exactly (10.00/13.05 = 9.00/11.75 = 0.766)
* new note = wrapped + **~4.30** (paragraph space; 4.33 and 4.29 measured)
* so: `threshold = minLeadingOnEntry + 2.0`, or `leading > 0.93 x lineHeight`.

### The important caveat

The x-indent alone is **not** sufficient — a wrapped continuation of a depth-1
child has the *same* `xMin` as the child's first line. You need the leading to
find the boundary, exactly as the spec supposed. Good news: it works.

---

## 7. Superscript detachment (Power Ratings)

### Distinct rating strings — the complete set for the whole book

622 tokens matched `^[LMH](–[LMH])?\+?$` book-wide; 621 are real superscripts
(the one rejection is the credits line "Dennis L Finch Jr" on p171, where the
`L` is at body size). 606 of the 621 are inside the class chapter (pages 18–89).

| rating | count |
|---|---|
| `M` | 221 |
| `L` | 108 |
| `H` | 106 |
| `L–H` | 61 |
| `L–M` | 60 |
| `M–H` | 32 |
| `H+` | 20 |
| `M–H+` | 7 |
| `L–H+` | 3 |
| `H–H+` | 3 |

**Ten distinct strings. No `L+`, no `M+`, no `L–M+`.**

**The dash is U+2013 EN DASH** — verified by codepoint, not by eye:

```
'L–H'   U+004C LATIN CAPITAL LETTER L  U+2013 EN DASH  U+0048 LATIN CAPITAL LETTER H
'M–H+'  U+004D ... U+2013 EN DASH ... U+0048 ... U+002B PLUS SIGN
```

It is **not** U+002D hyphen and **not** U+2014 em dash. (U+2014 does occur 384
times in the book, but only as the quote-attribution dash `— Blondie, …`.)

Note the same en dash is used in meter values (`Low–High`, `Mid–High+`).

### How they appear in the bbox output

* **601 of 622 stay inline** as an ordinary `<word>` inside the host `<line>`.
* **21 detach.** Of those, **11 become their own single-line `<block>`** and
  **10 become an extra `<line>` inside a multi-line block**. Either way they end
  up as a line whose only word is the rating.

Full list of detached instances (page, rating, bbox):

| page | rating | x | y | own block? |
|---|---|---|---|---|
| 20 | M | 132.04–137.41 | 144.36–151.97 | yes |
| 20 | M | 66.77–71.61 | 561.88–568.73 | no (5-line block) |
| 21 | H | 390.67–395.33 | 544.91–552.52 | yes |
| 21 | L–M | 383.82–395.14 | 650.04–656.89 | no (8-line block) |
| 33 | H | 415.07–419.26 | 742.66–749.51 | no |
| 44 | M | 132.04–137.41 | 144.36–151.97 | yes |
| 50 | H | 77.75–81.95 | 550.21–557.06 | no |
| 51 | L | 148.36–151.77 | 144.36–151.97 | yes |
| 57 | M | 414.75–419.58 | 742.66–749.51 | no |
| 61 | H | 281.60–285.79 | 577.80–584.64 | yes |
| 62 | M | 92.27–97.64 | 144.36–151.97 | yes |
| 63 | L–H | 131.89–142.57 | 274.66–281.51 | no |
| 63 | H+ | 361.05–368.42 | 742.06–748.91 | yes |
| 64 | H+ | 264.96–272.32 | 601.79–608.64 | yes |
| 67 | L–M | 269.61–280.88 | 244.20–251.04 | yes |
| 74 | M | 89.18–94.01 | 278.26–285.11 | no |
| 76 | L–H | 215.04–224.53 | 689.66–695.75 | yes |
| 80 | M–H | 385.20–396.25 | 293.48–299.57 | no |
| 80 | H | 436.89–441.47 | 375.14–382.75 | yes |
| 81 | L–M | 92.81–104.13 | 274.66–281.51 | no |
| 88 | M | 246.14–250.44 | 233.36–239.45 | yes |

**Detach rate: 21 / 622 = 3.4 %.** They are not confined to any one page type
(they occur on offsets +1, +2, +3, +4 — never on +0 or +5, which have no ratings).

### The identification rule — exact, from measurement

For every inline case the ratio is constant:

| rating word height | host line height | ratio | dyMax = word.yMax − line.yMax | dyMin = word.yMin − line.yMin | n |
|---|---|---|---|---|---|
| 7.61 | 13.05 | 0.583 | −4.57 | +0.87 | 238 |
| 6.85 | 11.75 | 0.583 | −4.12 | +0.78 | 221+21+1 |
| 6.09 | 10.44 | 0.583 | −3.66 | +0.70 | 60 |
| 8.37 | 14.36 | 0.583 | −5.03 | +0.96 | 38+17 |
| 9.13 | 15.66 | 0.583 | −5.49 | +1.04 | 2 |
| 7.46 | 12.79 | 0.583 | −4.48 | +0.85 | 1 |

**Rule: a word is a superscript rating iff its height is `0.583 × hostLineHeight`
(i.e. font size 58.3 % of body) and its `yMin` sits `0.067 × lineHeight` below
the line top while its `yMax` sits `0.35 × lineHeight` above the line bottom.**
Equivalently and most simply: `(word.yMax − line.yMin) / lineHeight ≈ 0.65`.

Font size, derived: body 13.05 → superscript 7.61, i.e. if body is nominally
11 pt the superscript is 6.4 pt. The 0.583 ratio is exact in every one of the
601 inline cases.

### Re-attaching the 21 detached ones

The detached word sits in the **inter-word gap of its host line**. Cowboy Hat,
p20:

```
"Ward"     xMax = 130.610
 M         132.038 – 137.408      <- the detached block
"against"  xMin = 139.538
```

So the reading order is recovered by grouping lines whose `yMin` agrees within
about **±1.5 pt** (the superscript's `yMin` is `host.yMin + 0.70..1.04`), then
sorting the merged word list by `xMin`.

Two of the detached cases are harder: pdftotext splits the *host* line in two
around the gap. p21 y≈649.3:

```
x= 328.80- 382.54 | Happenstance
x= 383.82- 395.14 | L–M                <- superscript, in the gap
x= 397.06- 528.06 | and Galvanize L–M non-allies towards
```

which reflows to `… Happenstance^L–M and Galvanize^L–M non-allies towards …`.
Same `(yMin ±1.5, then sort by xMin)` rule handles it.

---

## 8. Ability page structure (offsets +1 and +4)

Three ability entries per page, six per class. Structure of one entry
(Gunslinger / Trickshot, PDF p19, recto):

| part | bbox | notes |
|---|---|---|
| meter labels | `460.53–511.20`, `y 110.76–138.21` | right-aligned to `xMax = 511.20` (recto) / `499.68` or `508.88` (verso); one line per meter |
| meter values | `534.28–552.91`, same y-band | shares each label's baseline |
| **ability name** | `74.37–141.15`, `y 114.87–135.75`, h **20.88** | centred at `x = 107.76` (recto) / `96.24` (verso) |
| ability description | `177.60–407.94`, `y 112.03–137.38`, h 14.36 | starts at the same y as the name, to its right |
| `Paired Action:` label | `72.30–127.92`, `y 147.41–159.16` | literal, exactly 3 per page |
| paired-action text | `142.32–479.51`, `y 142.92–163.67` | begins slightly *above* the label's y |
| ability notes | `95.52` (depth 0) / `114.72` (depth 1), `y 169.60–192.65` | leading rule of §6b |
| `Sample Perks` heading | `289.31–334.21`, `y 195.42–207.17` | centred, width 44.90, exactly 3 per page |
| perk 1 name | `68.16–147.36`, `y 209.38–221.12` | centred at 107.76 |
| perk 1 body | `172.80–507.52`, `y 209.80–221.55` | same baseline as the name |
| perk 2 name | `89.27–126.25`, `y 226.18–237.92` | |
| perk 2 body | `172.80–521.70`, `y 226.60–238.35` | |
| `(Compounded)` label | `121.46–172.13`, `y 243.08–254.82` | centred at 146.80, exactly 3 per page |
| `(Compounded)` body | `193.46–550.59`, `y 243.10–263.85` | restates perk 2 verbatim then extends it |
| `In Honor of …` | e.g. `113.50–163.20`, `y 661.00–668.83`, h **7.83** | optional |

Verso equivalent (p22, High Noon): name `57.84–134.64` y `117.57–138.45`;
description `166.08`; `Paired Action:` `60.78`; notes `84.00`/`103.20`;
`Sample Perks` `277.79–322.69`; perk bodies `161.28`; `(Compounded)` `109.94–160.61`;
compounded body `181.94`.

**The `(Compounded)` block is always a restatement of the *second* sample perk**,
not a third perk. Verified on p19 (Waco Kid), p22 (Angel Eyes / Hexbuster Shot),
p40, p67.

### Entry boundary detection

`Paired Action:`, `Sample Perks` and `(Compounded)` each occur **exactly 3 times
on every one of the 24 ability pages** — verified, zero exceptions. Use
`Paired Action:` as the anchor: one per entry, textual, unambiguous.

`Essence Cost` is **not** reliable: line-level counts are 4 on p22, p28, p46,
p55 (a merged `Essence Cost Mid` + separate label line) and **2 on p82** (Vessel
— one ability's meter table is grouped differently). Do not anchor on it.

**Ability name lookup:** take the tallest line with `xMax < 210` in the 70 pt
above each `Paired Action:` line. Verified correct on p19 (Trickshot / Standoff /
Shootout), p40 (Rally Point / Blood Brothers / Heriot), p67 (Identity Theft /
Case the Joint / Maximum Security). **Do not hard-code height 20.88** — the book
auto-fits long names down to 19.57/19.58 (Rally Point, Identity Theft, Fun Fact,
Knowledge is Power, Leap Off the Page, Froth at the Mouth, …).

Body font size also varies per entry: notes are h 13.05 on p19 but h 11.75 on
p40 and p31, and perks are h 11.75 on p19 but 10.44 on p31/p40. Derive sizes
per entry, never per book.

---

## 9. Cover page structure (offset +0)

y-ordering is rigidly consistent across all twelve covers. Bands from p18
(Gunslinger) and p72 (Samaritan), with the variation range over all twelve:

| # | part | y band | x | line height | notes |
|---|---|---|---|---|---|
| 1 | **stat line** | `76.73 – 100.73` (identical on all 12) | centred on **300.24** | **24.00** | e.g. `++Skill, +Sensory`, `++Intelligence, +Spirit` |
| 2 | **quote** | starts `164.76` on all 12; 1–3 lines | `336.32 .. 375.40` start, right edge ≤ 565.21 | **13.34** | verse lines are joined by a literal `|` (Illusionist, Berserker) |
| 3 | **quote attribution** | `180.76` / `190.76` / `200.76` depending on quote length | right-ranged, `xMin` 435.10..480.00 | **13.34** | **always a separate block, always begins `— ` (U+2014)** |
| 4 | **prose 1 — overview** | quote block yMax + 2.88 | block `336.00 – 565.20`, **first line xMin = 336.00** | 13.05 | 4–5 lines |
| 5 | **prose 2 — conduit_notes** | +2.95 below prose 1 | block `336.00 – 565.20`, **first line xMin = 339.84** | 13.05 | 6–7 lines; **always opens "Conduits designing a mission for you …"** on all 12 |
| 6 | **prose 3 — grounding** | +2.95 below prose 2 | block `336.00 – 565.20`, **first line xMin = 339.84** | 13.05 | 2–4 lines; **always opens "Grounded in …"** on all 12 |
| 7 | **Examples heading** | +8.95 below prose 3 | `xMin = 336.00` | 13.05 | see exact strings below |
| 8 | **Examples list** | heading yMax + 5.28, then 18.32 pitch | `xMin = 355.68` (all items, all 12 covers) | 13.05 | 5 or 6 items, one `<block>` each |
| 9 | **Quick Tips heading** | `588.03` (11 covers) / `588.55` (Gunslinger) | `154.26 – 276.13` on all 12 | 26.21 tall | literal string `Quick Tips` |
| 10 | **Quick Tips list** | `618.55–711.52` | `xMin = 60.48` (all items, all 12) | 15.66 | **exactly 3 tips on all twelve classes** |
| 11 | **Challenge Level** | `710.20` or `722.19/722.71` | centred, `95.39..101.51 – 328.89..335.00` | 26.21 tall | `Challenge Level: Low` / `: Mid` / `: High` |
| 12 | page number | `764.84 – 783.11` | `292.82 – 307.18` | 18.27 | |

### How to tell the three prose paragraphs apart

1. They are the only three blocks whose block box is exactly `336.00 – 565.20`
   with line height 13.05, and they are contiguous.
2. **Paragraph 1 has no first-line indent (`336.00`); paragraphs 2 and 3 have a
   3.84 pt first-line indent (`339.84`).** True on all twelve covers.
3. Paragraph 2 always begins `Conduits designing a mission for you`;
   paragraph 3 always begins `Grounded in`. Both verified on all twelve.
   Paragraph 1 always begins `You are a` / `You are an`.

### Exact heading strings the covers print

`Quick Tips` — identical on all twelve.

`Challenge Level: Low` (Gunslinger, Illusionist, Thane, Thunderbird, Freerunner),
`Challenge Level: Mid` (Librarian, Wanderer, Berserker, Infiltrator, Witchfinder),
`Challenge Level: High` (Samaritan, Vessel).

The Examples heading is **six different strings** — do NOT match it literally:

| string | classes |
|---|---|
| `Examples from history and pop culture include:` | Gunslinger, Illusionist, Thane, Berserker, Infiltrator, Samaritan |
| `Examples from myth and pop culture include:` | Librarian, Thunderbird |
| `Examples from folklore and pop culture include:` | Wanderer |
| `Examples from pop culture & contemporary history include:` | Freerunner |
| `Examples from pop culture include:` | Vessel |
| `Examples from history & pop culture include:` | Witchfinder |

Match `/^Examples from .+ include:$/` at `xMin == 336.00`.

Examples list item counts: 6 (Gunslinger, Wanderer, Berserker, Infiltrator,
Samaritan, Vessel, Witchfinder) / 5 (Illusionist, Librarian, Thane,
Thunderbird, Freerunner).

There are **no bullet glyphs** — each list item is simply a block at
`xMin = 355.68`.

---

## 10. Expanded Tips page (offset +5)

**The exact heading strings are `Player` and `Conduit`.**

Both are present on **all twelve classes**, at byte-identical geometry:

```
Player   xMin=134.45  xMax=212.59  yMin=98.29  yMax=124.50
Conduit  xMin=397.94  xMax=502.06  yMin=98.29  yMax=124.50
```

on p23, 29, 35, 41, 47, 53, 59, 65, 71, 77, 83, 89 — twelve for twelve, no
variation to the hundredth of a point.

Under them, the Player list starts at `xMin = 72.00` and the Conduit list at
`xMin = 348.48`; nested tips at `90.72` / `367.20` (§6a). Tips begin at
`yMin = 132.01` on every one of the twelve pages.

Both columns freely mix editorial tips (plain sentences) and attributed
player/conduit quotes (`"…" — Tim M.`, `"…" — Tomáš S.`). There is no marker
separating the two kinds; the attribution is an em dash inside the same block.

---

## 11. Things that break the model

### 11a. Per-class marker counts — ALL TWELVE ARE CLEAN

Counted over each class's six pages (`-layout` text):

| class | Default Enchantment | Paired Action: | (Compounded) | Sample Perks | In Honor of | Examples heading | Quick Tips |
|---|---|---|---|---|---|---|---|
| Gunslinger | 12 | 6 | 6 | 6 | 3 | 1 | 1 |
| Illusionist | 12 | 6 | 6 | 6 | 5 | 1 | 1 |
| Librarian | 12 | 6 | 6 | 6 | 3 | 0* | 1 |
| Thane | 12 | 6 | 6 | 6 | 5 | 1 | 1 |
| Thunderbird | 12 | 6 | 6 | 6 | 3 | 0* | 1 |
| Wanderer | 12 | 6 | 6 | 6 | 3 | 0* | 1 |
| Berserker | 12 | 6 | 6 | 6 | 4 | 1 | 1 |
| Freerunner | 12 | 6 | 6 | 6 | 4 | 0* | 1 |
| Infiltrator | 12 | 6 | 6 | 6 | 5 | 1 | 1 |
| Samaritan | 12 | 6 | 6 | 6 | 4 | 1 | 1 |
| Vessel | 12 | 6 | 6 | 6 | 9 | 0* | 1 |
| Witchfinder | 12 | 6 | 6 | 6 | 5 | 0* | 1 |
| **total** | **144** | **72** | **72** | **72** | **53** | 6 | 12 |

\* zero only because the literal probe string was the majority variant — all
twelve do carry an `Examples from … include:` heading (§9).

**No class deviates on Default Enchantment / Paired Action: / (Compounded) /
Sample Perks.** These four counts match the established figures exactly.

Book-wide (all 172 pages): `Default Enchantment` 154, `Paired Action:` 72,
`(Compounded)` 72, `Sample Perks` 85, `In Honor of` 53. So Paired Action,
(Compounded) and In Honor of occur **only** inside the class chapter, while
`Default Enchantment` appears 10 more times and `Sample Perks` 13 more times
elsewhere in the book (rules chapters). **Do not count these book-wide; scope
them to pages 18–89.**

### 11b. Deviations that a naive extractor will hit

1. **Signature entries can start above the header band.** Item names observed
   at `yMin = 40.77` (Samaritan p75, right col, "Blank Check"), `58.16`
   (Berserker p57, "Trophy Belt"), `79.17` (Vessel p81, "Forbidden Bindings"),
   `85.17` (Thunderbird p45), `88.62` (Librarian p33), `98.37` (Witchfinder
   p87), `110.37` (Infiltrator p69), `115.17` (Freerunner p63). These are all
   `+3` pages, which is exactly why the running header is omitted on `+3` — the
   art bleeds into the header band. A `yMin > 60` filter loses entries. Use
   `yMin > 39`.
   Conversely they can start *low*: `146.37` (Samaritan p75 left) and `155.20`
   (Witchfinder p87 left).

2. **Signature entries can run to the bottom margin.** `Default Enchantment` at
   `yMin = 700.93` (Librarian p33, right col) and body lines at `yMin = 742.66`
   (p33, p57). Anything filtering `yMin < 700` truncates entries.

3. **Two-line names.** Item names (`Tranquilizer / Darts`, Infiltrator p69) and
   signature names (`Doctor Without / Borders`, Samaritan p74) and ability names
   (`Knowledge is / Power` p31, `Leap Off the / Page` p34, `Froth at the / Mouth`
   p55, `Behind the …` p28, `Seeing is …` p28, `Thoughts & …` p73, `Holier Than
   …` p76, `Draught of …` p58, `Malleus …` p85, `Done in …` p88, `Path Less …`
   p49, `Embrace the …` p79) are two `<line>`s in one `<block>`. **Count blocks,
   not lines**, or you will over-count entries.

4. **Ability/item name font size is not fixed.** 20.88 normally, 19.57/19.58 for
   long names. A `== 20.88` test misses 15 of the 72 ability names.

5. **`Essence Cost` line counts are 4 on p22, p28, p46, p55 and 2 on p82.**
   Meter label/value grouping by pdftotext is inconsistent (sometimes
   `Essence Cost` and `Mid` end up on one line, sometimes the whole meter table
   merges into a neighbouring block — p37 merges the meters, `Paired Action:`,
   the notes and everything else into a single block spanning `72.30–511.20`).
   **Never trust `<block>` grouping on ability pages.** Re-derive by
   `(yMin, xMin)`.

6. **The note indent asymmetry (§3a).** 19.20 pt inside the column on verso
   signature pages, 24.00 pt on recto. If you compute the indent relative to the
   item-name x and use one constant, half the book's notes will be mis-typed as
   depth 1 vs depth 0.

7. **The footer shift is 12.00, not 11.52** (§3d).

8. **The signature name shares its baseline with the description's first line**
   (§5) — a plain `(yMin, xMin)` sort splices the name into the sentence.

9. **21 superscripts detach** (§7) and 2 of them additionally split their host
   line into two fragments.

10. **`In Honor of` lines land mid-paragraph** (Wanderer p50, y = 372.85, between
    description lines at 371.83 and 380.83). Strip by line height 7.83 first.

11. **Two Tips-page leadings deviate from 12.00** — 11.73 and 12.27 on p83
    (Vessel), both caused by an italic book title (`Advent , pg. 63`) in the run.
    Still nowhere near the 20.39 boundary; a 16.00 threshold is unaffected.

### 11c. Nothing else deviates

* Cadence: 6/6/6 with no gaps, verified page by page.
* Header present on +1/+2/+4/+5, absent on +0/+3, on all twelve.
* `Player` / `Conduit` present on all twelve `+5` pages at identical geometry.
* 3 Quick Tips on all twelve covers.
* 3 abilities per ability page on all 24 ability pages (by `Paired Action:` count).
* 3 + 3 signature entries per signature page on all 24 signature pages (by block).
