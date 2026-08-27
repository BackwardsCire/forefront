# Working on Forefront

Notes for whoever picks this up next, human or agent. Read this before changing
anything; several decisions here look arbitrary and are not.

## What this is

An attention-management tool, not a task manager. It assumes the user already
knows what they need to do. It exists to keep the few things they committed to
visible, let them capture new obligations without breaking concentration, and
force a weekly decision about what deserves attention.

**The governing rule, and the tiebreaker for every ambiguous decision:**

> The backlog is not the home screen.

Opening Forefront should produce *"right, these are the things I said matter"* —
never *"here are 37 things to feel guilty about."* If a change makes the backlog
more present in Focus View, it is wrong regardless of how useful it seems.

Six activities, deliberately kept apart:
**Capture → Triage → Rank → Commit → Execute → Review.**

## Non-goals — do not add these

Not oversights. Each was considered and rejected. Adding one is a regression:

priority fields · due dates · reminders · tags · labels · filters · search ·
subtasks · dependencies · recurrence · time tracking · estimates · dashboards ·
metrics · streaks/points/gamification · accounts · auth · cloud sync ·
collaboration · a settings page · workspaces · plugins · notifications ·
any third-party integration.

Position within a lane **is** the priority, changed by dragging. There is no
settings screen: every tunable lives in `js/constants.js`.

If the board ever needs a query engine to stay usable, the product has drifted.

**Dark mode used to be on that list and no longer is.** It was removed
deliberately, by the repository owner, in the same change that added it. The
reasoning that put it there was never about dark mode itself — it was that a
theme switcher is the usual first step towards a settings screen. That worry is
answered by *how* it was added, not by refusing it: one icon button in a row
that already existed, three radio rows, one keyboard shortcut, no new screen.
If a future change wants to put a second preference next to it, that is the
moment to say no.

## Architecture

```
index.html        entry point — opened directly from disk
assets/           the mark, light and dark, for the README and anything
                  outside the app. The in-app copy is ui.icon('mark').
css/tokens.css    every colour, size, space, in both themes. No literal
                  colour lives elsewhere.
css/styles.css    components
js/constants.js   every tunable value (Done window, commitment count, keys…)
js/theme.js       light / dark / match system — pure state, no DOM beyond
                  one attribute on <html>
js/model.js       data shape, validation, migration, tolerant import — pure
js/storage.js     browser storage + optional connected file
js/ui.js          DOM helpers, icons, dialogs, menus, banners
js/dragdrop.js    pointer-based dragging
js/focus.js       Focus View        js/board.js   Board View
js/review.js      Monday ritual     js/data.js    Data panel
js/app.js         shell: state, actions, keyboard, boot
tools/            development only — never required to run the app
```

**The theme is applied before the first paint**, by a small inline script at the
top of `index.html` — the only non-deferred script in the app. Deferred scripts
run after the document is parsed, which is late enough for the browser to have
painted white; on a start page opened twenty times a day that flash is the whole
of the user's impression. Those eight lines duplicate the top of `theme.js` on
purpose, and the storage key is hard-coded in both. Keep them in step.

`<html data-theme>` always holds the *resolved* theme — `light` or `dark`, never
`system`. That is what lets `tokens.css` carry one dark block instead of a
second copy of the palette inside a `prefers-color-scheme` media query, which is
how the two halves of a theme drift apart.

**No ES modules.** `<script type="module">` is fetched with CORS, and a page
opened from `file://` has an opaque origin, so modules fail to load the moment
someone double-clicks `index.html`. Everything is a classic deferred script
hanging off one global `FF` namespace. Do not "modernise" this.

**No build step, no dependencies, no network requests.** Not even fonts. The app
must behave identically offline. Adding a CDN link or a `fetch()` breaks the
core promise.

**Views are pure renderers.** They never mutate the dataset; they call an action
in `app.js`. That is what keeps "every change is saved, and the user is told
when it isn't" true in one place instead of thirty.

**Rendering is a full rebuild** of the current view on every change. Simple and
fast enough at this scale. The only cost is restoring keyboard focus
afterwards, which `restoreFocus()` handles.

**Boot is synchronous first.** `storage.begin()` reads browser storage and
returns immediately so the page paints in the same tick (~120ms from disk);
`storage.resume()` then does everything asynchronous — probing IndexedDB,
restoring a file handle, checking permission — and only redraws if it found
something different. A browser start page must never show a blank frame.

## Invariants

- **No literal colours outside `css/tokens.css`.** Check:
  `grep -E '#[0-9a-fA-F]{3,8}' css/styles.css` must return nothing.
- **User text never reaches an HTML parser.** No `innerHTML`, no
  `insertAdjacentHTML`. `ui.el()` sets `textContent`; there is deliberately no
  `html` option. A card titled `<img onerror=…>` must stay a funny title.
- **Every text token clears WCAG AA (4.5:1) against every surface it can land
  on** — the page, the card, the subtle surface, the hover fill, both meaning
  washes and all five weekly washes, in *both* themes. Not just against white.
  There is no sub-AA tier; an earlier draft had one annotated "decoration only"
  and it immediately got used for dates, counts and a button label. Quietness
  comes from size and weight. Two themes × five families is 630 pairs, so this
  is checked mechanically rather than by eye: `node tools/check-contrast.js`.
  It also fails if the four text tokens stop forming a visible ladder, because
  a palette where all four are near-white passes every ratio and is still
  broken.
- **Completed work is never destroyed.** Done cards leave the board after
  `DONE_VISIBLE_DAYS` but stay in the data forever. Discard is a soft state
  (`discardedAt`) distinct from completion. Permanent deletion exists only in
  the Data panel, behind a confirmation.
- **The export is the whole application state.** Anything a user would be upset
  to lose must be inside the exported JSON — that is why "Later" deferrals live
  in `weeklyReviews[].deferrals` rather than in browser storage. There are
  exactly two exceptions, and both are properties of the machine rather than of
  the work: the browser's file-permission handle, which cannot be serialised,
  and the light/dark preference, which lives in `C.LS_THEME_KEY`. Syncing a
  theme from a bright office to a dark study would be a bug, and putting it in
  the dataset would rewrite the connected file on every toggle.
- **Everything tolerant about import happens in front of `validateData`, never
  inside it.** Comment stripping, straightening a bare array into a dataset,
  reading "In Progress" as `inprogress` — all of it normalises text into the
  real shape and then hands it to exactly the same validator a Forefront-written
  file goes through, with the same report of what was repaired and refused.
  Loosening the validator itself would mean the checks that protect real data
  are weaker for everyone, to make one paste easier.
- **Never silently overwrite.** If a connected file changed underneath us, stop
  and ask. If what is on screen is newer than a file being loaded, stop and ask.
  Both directions keep a recoverable backup.
- **Storage failures are surfaced**, never hidden. A capture that could not be
  saved leaves its dialog open with the text still in it.

## Verified browser facts

Measured against real Chrome, not assumed. Folklore is wrong about several of
these, and the app runtime-detects rather than trusting any of it — but these
are what the README documents, so re-measure before contradicting them.

| | `file://` | `http://localhost` |
|---|---|---|
| localStorage (Chrome/Edge) | works | works |
| localStorage (Safari) | **blocked**, throws SecurityError | works |
| IndexedDB | **works** (~18ms round trip) | works |
| File System Access incl. `createWritable` | works (Chrome/Edge) | works |
| `navigator.storage.persist()` | refused — storage is evictable | refused |

**All `file://` pages share ONE storage origin.** `location.origin` is the bare
string `"file://"`, not one origin per path. Verified by writing from
`/tmp/a/x.html` and reading it back from `~/b/y.html`. Consequences: moving the
folder does *not* lose data (good), but any other local HTML file the user opens
can read Forefront's keys (bad — the real reason to connect a data file).

## Testing traps — read before debugging a test

`tools/browsertest.js` drives the real `index.html` in headless Chrome. Headless
Chrome under `--virtual-time-budget` lies in specific ways, and each of these
cost real time to diagnose:

- **`requestAnimationFrame` fires exactly once.** Anything rAF-driven appears
  frozen. `dragdrop.js` throttles through rAF, so the drag test shims it to
  `setTimeout` (`opts.shimRAF`).
- **Real I/O appears to hang.** Virtual time fast-forwards a 1500ms timeout in
  microseconds of wall clock, long before real disk I/O finishes. This is why
  IndexedDB looked "blocked" on `file://` when it works fine. **For anything
  touching real I/O or real elapsed time, use `tools/cdp.js`** — a minimal
  DevTools-protocol client that evaluates JS in a real page on a real clock.
- **`Date.now()` is virtual**, so timing measured inside the page is virtual too.
- **Default headless window is 800×600.** The board is wider; without
  `--window-size` the right-hand lanes fall outside the viewport,
  `elementFromPoint` returns nothing, and drags land in the wrong lane.
- **A synthetic `keydown` cannot dismiss a native `<dialog>`.** Escape handling
  is UA behaviour driven by real input. Dispatch a cancelable `cancel` event
  instead — see `escapeDialog()`.
- **A synthetic `keydown` cannot activate a button either.** Untrusted events
  run no default action, so `Enter` on a focused `<button>` fires no click, and
  a test that waits for one waits forever. Assert what the app itself does with
  the key instead — `dispatchEvent()` returns `false` when a handler called
  `preventDefault()`, which is exactly how "a card must not swallow Enter aimed
  at its own Done or menu button" is tested. For the click itself you need real
  input: drive `Input.dispatchKeyEvent` over the DevTools protocol.
- **Headless matches `@media (hover: none)`**, so hover-revealed card controls
  render visible in screenshots. That is the touch variant, not the desktop one.

```bash
node tools/selftest.js        # model: ordering, ages, review logic, validation, import
node tools/check-contrast.js  # every text colour clears AA, both themes, all families
node tools/check-samples.js   # samples valid; empty.json matches createEmptyData()
node tools/make-template.js   # regenerate sample-data/template.jsonc
node tools/browsertest.js     # real index.html in headless Chrome
node tools/crossbrowsertest.js firefox|safari   # WebDriver smoke test
node tools/make-example.js    # regenerate example.json with fresh dates
node tools/screenshot.js DIR  # render views to PNGs
node tools/serve.js --open    # localhost origin (required for Safari)
```

`sample-data/empty.json` must stay structurally identical to
`model.createEmptyData()`. They are kept in step by hand because a `file://`
page cannot `fetch()` an adjacent file, so the app can never read that JSON at
runtime. `check-samples.js` is what stops them drifting.

`sample-data/template.jsonc` is generated, not written: it is
`model.annotate()` over three example cards, with fixed timestamps so the output
is byte-stable. `check-samples.js` regenerates it in memory and compares, so a
change to `FORMAT_GUIDE` that is not followed by `node tools/make-template.js`
fails the build rather than shipping a template describing a format the app no
longer reads.

## The mark

Three cards seen edge-on: the foremost solid and full height, the two behind it
shorter, narrower and fading out. It is the product drawn literally — one thing
in front at full strength, the rest clearly still there and clearly not what you
are being asked to look at. A neat stack of equals would be a different app.

It exists in three places and they have to agree:

- `ui.icon('mark')` in `js/ui.js` — the live one, on a 16 grid, `currentColor`
  with `fill-opacity` for depth so it works on any surface in either theme.
- the favicon data URI at the top of `index.html` — the same shapes at twice
  the coordinates, reversed out of a filled tile, because at 16px on a tab strip
  a bare mark dissolves and a tile does not. Its tile colour is the one literal
  hex outside `tokens.css`; a `data:` URI cannot read a CSS variable.
- `assets/forefront-mark.svg` and `-dark.svg` — for the README, which cannot
  inherit a colour either.

Depth is carried by opacity rather than by a second colour on purpose. That is
what keeps it a single-colour mark.

## Privacy

The application code is public. The user's real task data must never be — it
contains colleagues' names, company and project information. `.gitignore`
covers the obvious filenames; the intended arrangement is a data file kept
entirely outside the repo (a OneDrive folder), connected through the Data panel.

**Do not put the repository owner's real name anywhere** — not in LICENSE, not
in comments, not in commit metadata. The project is published under the handle
`BackwardsCire`. Git is configured with a GitHub noreply address; keep it that
way.
