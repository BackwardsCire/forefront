'use strict';

/**
 * Forefront — constants.
 *
 * Every tunable value in the application lives here. If you want to change how
 * Forefront behaves, look in this file first; there is deliberately no settings
 * screen. Forefront attaches everything to a single global `FF` namespace rather
 * than using ES modules, because `<script type="module">` does not load from
 * `file://` in Chrome, Edge or Safari (module scripts are fetched with CORS, and
 * a file:// origin is opaque). Classic deferred scripts work everywhere.
 */

var FF = window.FF || (window.FF = {});

FF.C = {
  // ---- Data format -------------------------------------------------------
  APP_NAME: 'Forefront',
  SCHEMA_VERSION: 1,

  // ---- The numbers that shape the product --------------------------------

  /** How many days a completed card stays visible in the Done lane.
   *  It is never deleted — after this it simply stops cluttering the board. */
  DONE_VISIBLE_DAYS: 4,

  /** How many commitments Focus View shows, and — see below — how many
   *  In Progress will accept. */
  FOCUS_COMMITMENTS: 3,

  /**
   * Refuse to move a fourth card into In Progress.
   *
   * This started as a soft limit: Forefront mentioned it once and let you
   * carry five. That is a limit that does not limit anything, and the lane
   * quietly became a second backlog — which is the failure this whole app
   * exists to avoid.
   *
   * The refusal deliberately does NOT swap anything out for you. Deciding
   * what stops being a commitment IS the decision; an app that makes it
   * automatically has taken the only part that matters and left you with the
   * bookkeeping. So it explains, names what is in the way, and stops.
   *
   * Set to false to go back to the soft limit.
   */
  ENFORCE_COMMITMENT_LIMIT: true,

  /**
   * How many Just Do It cards Focus View shows beside the commitments.
   *
   * There is a real tension here. Five-minute chores belong on the home
   * screen — they are what you do between the hard things — but an unbounded
   * list of them turns Focus into the backlog, which is the one thing it must
   * never be. A short column with "+N more on the board" underneath keeps the
   * useful half and refuses the rest.
   */
  FOCUS_JUSTDOIT_VISIBLE: 5,

  /** Day of the week the review ritual belongs to. 0=Sunday, 1=Monday. */
  REVIEW_DAY: 1,

  /** After "Later", how long before Forefront may offer the review again on a
   *  fresh page load that same day. "Later" is procrastination, so it comes
   *  back; "Skip this week" is a decision, so it does not. */
  REVIEW_DEFER_HOURS: 2,

  // ---- Look and feel -----------------------------------------------------

  /** Rotate a subtly different accent palette each calendar week so the page
   *  does not become wallpaper. Nothing moves; only accent hue and the focus
   *  wash shift. Set to false to pin the palette to ACCENT_FAMILIES[0]. */
  WEEKLY_ACCENT_ROTATION: true,

  /** Quick Capture. A single unmodified key, because every modifier
   *  combination worth having is already taken by a browser, and capture has to
   *  be faster than reaching for a sticky note. Ignored while typing. */
  CAPTURE_KEY: 'n',
  CAPTURE_KEY_LABEL: 'N',

  /** Step the theme on one: Match system → Light → Dark → Match system. The
   *  header control offers the same three directly; this is for the hands. */
  THEME_KEY: 't',
  THEME_KEY_LABEL: 'T',

  /** Pixels the pointer must travel before a press becomes a drag. Below this
   *  it stays a click, so clicking and double-clicking a card still work. */
  DRAG_THRESHOLD_PX: 5,

  // ---- Storage -----------------------------------------------------------

  LS_KEY: 'forefront.data.v1',
  LS_BACKUP_KEY: 'forefront.backup.v1',

  /** Light/dark/system. Deliberately its own key rather than a field in the
   *  dataset: which theme suits the room you are in is not part of your work,
   *  and putting it in the data would rewrite the connected file every time
   *  someone flicked the switch. Also hard-coded in the inline script at the
   *  top of index.html — change it in both places or not at all. */
  LS_THEME_KEY: 'forefront.theme.v1',
  IDB_NAME: 'forefront',
  IDB_STORE: 'handles',

  /** Debounce before writing through to a connected file, in ms. Keeps a burst
   *  of drag-reorders from producing a burst of disk writes. The browser-side
   *  copy is always written immediately and synchronously. */
  FILE_WRITE_DEBOUNCE_MS: 600,

  /** Suggested filename when creating a new data file. */
  DEFAULT_FILENAME: 'forefront-data.json'
};

/**
 * The lanes. Order here is the order they appear on the board.
 *
 * `weight` drives column sizing: Just Do It is deliberately narrower and
 * lighter so a dozen five-minute chores cannot visually outrank one strategy
 * document, and In Progress is deliberately wider because it is the point.
 */
FF.LANES = [
  { id: 'inbox',      label: 'Inbox',       weight: 0,    triage: true  },
  { id: 'management', label: 'Management',  weight: 1                   },
  { id: 'projects',   label: 'Projects',    weight: 1                   },
  { id: 'justdoit',   label: 'Just Do It',  weight: 0.78, secondary: true },
  { id: 'inprogress', label: 'In Progress', weight: 1.18, emphasis: true  },
  { id: 'done',       label: 'Done',        weight: 0.8,  terminal: true  }
];

/** Lane ids that a card may be triaged into from the Inbox. */
FF.TRIAGE_LANES = ['management', 'projects', 'justdoit', 'inprogress'];

FF.LANE_IDS = FF.LANES.map(function (l) { return l.id; });

FF.LANE_BY_ID = FF.LANES.reduce(function (map, lane) {
  map[lane.id] = lane;
  return map;
}, {});

/**
 * Weekly accent families. Each is a small override on top of the base tokens in
 * css/tokens.css — accent hue and the focus wash only. Spatial layout, type and
 * text contrast never change, so the app feels slightly different week to week
 * without ever moving anything or hurting legibility.
 */
FF.ACCENT_FAMILIES = ['slate', 'steel', 'navy', 'stone', 'heather'];
