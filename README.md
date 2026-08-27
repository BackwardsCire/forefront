# Forefront

**Keep what matters in front of you.**

Forefront is an attention-management tool, not a task manager. It assumes you
already know what you need to do. The problem it solves is the other one:
keeping the right handful of things visible, writing down new obligations
without breaking your concentration, and being made to decide — once a week —
what actually deserves your attention.

It is a single folder of HTML, CSS and JavaScript. There is no build step, npm
install, account or external service. A tiny local server gives Chrome, Firefox
and Safari the same safe browser-storage origin on macOS.

---

## The problem it is built around

Sticky notes work. Writing something down helps you remember it, capture takes
two seconds, the note stays visible, and you can reorder them by moving them.

Then they stop working. More notes accumulate, the desk fills up, each
individual note loses its salience, and eventually the whole collection turns
into wallpaper you no longer see.

Task apps fail the same way for the opposite reason: they hold everything
perfectly and you stop opening them.

Forefront is designed to be your **browser start page**, so it turns up in your
day whether or not you remember it — and then deliberately shows you almost
nothing.

## The idea

> **Capture quickly. Triage later. Rank visually. Commit narrowly. Execute by
> default. Review periodically.**

Six activities, kept apart on purpose:

| | |
|---|---|
| **Capture** | What just entered my head? One keystroke, no questions. |
| **Triage** | What is this, actually? Later, by dragging. |
| **Rank** | What matters more than what? Position, not priority fields. |
| **Commit** | What have I decided deserves attention? About three things. |
| **Execute** | What should I be working on? The default screen. |
| **Review** | Are my priorities still right? Monday, for two minutes. |

The whole design follows from one rule: **the backlog is not the home screen.**
Opening Forefront should produce *"right, these are the things I said matter"* —
never *"here are 37 things to feel guilty about."*

---

## Running it

```bash
git clone <your-repo-url>
cd forefront
```

On macOS, double-click **`start-mac.command`**. It starts Forefront on
`http://127.0.0.1:8765/` and opens the default browser. Keep its Terminal window
open while using Forefront. This is the supported setup for current Chrome,
Firefox and Safari.

From a terminal, the equivalent is:

```bash
node tools/serve.js --open
```

The launcher falls back to Python 3 when Node is unavailable. There is no
`npm install`, and localhost traffic never leaves the Mac. To use a different
browser, open `http://127.0.0.1:8765/` in it.

Opening `index.html` directly remains available as a Chrome convenience, but is
not the cross-browser setup: browser storage and file permissions for `file://`
pages differ by browser.

A fresh clone is complete and immediately usable. `sample-data/empty.json` is a
pristine empty dataset you can copy somewhere to use as your real data file, and
`sample-data/example.json` is a populated demo board you can import to have a
look around before committing to anything.

The demo carries real dates, so its card ages grow and its Done lane empties out
as the file sits in the repository. `node tools/make-example.js` regenerates it
against today. Nothing about the app depends on this — it only affects how good
the demo looks.

---

## Using it

### Focus View — the default

The three things you committed to, the date, and a way to write something down.
That is deliberately all. Lane counts sit quietly at the bottom; the board is one
click away when you actually want it.

If you commit to more than three, Forefront shows them but mentions, once,
that Focus works best with three. It will not nag you about it again.

### Quick Capture

Press **N** anywhere, type, press **Enter**. It lands in Inbox and the box
closes. You are not asked which lane, or for a priority, a due date, a tag, a
project, or an estimate — because you are in a meeting and the point is to get
back to it.

**Escape** cancels. **Ctrl/⌘ + Enter** saves and keeps the box open for a run of
captures.

### Board View — planning, on purpose

Press **B**. Five lanes, plus Inbox as a strip across the top rather than a
sixth column, because Inbox is a holding pen you empty, not a place work lives.

| Lane | What belongs there |
|---|---|
| **Inbox** | Captured, not yet decided. Temporary by definition. |
| **Management** | Leading people, teams, the organisation. |
| **Projects** | Substantive deliverables that need sustained thought. |
| **Just Do It** | One obvious action, roughly five minutes or less. |
| **In Progress** | What you have consciously committed to. About three. |
| **Done** | Recently finished, for closure. |

**Just Do It is deliberately narrower and lighter.** A dozen five-minute chores
are easier to look at than one hard strategy document, and without that
handicap they would win every time.

**There are no priority fields.** No high/medium/low, no P0, no stars, no flags.
Position is priority — drag a card above another one, exactly as you would
rearrange sticky notes. There are also no filters and no search, on purpose: if
the board ever needs a query engine to stay usable, something has gone wrong
with the board.

### Ages

Every open card shows how long it has been sitting: `today`, `3d`, `19d`. This
is gentle awareness, not an SLA. Nothing goes red, nothing becomes "overdue",
and nothing is deleted for being old. Age is information, not judgment.

During the weekly review's Prune step — and only then — cards older than two
weeks are marked, so you notice them once a week instead of every day.

### Finishing and dropping things

Mark a card done and it moves to Done, timestamped, and stays visible for about
**four days** before quietly leaving the board. It is never deleted; it stays in
your data permanently.

Discarding is different from completing, and Forefront keeps them apart. "I
finished this" and "I decided this no longer matters" are both worth knowing a
year from now. Discarded cards leave the board but stay in your data, and can be
restored from the Data panel. Permanent deletion also lives there, behind a
confirmation, because it is the only action that actually destroys history.

To change how long Done stays visible, edit `DONE_VISIBLE_DAYS` in
[`js/constants.js`](js/constants.js). Every tunable value in Forefront lives in
that one file. There is no settings screen.

---

## The Monday review

If it is Monday and you have not done this week's review, Focus View offers it —
as an inline panel, not a dialog. It cannot block you, because sometimes you
opened the browser at 8am because something is on fire.

- **Review now** — starts it.
- **Later** — gets out of the way immediately. A quiet `Review pending` mark
  stays, and Forefront offers again on a later page load that day. Deliberately:
  "Later" is procrastination, and a reminder you can permanently dismiss without
  thinking is not a reminder.
- **Skip this week** — a decision, recorded as one. You are not asked again.

If Monday passes with no decision at all, a small `Review missed` mark appears
and does nothing else. No escalation, no counter, no guilt.

The review itself is a rail across the top of the normal board — five steps,
about two minutes, with the board fully usable underneath the whole time:

1. **Look back** — what actually got done since last time.
2. **Empty the Inbox** — drag each capture into a lane, or discard it.
3. **Prune** — for anything stale: advance it, name the next action, delegate it, or drop it.
4. **Re-rank** — reorder the cards within each lane for the week. Position is priority.
5. **Commit** — *if Friday came and only three meaningful things were done,
   which three would you most want them to be?*

The review never traps you. If you continue with captures still in Inbox, or
finish with none or more than three commitments, Forefront asks you to make that
choice explicitly and then respects the answer.

Then it records the review, snapshots what you committed to, and drops you back
into Focus. The backlog disappears again.

---

## Keyboard

| Key | |
|---|---|
| `N` | Quick Capture |
| `B` | Board / Focus |
| `F` | Focus |
| `D` | Data panel |
| `?` | Shortcut list |
| `Esc` | Close an overlay, or leave the board |
| `Enter` | Edit the focused card or commitment |
| `Alt` + `↑` `↓` | Board: move the focused card up or down its lane |
| `Alt` + `←` `→` | Board: move the focused card to the next lane |
| `Ctrl`/`⌘` + `Enter` | In Quick Capture: save and stay open |

Single-key shortcuts are ignored while you are typing.

`Enter` follows focus: it edits the card you are on, but when focus is on one of
that card's own controls — its done tick, or `···` — `Enter` presses that
control instead.

On the board, every card also has a `···` menu holding the same moves plus mark
done, edit and discard — so nothing needs a mouse, and nothing needs a drag.
Focus View is deliberately barer: a commitment can be opened with `Enter` and
completed with the control that appears beside it, and reordering happens on the
board where it belongs.

---

## Where your data lives

This is the part worth reading properly, because browsers make the obvious thing
harder than it should be.

Forefront always keeps a copy in **browser storage**, written the instant
anything changes. On top of that it can connect to a **JSON file you choose** —
in a OneDrive folder, say — and write through to it. That file is the portable,
readable, syncable, hand-it-to-an-AI copy, and on the browsers that support it
Forefront reopens it automatically every time.

The Data panel (`D`) always tells you, in plain words, which of these is
actually in force right now. It does not guess and it does not over-promise.

### Supported browsers on macOS

The support contract is the localhost URL opened by `start-mac.command`:

| Capability | Chrome | Firefox | Safari |
|---|---|---|---|
| Focus, Board, capture and weekly review | ✅ | ✅ | ✅ |
| Automatic browser-storage persistence | ✅ | ✅ | ✅ |
| JSON export and import | ✅ | ✅ | ✅ |
| Connect and write through to a chosen JSON file | ✅ | — | — |

The app probes capabilities at runtime rather than browser-sniffing. Chrome's
File System Access API provides the optional connected-file workflow. Firefox
and Safari use the same complete app with browser storage plus JSON
export/import; keep periodic exports if the data matters.

Opening from disk is outside the common support contract. Chrome can currently
do more from `file://`, Firefox has its own local-file storage behavior, and
Safari may block persistence entirely. Forefront reports the capability it
actually measures, but localhost is the predictable and private option in all
three browsers.

### The `file://` storage trap

Chrome gives *every* page loaded from disk the same origin — the literal string
`file://`, not one origin per file. Two consequences, both verified:

**The good one.** Your data is not tied to the path, so moving or renaming the
Forefront folder does not lose it.

**The one that matters.** Every other local HTML file you open in that browser
shares the same storage area and can read what Forefront put there. A saved web
page, a downloaded attachment, anything you double-click. Forefront namespaces
its keys so nothing collides by accident, but it cannot make the storage
private — that is how the browser works.

So: do not use the direct-file mode for confidential work. The supported
localhost origin keeps Forefront's storage separate from unrelated local HTML
files. In Chrome, a connected data file adds another copy; in Firefox and
Safari, make periodic JSON exports.

`navigator.storage.persist()` is refused for local files, so the browser may
evict them under disk pressure, and "clear browsing data" will certainly remove
them. Browser storage on localhost is still best-effort: a connected data file
or periodic export is your real backup.

### If something cannot be saved

Forefront tells you. A failed write raises a banner that stays up until a save
succeeds, and if a capture could not be stored the box stays open with your text
still in it rather than closing as though it worked — and nothing is left half
added behind it, so retrying once storage recovers gives you one card, not one
per attempt. If only one of the two
places is accepting writes — browser storage blocked but a data file connected,
say — it says that too, once, rather than either lying or crying wolf.

If the data stored in this browser ever becomes unreadable, Forefront says so
instead of quietly starting you on an empty board, and keeps the unreadable
original where the Data panel can recover it.

Anything that replaces your board — an import, loading a data file, overwriting
a file with what is on screen — keeps a copy of what it replaced first, in both
directions.

### If the file changed underneath it

If a connected file was modified outside Forefront — another machine, a sync
client, an editor — Forefront stops, does **not** overwrite it, and asks whether
to load the file or keep what is on screen. It assumes one writer at a time and
makes no attempt to merge. That is a deliberate limit, not an oversight.

---

## Getting your data in and out

Everything lives in one human-readable JSON file. Nothing about your history is
trapped in the application.

**Export All Data** (Data panel → Download JSON, or Copy to clipboard) writes the
*complete* dataset: open cards, Inbox, completed work long past the point it left
the board, discarded work, ordering, every timestamp, weekly-review records
including deferrals, metadata and the schema version. It is a full backup — drop
it on another computer, import it, and you are exactly where you left off. No
meaningful state exists anywhere that is missing from that file.

The one exception, unavoidably: the browser's permission to write to your
connected data file. That is a grant this browser made to this machine, not a
fact about your work, and it cannot be exported. Reconnect the file after
importing.

### The AI workflow

```
Export JSON  →  hand it to Claude / ChatGPT / Codex  →  get JSON back  →  Import
```

Useful things to ask for: what is stale, what looks duplicated, what is not
actually actionable, what should probably be dropped, help me reorder this for
next week.

Import is careful about what comes back. It parses, validates, checks the schema
version, repairs what it can, and **shows you a report before replacing
anything** — what it read, what it adjusted, what it had to leave out. Broken
JSON never replaces good data, a file from a newer version of Forefront is
refused rather than half-read, and your previous dataset is kept as a
recoverable copy first.

It also preserves fields it does not recognise. If an assistant annotates your
cards with something Forefront has never heard of, those annotations survive the
round trip.

### The data format

```json
{
  "schemaVersion": 1,
  "app": "Forefront",
  "meta": { "createdAt": "…", "updatedAt": "…" },
  "cards": [
    {
      "id": "uuid",
      "title": "Review architecture proposal",
      "notes": "",
      "lane": "projects",
      "order": 2,
      "createdAt": "2026-08-25T14:30:00.000Z",
      "updatedAt": "2026-08-25T14:30:00.000Z",
      "completedAt": null,
      "discardedAt": null,
      "sourceLane": null
    }
  ],
  "weeklyReviews": [
    {
      "weekOf": "2026-08-24",
      "status": "completed",
      "completedAt": "…",
      "commitmentIds": ["…"],
      "deferrals": [],
      "note": ""
    }
  ]
}
```

Lanes are `inbox`, `management`, `projects`, `justdoit`, `inprogress`, `done`.
`order` is a dense integer within each lane — position is the priority.
`sourceLane` records where a card was when it was completed or discarded, so a
future version can answer "what management work did I finish this year" without
guessing. `deferrals` records each time you pressed "Later", which is why the
export really is the whole of Forefront's state.

`note` on a weekly review is unused in V1 and exists so a future reflection or
journal feature has somewhere to put things.

---

## Making it your start page

The correct instruction is **startup page** or **homepage**. Be aware of what is
and is not possible with the New Tab page — most guides get this wrong.

Start Forefront, then use the same URL in each browser:
`http://127.0.0.1:8765/`. The launcher must be running when the browser opens it.

**Chrome** — Settings → **On startup** → *Open a specific page or set of pages* →
**Add a new page** → paste. (`chrome://settings/onStartup`.) For a Home button
too: Settings → **Appearance** → *Show Home button* → paste the same URL. `Alt`+`Home`
(Windows) or `⌘`+`Shift`+`H` (macOS) then jumps to it.

**Edge** — Settings → **Start, home, and new tabs** → *When Edge starts* → **Open
these pages** → **Add a new page** → paste. (`edge://settings/startHomeNTP`.) The
same section has *Show home button on the toolbar*, which pairs well with
`Ctrl`+`T` then `Alt`+`Home`.

**Safari** — Safari → Settings → **General** → **Homepage** → paste (or open
Forefront first and click *Set to Current Page*). Safari can also do what the
others cannot: set **New tabs open with: Homepage** and **New windows open with:
Homepage**, and `⌘`+`T` will load Forefront.

**Firefox** — Settings → **Home** → *Homepage and new windows* → **Custom URLs…**
→ paste.

### About the New Tab page

**Safari is the only one of these that can natively make new tabs open your own
URL.** Chrome, Edge and Firefox all require an extension; none of them has a
setting for it.

Do not go looking for the Edge `NewTabPageLocation` registry workaround that gets
recommended online — Microsoft documents it as applying only to devices joined to
Active Directory or Entra ID, or enrolled in device management. On a personal
Windows 11 PC it is silently ignored.

If your work machine's browser settings are greyed out, they are locked by
policy; check `edge://policy` or `chrome://policy` and talk to IT.

---

## Privacy

Forefront makes **no external network requests**. No analytics, telemetry, CDN,
remote fonts, update check or AI integration. In the supported setup the browser
loads files from the loopback-only local server; that traffic never leaves your
Mac, and the app behaves identically with the internet disconnected.

### Keep your real data out of this repository

The application code is fine in a public repo. Your actual tasks are not — they
will contain colleagues' names, company information, project details and
management context.

`.gitignore` already excludes the obvious filenames, but the safest arrangement
is simply to keep your data file somewhere else entirely:

```
OneDrive/Forefront/forefront-data.json     ← your real data
~/code/forefront/                          ← this repository
```

In Chrome, use **Create a new data file…** in the Data panel to make one there.
In Firefox or Safari, export JSON there periodically instead. Only
`sample-data/` is ever committed, and it contains nothing but invented examples.

---

## Known limitations

- **Use localhost for cross-browser support.** Direct `file://` behavior differs
  across Chrome, Firefox and Safari and is not the common supported setup.
- **Browser storage is shared with every other local file** you open, when
  running from `file://`. Connect a data file for anything confidential.
- **Browser storage is evictable** — it is a safety copy, not a backup. Connect
  a data file or export periodically.
- **Firefox and Safari do not expose Chrome's chosen-file write API** — use
  browser storage plus export/import.
- **On Safari, stored data may be deleted after seven days of Safari use**
  without interacting with the site, under WebKit's tracking-prevention policy.
  Another argument for exporting.
- **One writer at a time.** Forefront detects that a file changed underneath it
  and asks; it does not merge.
- **Desktop-first.** It works on a small screen but is not designed for one.
- **No search and no filters**, deliberately. See above.
- **Mobile is not supported** in V1.

---

## Repository layout

```
forefront/
├── index.html            application entry point, served by the launcher
├── css/
│   ├── tokens.css        every colour, size and space, in one place
│   └── styles.css        components (no literal colours)
├── js/
│   ├── constants.js      every tunable value
│   ├── model.js          data shape, validation, migration — no DOM
│   ├── storage.js        browser storage + connected file
│   ├── ui.js             DOM helpers, dialogs, menus, banners
│   ├── dragdrop.js       pointer-based dragging
│   ├── focus.js          Focus View
│   ├── board.js          Board View
│   ├── review.js         the Monday ritual
│   ├── data.js           the Data panel
│   └── app.js            shell — state, actions, keyboard
├── sample-data/
│   ├── empty.json        a pristine empty dataset
│   └── example.json      a populated demo board
├── start-mac.command     double-click launcher for macOS
└── tools/                local server and development checks
```

Scripts load as ordinary deferred scripts rather than ES modules, because module
scripts are fetched with CORS and a page opened from `file://` has an opaque
origin — `<script type="module">` simply fails to load when you double-click
`index.html`. Everything hangs off a single global `FF` namespace.

## Development

The app itself has no dependencies. Node runs the included local server and
development checks; the macOS launcher can fall back to Python 3 for serving.

```bash
node tools/selftest.js       # data model: ordering, ages, review logic, validation
node tools/check-samples.js  # sample files are valid and empty.json matches the code
node tools/browsertest.js    # drives the real index.html in headless Chrome
node tools/crossbrowsertest.js firefox # localhost smoke test via Firefox WebDriver
node tools/crossbrowsertest.js safari  # same smoke test via Safari WebDriver on macOS
node tools/make-example.js   # regenerate example.json with fresh dates
node tools/screenshot.js DIR # render the views to PNGs
```

`tools/browsertest.js` builds its page from `index.html` itself, so the tests run
against the real markup, scripts and stylesheets over `file://` — nothing is
stubbed. `tools/crossbrowsertest.js` runs the real app over its supported
localhost URL. Safari requires macOS and one-time WebDriver enablement with
`safaridriver --enable`.

## License

MIT — see [LICENSE](LICENSE).
