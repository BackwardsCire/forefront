'use strict';

/**
 * Forefront — light and dark.
 *
 * Dark mode was on the non-goals list for a long time, for a reason worth
 * keeping in mind: a theme switcher is the classic first step towards a
 * settings screen, and this app does not have one. So this is deliberately the
 * smallest thing that is still the industry-standard behaviour:
 *
 *   - three states, not two: Light, Dark, and System (the default). Two-state
 *     toggles are the common bug — once you have touched one you can never get
 *     back to following the operating system, which is what most people
 *     actually want most of the time.
 *   - the choice is applied before the first paint, from an inline script in
 *     index.html, so a dark-mode user never gets a white flash on a start page
 *     they open twenty times a day.
 *   - while the preference is "system", a change to the OS setting is picked
 *     up live, without a reload.
 *
 * `<html data-theme>` always carries the RESOLVED theme — "light" or "dark",
 * never "system" — so css/tokens.css only needs one dark block instead of
 * duplicating the whole palette inside a prefers-color-scheme media query.
 * `<html data-theme-pref>` carries the preference itself, for the control that
 * has to show which of the three is chosen.
 *
 * Where the preference is stored, and why it is not in the export:
 *
 * CLAUDE.md says the exported JSON is the whole application state. This is the
 * second deliberate exception to that, after the file handle. Light or dark is
 * a property of the screen you are sitting at, not of your work: the same
 * dataset opened on a laptop in a bright office and on a desktop at night
 * wants different answers, and syncing a theme between them would be a bug,
 * not a feature. It also would mean rewriting the connected data file every
 * time someone flicks the switch. So it lives in its own browser-storage key
 * and nothing else knows about it.
 */

(function (FF) {
  var C = FF.C;

  var PREFS = ['system', 'light', 'dark'];

  var LABELS = {
    system: 'Match system',
    light: 'Light',
    dark: 'Dark'
  };

  var pref = 'system';
  var listeners = [];
  var query = null;

  // ------------------------------------------------------------------
  // Reading and writing the preference
  // ------------------------------------------------------------------

  function isPref(value) { return PREFS.indexOf(value) !== -1; }

  /**
   * Storage here is best-effort on purpose. Everywhere else in Forefront a
   * failed write is surfaced loudly, because it means losing work — but the
   * worst case here is that the app opens in the system theme next time, which
   * is not worth a banner. Safari refuses storage entirely for file:// pages,
   * and that must not stop the toggle working for the current session.
   */
  function read() {
    try {
      var stored = window.localStorage.getItem(C.LS_THEME_KEY);
      return isPref(stored) ? stored : 'system';
    } catch (e) {
      return 'system';
    }
  }

  function write(value) {
    try {
      window.localStorage.setItem(C.LS_THEME_KEY, value);
      return true;
    } catch (e) {
      return false;
    }
  }

  // ------------------------------------------------------------------
  // Applying it
  // ------------------------------------------------------------------

  function systemPrefersDark() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function resolve(value) {
    if (value === 'light' || value === 'dark') return value;
    return systemPrefersDark() ? 'dark' : 'light';
  }

  function apply() {
    var root = document.documentElement;
    var resolved = resolve(pref);
    // Only touch the attribute when it actually changes: writing it
    // unconditionally invalidates style on every system-preference event.
    if (root.dataset.theme !== resolved) root.dataset.theme = resolved;
    if (root.dataset.themePref !== pref) root.dataset.themePref = pref;
    return resolved;
  }

  function notify() {
    var resolved = resolve(pref);
    listeners.forEach(function (fn) {
      try { fn(pref, resolved); } catch (e) { /* a listener must not break the theme */ }
    });
  }

  // ------------------------------------------------------------------
  // Public
  // ------------------------------------------------------------------

  function init() {
    pref = read();
    apply();

    if (window.matchMedia) {
      query = window.matchMedia('(prefers-color-scheme: dark)');
      var onSystemChange = function () {
        // Only meaningful while following the system; applying regardless is
        // harmless and keeps the branch out of the hot path.
        if (pref === 'system') { apply(); notify(); }
      };
      if (query.addEventListener) query.addEventListener('change', onSystemChange);
      else if (query.addListener) query.addListener(onSystemChange); // Safari < 14
    }
  }

  function set(value) {
    if (!isPref(value)) return;
    pref = value;
    write(value);
    apply();
    notify();
  }

  /** Next preference in the ring: System → Light → Dark → System. */
  function cycle() {
    set(PREFS[(PREFS.indexOf(pref) + 1) % PREFS.length]);
    return pref;
  }

  function onChange(fn) { listeners.push(fn); }

  /** "Dark" — or "Match system (dark)", which is the thing people need to see. */
  function describe() {
    if (pref === 'system') return 'Match system (' + resolve(pref) + ')';
    return LABELS[pref];
  }

  FF.theme = {
    PREFS: PREFS,
    LABELS: LABELS,
    init: init,
    set: set,
    cycle: cycle,
    onChange: onChange,
    describe: describe,
    get: function () { return pref; },
    resolved: function () { return resolve(pref); }
  };
})(window.FF);
