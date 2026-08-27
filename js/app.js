'use strict';

/**
 * Forefront — application shell.
 *
 * Holds the dataset, decides which view is on screen, and owns every path that
 * changes data. Views are pure renderers; they never touch the dataset
 * directly, they call an action here. That is what keeps "every change is
 * saved, and you are told when it isn't" true in one place rather than in
 * thirty.
 *
 * Rendering is a full rebuild of the current view on every change. At this
 * scale that is far simpler than reconciliation and fast enough to be
 * imperceptible; the only thing it costs is having to put keyboard focus back
 * afterwards, which restoreFocus() below handles.
 */

(function (FF) {
  var ui = FF.ui;
  var el = ui.el;
  var model = FF.model;
  var C = FF.C;

  var state = {
    data: null,
    view: 'focus',        // 'focus' | 'board'
    renderedView: null,   // what was on screen last render, to time transitions
    review: null,         // active review session, if any
    saveFailed: false,
    warnedPartial: false, // said once when only one storage tier is accepting writes
    conflict: false
  };

  var root = null;
  var renderedDay = null;   // the calendar day currently drawn on screen

  // ------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------

  function boot() {
    root = document.getElementById('app');
    applyWeeklyAccent();

    FF.storage.on('conflict', onFileConflict);
    FF.storage.on('fileerror', function (e) { showBanner('warn', e.message, []); });

    // Synchronous, so the page is on screen in this tick. Forefront is a start
    // page; it has no business showing a blank frame while it thinks.
    var start;
    try {
      start = FF.storage.begin();
      state.data = start.data;
    } catch (e) {
      state.data = model.createEmptyData();
      start = { data: state.data, fresh: true, notes: [] };
    }

    render();
    installKeyboard();
    installLifecycle();
    reportBootConditions(start);

    // Everything that needs to await something happens after first paint, and
    // only changes the screen if it actually found different data.
    FF.storage.resume().then(function (update) {
      if (!update) return;

      if (update.needsReconnect) return offerReconnect(update.fileName);

      if (update.notes && update.notes.length) {
        showBanner('warn', update.notes.join(' '), [{ label: 'Open Data', onClick: openData }]);
        return;
      }

      reconcileWithFile(update.data, update.fileName);
    }).catch(function () { /* the app is already usable; nothing to do */ });
  }

  /**
   * A file's contents have arrived — at boot, on reconnect, or on reload — and
   * there is already a board on screen. Decide what to do with them.
   *
   * The rule is that newer local work is never replaced without being asked.
   * There used to be a two-second grace window here to absorb clock jitter, and
   * it did exactly the wrong thing: any local change made within two seconds of
   * the file's timestamp was silently thrown away. The comparison is now
   * strict, and pending unwritten changes count as local work regardless of
   * what the clocks say.
   */
  function reconcileWithFile(parsed, fileName, options) {
    options = options || {};

    if (!parsed) {
      // An empty file — keep what is on screen and let it fill the file.
      commit({ render: false });
      return;
    }

    var result = model.validateData(parsed);
    if (!result.ok) {
      showBanner('warn', 'The data file ' + fileName + ' could not be read: ' +
        result.errors.join(' ') + ' Forefront is using its browser copy instead. The file has not been changed.', []);
      return;
    }

    var fileTime = new Date(result.data.meta.updatedAt);
    var localTime = new Date(state.data.meta.updatedAt);
    var localHasWork = state.data.cards.length > 0;
    var localIsNewer = localHasWork && (localTime > fileTime || FF.storage.hasUnwrittenChanges());

    if (localIsNewer && !options.force) {
      showBanner('warn',
        options.reason ||
        ('What is on screen is newer than ' + fileName + ' — most likely a session that closed before saving. Nothing has been overwritten.'),
        [
          { label: 'Keep what is on screen', primary: true, onClick: function () {
            ui.setBanner(null);
            // Keep a copy of what the file held before replacing it: this
            // direction destroys the file, and the other direction keeps a
            // backup, so they should be equally recoverable.
            FF.storage.readFileText().then(function (text) {
              if (text) FF.storage.writeBackup(text);
              return FF.storage.forceWrite(state.data);
            }).then(function (res) {
              ui.toast(res.ok ? 'Saved over ' + fileName : res.error, res.ok ? 'ok' : 'error');
            });
          } },
          { label: 'Load the file instead', onClick: function () {
            ui.setBanner(null);
            adoptValidated(result, fileName);
          } }
        ], false);
      return;
    }

    adoptValidated(result, fileName);
  }

  /** Take a validated dataset as the working board, keeping the old one. */
  function adoptValidated(result, fileName) {
    // A queued write describes the board we are about to replace. Leaving it
    // alive would let a later visibility/pagehide flush silently write the old
    // board back over the file the user just chose to load.
    FF.storage.discardPendingFileWrites();
    backupCurrent();
    state.data = result.data;
    // Local-only: this data came out of the file, so there is nothing to send
    // back to it.
    commit({ localOnly: true });

    if (result.warnings.length || result.rejected.length) {
      showBanner('warn', 'Loaded ' + fileName + ' with ' +
        (result.warnings.length + result.rejected.length) + ' adjustments. Open Data to see what changed.',
        [{ label: 'Open Data', onClick: openData }]);
    } else {
      ui.toast('Loaded ' + fileName, 'ok');
    }
  }

  /** Re-grant permission on a remembered file, then reconcile its contents. */
  function reconnectFile() {
    FF.storage.reconnect().then(function (res) {
      if (!res.ok) return ui.toast(res.error, 'error');
      ui.setBanner(null);
      if (res.invalid) {
        showBanner('warn', 'Reconnected to ' + res.fileName +
          ', but it is not valid JSON. Forefront is still using its browser copy and has not written to the file.', []);
        return;
      }
      reconcileWithFile(res.data, res.fileName, {
        reason: 'Reconnected to ' + res.fileName +
                ', but what is on screen is newer than the file. Nothing has been overwritten.'
      });
      render();
    });
  }

  function offerReconnect(fileName) {
    showBanner('warn',
      'Forefront remembers your data file (' + fileName + ') but needs your permission again before it can save to it. Until then it is saving to browser storage only.',
      [{ label: 'Reconnect', primary: true, onClick: reconnectFile }]);
  }

  /**
   * Say anything that needs saying about how this session started — before the
   * user types something and loses it. The one that really matters is having no
   * persistence at all, which is what a double-clicked Forefront in Safari
   * looks like.
   */
  function reportBootConditions(result) {
    var s = FF.storage.status();

    if (!s.caps.localStorage) {
      showBanner('bad',
        s.caps.fileProtocol
          ? 'This browser will not let a page opened from disk store data, so nothing you do here will be saved. On macOS, close this tab and double-click start-mac.command to reopen Forefront in its supported localhost mode.'
          : 'This browser is blocking site data, so nothing you do here will be saved. Export before you close the tab.',
        s.caps.fileWrite ? [{ label: 'Connect a data file…', primary: true, onClick: openData }] : [],
        false);
      return;
    }

    var messages = (result.notes || []).slice();

    // Validation may have had to repair or set aside stored records. Saying
    // nothing would mean cards quietly disappearing between sessions.
    var report = result.report;
    if (report && (report.rejected.length || report.warnings.length)) {
      var parts = [];
      if (report.rejected.length) {
        parts.push(report.rejected.length +
          (report.rejected.length === 1 ? ' stored card or review could not be read and was left out' :
                                          ' stored cards or reviews could not be read and were left out'));
      }
      if (report.warnings.length) {
        parts.push(report.warnings.length +
          (report.warnings.length === 1 ? ' was repaired' : ' were repaired'));
      }
      messages.push('Forefront adjusted your stored data on load: ' + parts.join(', ') + '.');
    }

    if (messages.length) {
      showBanner('warn', messages.join(' '), [{ label: 'Open Data', onClick: openData }]);
    }
  }

  function onFileConflict(e) {
    state.conflict = true;
    showBanner('warn',
      (e.fileName || 'The connected data file') + ' changed outside Forefront, so it has not been overwritten. Your recent changes are safe in browser storage.',
      [
        { label: 'Load the file', primary: true, onClick: function () {
          FF.storage.reloadFromFile().then(function (res) {
            if (!res.ok) return ui.toast(res.error, 'error');
            state.conflict = false;
            ui.setBanner(null);
            // Chosen from a banner that already explained the situation.
            adoptFromFile(res.data, res.fileName, { force: true });
          });
        } },
        { label: 'Keep mine and overwrite', onClick: function () {
          ui.confirmDialog({
            title: 'Overwrite the file?',
            message: 'The version on disk will be replaced by what is on screen. Whatever changed it will be lost.',
            confirmLabel: 'Overwrite',
            danger: true
          }).then(function (yes) {
            if (!yes) return;
            // Keep what the file held first — this is the one direction that
            // destroys something the user cannot otherwise get back.
            FF.storage.readFileText().then(function (text) {
              if (text) FF.storage.writeBackup(text);
              return FF.storage.forceWrite(state.data);
            }).then(function (res) {
              state.conflict = false;
              ui.setBanner(null);
              ui.toast(res.ok ? 'File overwritten — the previous contents are recoverable from the Data panel' : res.error,
                       res.ok ? 'ok' : 'error');
            });
          });
        } }
      ], false);
  }

  // ------------------------------------------------------------------
  // Saving
  // ------------------------------------------------------------------

  /**
   * Persist, then re-render. Every action funnels through here, so a storage
   * failure can never be shown as success — the banner goes up and stays up
   * until a later save works.
   */
  function commit(options) {
    var res = FF.storage.save(state.data, options);

    if (!res.ok) {
      state.saveFailed = true;
      showBanner('bad', res.error, [{ label: 'Export now', primary: true, onClick: function () {
        FF.dataPanel.downloadJSON(state.data);
      } }], false);
    } else if (state.saveFailed) {
      state.saveFailed = false;
      if (!state.conflict) ui.setBanner(null);
      ui.toast('Saving again', 'ok');
    }

    if (res.ok && res.warning && !state.warnedPartial) {
      // Saved, but only to one of the two places. Say so once.
      state.warnedPartial = true;
      showBanner('warn', res.warning, []);
    }

    if (!options || options.render !== false) render();
    return res.ok;
  }

  // ------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------

  function render() {
    var focusedCardId = currentlyFocusedCardId();
    FF.board.cancelDrag();
    ui.closeMenu(false);

    document.body.dataset.view = state.view;
    document.body.dataset.review = state.review ? state.review.stepId() : '';
    renderedDay = model.dateKey(new Date());

    ui.clear(root);

    // The fade belongs to switching views, not to opening the app. Forefront is
    // a browser start page: the first paint has to be instant, and an animating
    // container is a container that is briefly invisible.
    var switched = state.renderedView !== null && state.renderedView !== state.view;
    state.renderedView = state.view;

    if (state.view === 'board') {
      var node = FF.board.render(state.data, actions, {
        reviewRail: state.review ? state.review.rail(state.data) : null,
        highlightStale: !!state.review && state.review.stepId() === 'prune',
        staleDays: FF.review.PRUNE_AGE_DAYS
      });
      if (switched) node.classList.add('view-enter');
      root.appendChild(node);
      FF.board.attachDrag(node, actions);
    } else {
      var focusNode = FF.focus.render(state.data, actions);
      var prompt = FF.review.renderPrompt(state.data, actions);
      var indicator = FF.review.renderIndicator(state.data, actions);
      if (prompt) focusNode.insertBefore(prompt, focusNode.querySelector('.focus__main'));
      if (indicator) focusNode.querySelector('.focus__actions').appendChild(indicator);
      if (switched) focusNode.classList.add('view-enter');
      root.appendChild(focusNode);
    }

    restoreFocus(focusedCardId);
  }

  function currentlyFocusedCardId() {
    var active = document.activeElement;
    if (!active || !active.closest) return null;
    var card = active.closest('[data-card-id]');
    return card ? card.dataset.cardId : null;
  }

  /** Put keyboard focus back on the card the user was on, so nudging a card up
   *  the lane with Alt+Up repeatedly actually works. */
  function restoreFocus(cardId) {
    if (!cardId) return;
    var node = root.querySelector('[data-card-id="' + cssEscape(cardId) + '"]');
    if (node) node.focus({ preventScroll: false });
  }

  /**
   * Put focus somewhere sensible after a dialog closes.
   *
   * Saving rebuilds the view, which destroys whatever opened the dialog. The
   * native <dialog> focus restore then aims at a detached node and focus lands
   * on <body>, so the next Tab starts from the top of the page. Landing on the
   * capture control instead keeps a keyboard user roughly where they were.
   */
  function focusCaptureControl() {
    var target = root.querySelector('[data-capture-trigger]');
    if (target) target.focus({ preventScroll: true });
  }

  function cssEscape(value) {
    if (window.CSS && window.CSS.escape) return window.CSS.escape(value);
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function showBanner(kind, message, actionList, dismissible) {
    ui.setBanner({ kind: kind, message: message, actions: actionList || [], dismissible: dismissible !== false });
  }

  // ------------------------------------------------------------------
  // Weekly accent
  //
  // A different accent hue each calendar week, chosen from the week number so
  // it is identical on every machine and never changes between page loads.
  // Nothing moves; only colour shifts, and only slightly. This is the whole of
  // the "theme system" on purpose.
  // ------------------------------------------------------------------

  function applyWeeklyAccent() {
    var family = FF.ACCENT_FAMILIES[0];
    if (C.WEEKLY_ACCENT_ROTATION) {
      var monday = model.weekStart(new Date());
      var weeks = Math.floor(monday.getTime() / 604800000);
      family = FF.ACCENT_FAMILIES[((weeks % FF.ACCENT_FAMILIES.length) + FF.ACCENT_FAMILIES.length) % FF.ACCENT_FAMILIES.length];
    }
    document.documentElement.dataset.accent = family;
  }

  // ------------------------------------------------------------------
  // Actions — the only way data changes
  // ------------------------------------------------------------------

  function capture() {
    openCaptureDialog();
  }

  /**
   * Put a captured line in the Inbox, or leave the dataset exactly as it was.
   *
   * A capture that could not be stored keeps its dialog open with the text
   * still in it, to be retried. That is only honest if the dataset is not
   * quietly holding a copy as well: a card left in memory means the retry adds
   * a second one, and whichever save finally works then writes both. So the
   * add is rolled back — including meta.updatedAt, which decides whether the
   * board on screen counts as newer than the connected file.
   *
   * commit() is asked not to render, so the card never appears on screen in
   * the frame between adding it and taking it back.
   */
  function captureToInbox(text) {
    var updatedAtBefore = state.data.meta.updatedAt;
    var card = model.addCard(state.data, text, 'inbox');
    var saved = commit({ render: false });

    if (!saved) {
      // Not a user deleting anything — undoing an add that never reached
      // storage. The dialog is now the only copy of what they typed.
      model.deleteCardForever(state.data, card.id);
      state.data.meta.updatedAt = updatedAtBefore;
    }

    render();
    return saved;
  }

  function openCaptureDialog() {
    var input = el('input', {
      type: 'text',
      class: 'capture__input',
      placeholder: 'What just came to mind?',
      'aria-label': 'Capture a thought',
      autocomplete: 'off',
      spellcheck: 'true',
      'data-autofocus': ''
    });

    var handle = ui.openDialog({
      className: 'dialog--capture',
      label: 'Quick Capture',
      build: function (close) {
        function submit(keepOpen) {
          var text = input.value.trim();
          if (!text) { close(); return; }

          if (!captureToInbox(text)) {
            // The text stays on screen: it was not stored, and clearing the
            // field would be a lie about that.
            return;
          }

          ui.announce('Captured to Inbox');
          if (keepOpen) {
            input.value = '';
            input.focus();
            ui.toast('Captured', 'ok');
          } else {
            close();
            focusCaptureControl();
          }
        }

        return el('form', {
          class: 'capture',
          onsubmit: function (e) { e.preventDefault(); submit(false); }
        }, [
          input,
          el('div', { class: 'capture__foot' }, [
            el('span', { class: 'capture__dest', text: 'Goes to Inbox' }),
            el('span', { class: 'capture__hint' }, [
              el('kbd', { text: 'Enter' }),
              el('span', { text: ' to save · ' }),
              el('kbd', { text: 'Esc' }),
              el('span', { text: ' to cancel' })
            ])
          ])
        ]);
      }
    });

    // Ctrl/Cmd+Enter keeps the field open for a run of captures without
    // changing what plain Enter does.
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        var text = input.value.trim();
        if (!text) return;
        if (captureToInbox(text)) { input.value = ''; ui.toast('Captured', 'ok'); }
      }
    });

    return handle;
  }

  function edit(cardId) {
    var card = model.findCard(state.data, cardId);
    if (!card) return;

    var titleInput = el('input', {
      type: 'text', class: 'edit__title', value: card.title,
      'aria-label': 'Title', 'data-autofocus': '', autocomplete: 'off'
    });
    var notesInput = el('textarea', {
      class: 'edit__notes', rows: '4', value: card.notes || '',
      'aria-label': 'Notes', placeholder: 'Notes (optional)'
    });

    ui.openDialog({
      className: 'dialog--edit',
      label: 'Edit card',
      build: function (close) {
        function save() {
          var title = titleInput.value.trim();
          if (!title) { titleInput.focus(); return; }
          model.updateCard(state.data, cardId, { title: title, notes: notesInput.value });
          if (commit()) {
            close();
            // render() has already put focus back on the card itself.
            restoreFocus(cardId);
          }
        }

        return el('form', {
          class: 'edit',
          onsubmit: function (e) { e.preventDefault(); save(); }
        }, [
          titleInput,
          notesInput,
          el('div', { class: 'dialog__actions' }, [
            el('button', { type: 'button', class: 'btn btn--quiet', text: 'Cancel', onclick: function () { close(); } }),
            el('button', { type: 'submit', class: 'btn btn--primary', text: 'Save' })
          ])
        ]);
      }
    });
  }

  function complete(cardId) {
    var card = model.findCard(state.data, cardId);
    if (!card) return;
    model.completeCard(state.data, cardId);
    commit();
    ui.announce('“' + card.title + '” marked done');
  }

  function discard(cardId) {
    var card = model.findCard(state.data, cardId);
    if (!card) return;
    model.discardCard(state.data, cardId);
    commit();
    ui.announce('“' + card.title + '” discarded');
    ui.toast('Discarded — kept in your data', 'info');
  }

  function move(cardId, laneId, index, options) {
    var card = model.findCard(state.data, cardId);
    if (!card) return;

    var fromLane = card.lane;
    var fromIndex = model.laneCards(state.data, fromLane)
      .findIndex(function (c) { return c.id === cardId; });

    model.moveCard(state.data, cardId, laneId, index);
    commit();

    if (options && options.fromDrag) return;

    // Only say something moved if something moved. Announcing a change that did
    // not happen is worse than silence for anyone relying on the announcement.
    var toIndex = model.laneCards(state.data, card.lane)
      .findIndex(function (c) { return c.id === cardId; });

    if (card.lane !== fromLane) {
      ui.announce('“' + card.title + '” moved to ' + FF.LANE_BY_ID[card.lane].label);
    } else if (toIndex !== fromIndex) {
      ui.announce('“' + card.title + '” moved to position ' + (toIndex + 1) + ' in ' + FF.LANE_BY_ID[card.lane].label);
    } else {
      ui.announce('“' + card.title + '” did not move');
    }
  }

  function nudge(cardId, delta) {
    if (!model.nudgeCard(state.data, cardId, delta)) {
      ui.announce('Already at the ' + (delta < 0 ? 'top' : 'bottom'));
      return;
    }
    commit();
    var card = model.findCard(state.data, cardId);
    var position = model.laneCards(state.data, card.lane)
      .findIndex(function (c) { return c.id === cardId; });
    ui.announce('Position ' + (position + 1));
  }

  /** Alt+Left / Alt+Right — step a card sideways through the lanes. */
  function shiftLane(cardId, delta) {
    var card = model.findCard(state.data, cardId);
    if (!card) return;
    var at = FF.LANE_IDS.indexOf(card.lane);
    var next = FF.LANE_IDS[at + delta];
    if (!next) return;
    move(cardId, next, 0);
  }

  function restore(cardId) {
    model.restoreCard(state.data, cardId);
    commit();
    ui.toast('Restored', 'ok');
  }

  function deleteForever(cardId) {
    model.deleteCardForever(state.data, cardId);
    commit();
    ui.toast('Deleted permanently', 'info');
  }

  // ---- views -------------------------------------------------------

  function showBoard(laneId) {
    state.view = 'board';
    render();
    if (laneId) {
      var lane = root.querySelector('.lane--' + laneId + ', .inbox[data-lane="' + laneId + '"]');
      if (lane && lane.scrollIntoView) lane.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
  }

  function showFocus() {
    state.view = 'focus';
    state.review = null;
    render();
  }

  function openData() { FF.dataPanel.open(api); }

  // ---- review ------------------------------------------------------

  function startReview() {
    model.ensureReview(state.data, model.weekOf());
    state.review = FF.review.createSession(actions);
    state.view = 'board';
    commit();
  }

  function deferReview() {
    model.deferReview(state.data, model.weekOf());
    commit();
    ui.toast('Reminder will come back later today', 'info');
  }

  function skipReview() {
    model.skipReview(state.data, model.weekOf());
    commit();
    ui.toast('Skipped this week', 'info');
  }

  function finishReview() {
    model.completeReview(state.data, model.weekOf());
    state.review = null;
    state.view = 'focus';
    commit();
    ui.toast('Review recorded', 'ok');
  }

  /** Leave without recording it. The week stays pending, and the quiet
   *  indicator comes back — no decision has been made yet. */
  function abandonReview() {
    state.review = null;
    state.view = 'focus';
    render();
  }

  // ---- data panel callbacks ----------------------------------------

  /**
   * Take a file's contents. `options.force` skips the "what is on screen is
   * newer" check, and is used only where the user has just been shown exactly
   * what will be replaced and said yes — asking a second time in a banner would
   * be noise, not safety.
   */
  function adoptFromFile(parsed, fileName, options) {
    reconcileWithFile(parsed, fileName, options);
    render();
  }

  function adoptImported(validated) {
    backupCurrent();
    state.data = validated;
    commit();
    ui.toast('Data imported', 'ok');
  }

  /**
   * Keep the outgoing dataset where it can be recovered. Never blocks the
   * operation it precedes — but if it could not be kept, say so, because the
   * UI has just told the user a copy was being kept.
   */
  function backupCurrent() {
    try {
      if (FF.storage.writeBackup(model.serialize(state.data))) return true;
    } catch (e) { /* fall through */ }
    ui.toast('Replaced — but this browser could not keep a recoverable copy of the previous board.', 'error');
    return false;
  }

  // ------------------------------------------------------------------
  // Keyboard
  // ------------------------------------------------------------------

  function isTyping(target) {
    if (!target) return false;
    var tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  function installKeyboard() {
    document.addEventListener('keydown', function (e) {
      if (e.defaultPrevented) return;
      if (isTyping(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return; // leave browser shortcuts alone

      var key = e.key.toLowerCase();

      if (ui.anyDialogOpen() || ui.anyMenuOpen()) return; // they handle their own keys

      if (key === C.CAPTURE_KEY) { e.preventDefault(); capture(); }
      else if (key === 'b') { e.preventDefault(); state.view === 'board' ? showFocus() : showBoard(); }
      else if (key === 'f') { e.preventDefault(); showFocus(); }
      else if (key === 'd') { e.preventDefault(); openData(); }
      else if (key === '?') { e.preventDefault(); showHelp(); }
      else if (e.key === 'Escape' && state.view === 'board') { e.preventDefault(); showFocus(); }
    });
  }

  function showHelp() {
    var rows = [
      [C.CAPTURE_KEY_LABEL, 'Quick Capture'],
      ['B', 'Board / Focus'],
      ['F', 'Focus'],
      ['D', 'Data'],
      ['?', 'This list'],
      ['Esc', 'Close, or leave the board'],
      ['Enter', 'Edit the focused card'],
      ['Alt + ↑ ↓', 'Move the focused card up or down its lane'],
      ['Alt + ← →', 'Move the focused card to the next lane'],
      ['Ctrl/⌘ + Enter', 'In Quick Capture: save and stay open']
    ];

    ui.openDialog({
      className: 'dialog--help',
      labelledBy: 'help-title',
      build: function (close) {
        return el('div', { class: 'dialog__body' }, [
          el('h2', { class: 'dialog__title', id: 'help-title', text: 'Keyboard' }),
          el('dl', { class: 'help' }, rows.reduce(function (acc, row) {
            acc.push(el('dt', {}, [el('kbd', { text: row[0] })]));
            acc.push(el('dd', { text: row[1] }));
            return acc;
          }, [])),
          el('p', { class: 'help__note', text: 'Single-key shortcuts are ignored while you are typing.' }),
          el('div', { class: 'dialog__actions' }, [
            el('button', { type: 'button', class: 'btn btn--primary', text: 'Close', 'data-autofocus': '', onclick: function () { close(); } })
          ])
        ]);
      }
    });
  }

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  /**
   * Re-render when the date changes.
   *
   * Forefront is a start page: the tab stays open for days. Without this, the
   * date in the header, every card age, the Done visibility window and the
   * Monday review prompt are all frozen at whatever they were when the page
   * loaded — so a tab opened on Sunday would never offer Monday's review, and
   * a card would sit at "6d" for a week.
   *
   * One timer, re-armed each time. It fires a few seconds after midnight to
   * stay clear of the boundary itself, and re-reads the clock rather than
   * assuming 24 hours have passed, so daylight-saving changes and a laptop
   * waking from sleep both land correctly.
   */
  var midnightTimer = null;

  function scheduleMidnightRefresh() {
    if (midnightTimer) clearTimeout(midnightTimer);

    var now = new Date();
    var next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
    var delay = next - now;

    // setTimeout saturates above ~24.8 days; nothing here approaches that, but
    // a machine that slept through the deadline should also just re-check.
    midnightTimer = setTimeout(function () {
      midnightTimer = null;
      state.renderedView = state.view; // a new day is not a view transition
      render();
      scheduleMidnightRefresh();
    }, Math.max(1000, delay));
  }

  function installLifecycle() {
    scheduleMidnightRefresh();

    // Waking from sleep, or coming back to the tab, may mean the date moved on
    // while no timer could fire.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      if (renderedDay !== model.dateKey(new Date())) {
        state.renderedView = state.view;
        render();
      }
      scheduleMidnightRefresh();
    });

    // visibilitychange is the reliable moment to force a pending file write
    // through; beforeunload cannot await an async write, and browsers may skip
    // it entirely. The browser-storage copy is already written synchronously,
    // so nothing is at risk either way.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') FF.storage.flush();
    });
    window.addEventListener('pagehide', function () { FF.storage.flush(); });
  }

  // ------------------------------------------------------------------

  var actions = {
    capture: capture,
    edit: edit,
    complete: complete,
    discard: discard,
    move: move,
    nudge: nudge,
    shiftLane: shiftLane,
    showBoard: showBoard,
    showFocus: showFocus,
    openData: openData,
    showHelp: showHelp,
    startReview: startReview,
    deferReview: deferReview,
    skipReview: skipReview,
    finishReview: finishReview,
    abandonReview: abandonReview,
    rerender: render
  };

  /** The surface the Data panel talks to. */
  var api = {
    getData: function () { return state.data; },
    adoptFromFile: adoptFromFile,
    adoptImported: adoptImported,
    reconnectFile: reconnectFile,
    restore: restore,
    deleteForever: deleteForever,
    refresh: render
  };

  FF.app = { boot: boot, actions: actions, api: api, state: state };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window.FF);
