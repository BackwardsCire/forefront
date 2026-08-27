'use strict';

/**
 * Forefront — the data model.
 *
 * Pure data in, pure data out. Nothing in this file touches the DOM, and
 * nothing in this file knows how data is persisted. That separation is what
 * makes the JSON trustworthy: every rule about what a valid Forefront dataset
 * is lives here, in one place, where a human or an AI assistant can read it.
 */

(function (FF) {
  var C = FF.C;

  // ------------------------------------------------------------------
  // Small utilities
  // ------------------------------------------------------------------

  /**
   * Stable unique id. crypto.randomUUID needs a secure context; file:// counts
   * as one in Chrome and Edge but has been inconsistent in older Safari, so we
   * fall back through getRandomValues before giving up on Math.random.
   */
  function uid() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
      }
    } catch (e) { /* fall through */ }

    try {
      if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
        var b = new Uint8Array(16);
        window.crypto.getRandomValues(b);
        b[6] = (b[6] & 0x0f) | 0x40; // version 4
        b[8] = (b[8] & 0x3f) | 0x80; // variant 10
        var hex = [];
        for (var i = 0; i < 16; i++) hex.push((b[i] + 0x100).toString(16).slice(1));
        return hex.slice(0, 4).join('') + '-' + hex.slice(4, 6).join('') + '-' +
               hex.slice(6, 8).join('') + '-' + hex.slice(8, 10).join('') + '-' +
               hex.slice(10, 16).join('');
      }
    } catch (e) { /* fall through */ }

    return 'ff-' + Date.now().toString(36) + '-' +
           Math.random().toString(36).slice(2, 10);
  }

  function nowISO() { return new Date().toISOString(); }

  function isObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function isValidDate(d) {
    return d instanceof Date && !isNaN(d.getTime());
  }

  /** Parse a timestamp leniently; return an ISO string or null. */
  function toISO(value) {
    if (value === null || value === undefined || value === '') return null;
    var d = new Date(value);
    return isValidDate(d) ? d.toISOString() : null;
  }

  /** Midnight local time for a date — the basis for calendar-day maths. */
  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  /**
   * Whole calendar days between two dates, in local time. Deliberately not
   * "elapsed / 86400000": a card written at 11pm yesterday should read 1d this
   * morning, not 0d. Math.round absorbs the 23- and 25-hour days that daylight
   * saving transitions produce.
   */
  function dayDiff(from, to) {
    return Math.round((startOfDay(to) - startOfDay(from)) / 86400000);
  }

  /** YYYY-MM-DD in local time. Not toISOString(), which would shift the day. */
  function dateKey(date) {
    var m = date.getMonth() + 1;
    var d = date.getDate();
    return date.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
  }

  /** The review day (Monday by default) on or before the given date. */
  function weekStart(date) {
    var d = startOfDay(date);
    var delta = (d.getDay() - C.REVIEW_DAY + 7) % 7;
    d.setDate(d.getDate() - delta);
    return d;
  }

  function weekOf(date) { return dateKey(weekStart(date || new Date())); }

  // ------------------------------------------------------------------
  // Construction
  // ------------------------------------------------------------------

  /**
   * A pristine, valid, empty Forefront dataset.
   *
   * This must stay structurally identical to sample-data/empty.json. The file
   * on disk exists so you can seed a OneDrive file by copying it; this function
   * exists because a page loaded from file:// cannot fetch() an adjacent file,
   * so the app cannot read that JSON at runtime. tools/check-samples.js
   * verifies the two agree.
   */
  function createEmptyData() {
    var ts = nowISO();
    return {
      schemaVersion: C.SCHEMA_VERSION,
      app: C.APP_NAME,
      meta: { createdAt: ts, updatedAt: ts },
      cards: [],
      weeklyReviews: []
    };
  }

  function createCard(title, lane) {
    var ts = nowISO();
    return {
      id: uid(),
      title: String(title == null ? '' : title).trim(),
      notes: '',
      lane: lane || 'inbox',
      order: 0,
      createdAt: ts,
      updatedAt: ts,
      completedAt: null,
      discardedAt: null,
      /** The lane a card was living in when it was completed or discarded.
       *  Nothing in V1 displays this. It is recorded because "what management
       *  work did I actually finish this year" is unanswerable without it, and
       *  one nullable string now is cheaper than regretting it later. */
      sourceLane: null
    };
  }

  function createReview(weekKey, status) {
    return {
      weekOf: weekKey,
      status: status || 'pending',
      completedAt: null,
      commitmentIds: [],
      /** Timestamps of each "Later". Kept in the data file rather than in
       *  browser storage so that an exported dataset really is the whole of
       *  Forefront's state, and so deferral patterns stay reviewable later. */
      deferrals: [],
      note: ''
    };
  }

  // ------------------------------------------------------------------
  // Queries
  // ------------------------------------------------------------------

  function isActive(card) { return !card.discardedAt; }

  function byOrder(a, b) {
    if (a.order !== b.order) return a.order - b.order;
    return String(a.id).localeCompare(String(b.id)); // stable tiebreak
  }

  /** Age of a card in whole days. */
  function ageDays(card, now) {
    var created = new Date(card.createdAt);
    if (!isValidDate(created)) return 0;
    return Math.max(0, dayDiff(created, now || new Date()));
  }

  /** "today", "1d", "12d" — gentle awareness, never an alarm. */
  function ageLabel(card, now) {
    var d = ageDays(card, now);
    return d === 0 ? 'today' : d + 'd';
  }

  /**
   * Cards in a lane, in order. Discarded cards never appear anywhere, and Done
   * shows only recent completions — older ones stay in the JSON forever but
   * stop cluttering the board, which is how the board cleans itself up without
   * anyone deleting their own history.
   */
  function laneCards(data, laneId, now) {
    var ref = now || new Date();
    var out = [];
    for (var i = 0; i < data.cards.length; i++) {
      var c = data.cards[i];
      if (c.lane !== laneId || !isActive(c)) continue;
      if (laneId === 'done' && !isRecentlyDone(c, ref)) continue;
      out.push(c);
    }
    return out.sort(byOrder);
  }

  function isRecentlyDone(card, now) {
    if (!card.completedAt) return false;
    var done = new Date(card.completedAt);
    if (!isValidDate(done)) return false;
    return dayDiff(done, now || new Date()) < C.DONE_VISIBLE_DAYS;
  }

  /** All completed cards, newest first — the permanent record, not the lane. */
  function completedCards(data) {
    return data.cards
      .filter(function (c) { return c.completedAt && isActive(c); })
      .sort(function (a, b) { return new Date(b.completedAt) - new Date(a.completedAt); });
  }

  /** Cards completed since a given date, newest first. Used by Look Back. */
  function completedSince(data, since) {
    return completedCards(data).filter(function (c) {
      return new Date(c.completedAt) >= since;
    });
  }

  /** The commitments Focus View is built from. */
  function commitments(data) { return laneCards(data, 'inprogress'); }

  function findCard(data, id) {
    for (var i = 0; i < data.cards.length; i++) {
      if (data.cards[i].id === id) return data.cards[i];
    }
    return null;
  }

  /** Counts per lane for the Focus View footer. */
  function laneCounts(data, now) {
    var counts = {};
    FF.LANE_IDS.forEach(function (id) { counts[id] = laneCards(data, id, now).length; });
    return counts;
  }

  // ------------------------------------------------------------------
  // Mutations
  //
  // Every mutation renumbers the lanes it touched to 0..n-1 and stamps
  // meta.updatedAt. Order is stored densely and rewritten on every move, which
  // is a little more work per move but means the JSON is always obvious to read
  // and impossible to get subtly wrong.
  // ------------------------------------------------------------------

  function touch(data) { data.meta.updatedAt = nowISO(); }

  function normalizeLane(data, laneId) {
    var cards = data.cards
      .filter(function (c) { return c.lane === laneId && isActive(c); })
      .sort(byOrder);
    for (var i = 0; i < cards.length; i++) cards[i].order = i;
  }

  function normalizeAll(data) { FF.LANE_IDS.forEach(function (id) { normalizeLane(data, id); }); }

  /** Add a card to the top of a lane. Capture goes to the top of Inbox so the
   *  newest thought is the first one you see when you sit down to triage. */
  function addCard(data, title, lane) {
    var card = createCard(title, lane || 'inbox');
    data.cards.push(card);
    var siblings = laneCards(data, card.lane);
    for (var i = 0; i < siblings.length; i++) {
      if (siblings[i].id !== card.id) siblings[i].order += 1;
    }
    card.order = 0;
    normalizeLane(data, card.lane);
    touch(data);
    return card;
  }

  function updateCard(data, id, fields) {
    var card = findCard(data, id);
    if (!card) return null;
    if (typeof fields.title === 'string') card.title = fields.title.trim();
    if (typeof fields.notes === 'string') card.notes = fields.notes;
    card.updatedAt = nowISO();
    touch(data);
    return card;
  }

  /**
   * Move a card to a lane at a given index. This is the single path for every
   * reorder, every lane change, every completion by drag and every un-completion
   * by dragging back out, so the rules about completedAt live in exactly one
   * place.
   */
  function moveCard(data, id, toLane, toIndex) {
    var card = findCard(data, id);
    if (!card || FF.LANE_IDS.indexOf(toLane) === -1) return null;

    var fromLane = card.lane;

    if (toLane === 'done' && !card.completedAt) {
      card.completedAt = nowISO();
      card.sourceLane = fromLane;
    } else if (toLane !== 'done' && card.completedAt) {
      // Dragged back out of Done: it is not finished after all.
      card.completedAt = null;
      card.sourceLane = null;
    }

    card.lane = toLane;
    card.updatedAt = nowISO();

    // Insert by fractional order, then renumber. Placing the card halfway
    // between its new neighbours is enough to land it in the right slot once
    // normalizeLane rewrites the whole lane to dense integers.
    var siblings = laneCards(data, toLane).filter(function (c) { return c.id !== id; });
    var idx = Math.max(0, Math.min(toIndex == null ? siblings.length : toIndex, siblings.length));
    var before = idx === 0 ? -1 : siblings[idx - 1].order;
    var after = idx >= siblings.length ? before + 2 : siblings[idx].order;
    card.order = (before + after) / 2;

    normalizeLane(data, toLane);
    if (fromLane !== toLane) normalizeLane(data, fromLane);
    touch(data);
    return card;
  }

  /** Nudge a card one position within its lane. The keyboard equivalent of a
   *  short drag. Returns true if anything actually moved. */
  function nudgeCard(data, id, delta) {
    var card = findCard(data, id);
    if (!card) return false;
    var siblings = laneCards(data, card.lane);
    var at = siblings.findIndex(function (c) { return c.id === id; });
    var target = at + delta;
    if (at === -1 || target < 0 || target >= siblings.length) return false;
    moveCard(data, id, card.lane, target);
    return true;
  }

  function completeCard(data, id) {
    var card = findCard(data, id);
    if (!card) return null;
    // Newest completion sits at the top of Done.
    return moveCard(data, id, 'done', 0);
  }

  /**
   * Discard: "I have decided this no longer matters", which is a different fact
   * from "I finished this" and worth keeping apart. The card leaves every lane
   * but stays in the JSON, so a future review can look at what was dropped as
   * well as what was done.
   */
  function discardCard(data, id) {
    var card = findCard(data, id);
    if (!card) return null;
    var fromLane = card.lane;
    card.discardedAt = nowISO();
    card.sourceLane = card.sourceLane || fromLane;
    card.updatedAt = nowISO();
    normalizeLane(data, fromLane);
    touch(data);
    return card;
  }

  /**
   * Undo a discard, putting the card back where it was.
   *
   * A card that had been completed before it was discarded goes back to Done
   * with its completion intact. Clearing completedAt here would quietly rewrite
   * history — turning "I finished this in March, then tidied it away" into "I
   * never finished it" — and completion records are the one thing this app
   * promises never to lose.
   */
  function restoreCard(data, id) {
    var card = findCard(data, id);
    if (!card) return null;

    card.discardedAt = null;

    if (card.completedAt) {
      card.lane = 'done';
    } else {
      card.lane = restoreLaneFor(card);
      card.sourceLane = null;
    }

    card.updatedAt = nowISO();
    moveCard(data, id, card.lane, 0);
    return card;
  }

  /** Where an uncompleted card should return to. 'done' is not an answer —
   *  a card can only reach Done by being completed. */
  function restoreLaneFor(card) {
    var lane = card.sourceLane;
    return (lane && lane !== 'done' && FF.LANE_IDS.indexOf(lane) !== -1) ? lane : 'inbox';
  }

  /** Irreversible. Deliberately not reachable from ordinary card controls. */
  function deleteCardForever(data, id) {
    var idx = data.cards.findIndex(function (c) { return c.id === id; });
    if (idx === -1) return false;
    var lane = data.cards[idx].lane;
    data.cards.splice(idx, 1);
    normalizeLane(data, lane);
    touch(data);
    return true;
  }

  // ------------------------------------------------------------------
  // Weekly review
  // ------------------------------------------------------------------

  function reviewFor(data, weekKey) {
    for (var i = 0; i < data.weeklyReviews.length; i++) {
      if (data.weeklyReviews[i].weekOf === weekKey) return data.weeklyReviews[i];
    }
    return null;
  }

  function ensureReview(data, weekKey) {
    var r = reviewFor(data, weekKey);
    if (!r) {
      r = createReview(weekKey, 'pending');
      data.weeklyReviews.push(r);
      touch(data);
    }
    return r;
  }

  function deferReview(data, weekKey) {
    var r = ensureReview(data, weekKey);
    if (r.status === 'pending') {
      r.deferrals.push(nowISO());
      touch(data);
    }
    return r;
  }

  function skipReview(data, weekKey) {
    var r = ensureReview(data, weekKey);
    r.status = 'skipped';
    r.completedAt = nowISO();
    touch(data);
    return r;
  }

  function completeReview(data, weekKey) {
    var r = ensureReview(data, weekKey);
    r.status = 'completed';
    r.completedAt = nowISO();
    r.commitmentIds = commitments(data).map(function (c) { return c.id; });
    touch(data);
    return r;
  }

  /**
   * What, if anything, Forefront should say about the review right now.
   *
   *   'due'     — offer the prompt (review day, not yet done, not deferred recently)
   *   'pending' — deferred a moment ago; show only a quiet indicator
   *   'missed'  — the review day passed without a decision; a quiet indicator, no nagging
   *   'none'    — nothing to say
   */
  function reviewState(data, now) {
    var ref = now || new Date();
    var key = weekOf(ref);
    var r = reviewFor(data, key);

    if (r && (r.status === 'completed' || r.status === 'skipped')) return 'none';

    var isReviewDay = startOfDay(ref).getTime() === weekStart(ref).getTime();

    if (isReviewDay) {
      if (r && r.deferrals.length) {
        var last = new Date(r.deferrals[r.deferrals.length - 1]);
        var hours = (ref - last) / 3600000;
        // hours >= 0 matters: a data file synced from a machine whose clock runs
        // fast can carry a deferral stamped in the future, and without this a
        // single "Later" would suppress the prompt until that future arrived.
        if (hours >= 0 && hours < C.REVIEW_DEFER_HOURS) return 'pending';
      }
      return 'due';
    }

    // The review day has passed without a decision.
    //
    // Only say so if Forefront was actually in use that day. Opening the app
    // for the first time on a Wednesday and being told you missed a review you
    // were never offered is precisely the kind of unearned reproach that makes
    // people stop opening a tool.
    if (r) return 'missed';

    var created = new Date(data.meta && data.meta.createdAt);
    if (isValidDate(created) && created < weekStart(ref)) return 'missed';

    return 'none';
  }

  // ------------------------------------------------------------------
  // Migration
  // ------------------------------------------------------------------

  /**
   * Bring an older dataset up to the current schema. There is only one schema
   * version so far, so this is a placeholder with a real shape: add a case per
   * version, migrate forward one step at a time, and leave newer-than-known
   * data alone for validate() to reject.
   */
  function migrateData(data) {
    if (!isObject(data)) return data;
    var v = typeof data.schemaVersion === 'number' ? data.schemaVersion : 0;

    if (v < 1) {
      data.schemaVersion = 1;
      if (!isObject(data.meta)) data.meta = { createdAt: nowISO(), updatedAt: nowISO() };
      if (!Array.isArray(data.cards)) data.cards = [];
      if (!Array.isArray(data.weeklyReviews)) data.weeklyReviews = [];
    }

    // if (data.schemaVersion === 1) { ...migrate to 2...; data.schemaVersion = 2; }

    return data;
  }

  // ------------------------------------------------------------------
  // Validation
  //
  // Import is the one place hostile or broken data can enter, so it is checked
  // properly. Two rules govern this code: never overwrite good data with
  // rubbish, and never silently discard a record. Anything repairable is
  // repaired and reported; anything unusable is set aside and reported; unknown
  // fields are passed through untouched so that a future version's data, or an
  // AI assistant's annotations, survive a round trip.
  // ------------------------------------------------------------------

  var STATUSES = ['pending', 'completed', 'skipped'];
  var DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

  function validateData(raw) {
    var errors = [];
    var warnings = [];
    var rejected = [];

    if (!isObject(raw)) {
      return { ok: false, errors: ['This is not a Forefront dataset — the file does not contain a JSON object.'], warnings: warnings, rejected: rejected, data: null };
    }

    if (typeof raw.schemaVersion !== 'number' || !isFinite(raw.schemaVersion)) {
      warnings.push('No schemaVersion found; assuming version ' + C.SCHEMA_VERSION + '.');
      raw.schemaVersion = C.SCHEMA_VERSION;
    }
    if (raw.schemaVersion > C.SCHEMA_VERSION) {
      return {
        ok: false,
        errors: ['This file uses schema version ' + raw.schemaVersion + ', but this copy of Forefront understands version ' + C.SCHEMA_VERSION + '. Update Forefront before importing it — importing now could lose data the newer version added.'],
        warnings: warnings, rejected: rejected, data: null
      };
    }

    if (raw.app && raw.app !== C.APP_NAME) {
      warnings.push('The "app" field says "' + String(raw.app).slice(0, 40) + '" rather than "' + C.APP_NAME + '". Importing anyway.');
    }

    var data = migrateData(raw);

    if (!Array.isArray(data.cards)) {
      errors.push('"cards" is missing or is not a list.');
      return { ok: false, errors: errors, warnings: warnings, rejected: rejected, data: null };
    }
    if (!Array.isArray(data.weeklyReviews)) {
      warnings.push('"weeklyReviews" was missing or malformed; starting with an empty review history.');
      data.weeklyReviews = [];
    }
    if (!isObject(data.meta)) {
      warnings.push('"meta" was missing; timestamps have been regenerated.');
      data.meta = { createdAt: nowISO(), updatedAt: nowISO() };
    }
    data.meta.createdAt = toISO(data.meta.createdAt) || nowISO();
    data.meta.updatedAt = toISO(data.meta.updatedAt) || nowISO();

    // ---- Cards -----------------------------------------------------
    var seenIds = Object.create(null);
    var cards = [];

    data.cards.forEach(function (rawCard, i) {
      var where = 'Card ' + (i + 1);

      if (!isObject(rawCard)) {
        rejected.push(where + ' is not an object and was left out.');
        return;
      }

      var title = typeof rawCard.title === 'string' ? rawCard.title.trim() : '';
      if (!title) {
        rejected.push(where + ' has no title and was left out.');
        return;
      }

      // Start from the raw object so unrecognised fields survive untouched.
      var card = copyFields(rawCard);

      card.title = title;

      var id = typeof rawCard.id === 'string' ? rawCard.id.trim() : '';
      if (!id) {
        id = uid();
        warnings.push(where + ' ("' + shorten(title) + '") had no id; one was generated.');
      } else if (seenIds[id]) {
        id = uid();
        warnings.push(where + ' ("' + shorten(title) + '") repeated an id already in use; it was given a new one.');
      }
      seenIds[id] = true;
      card.id = id;

      card.notes = typeof rawCard.notes === 'string' ? rawCard.notes : '';

      if (FF.LANE_IDS.indexOf(rawCard.lane) === -1) {
        warnings.push(where + ' ("' + shorten(title) + '") had an unrecognised lane "' +
          String(rawCard.lane).slice(0, 30) + '"; it was put in Inbox so you can re-file it.');
        card.lane = 'inbox';
      } else {
        card.lane = rawCard.lane;
      }

      var order = Number(rawCard.order);
      card.order = isFinite(order) ? order : i;

      card.createdAt = toISO(rawCard.createdAt);
      if (!card.createdAt) {
        card.createdAt = nowISO();
        warnings.push(where + ' ("' + shorten(title) + '") had no usable createdAt; it is dated today, so its age starts over.');
      }
      card.updatedAt = toISO(rawCard.updatedAt) || card.createdAt;
      card.completedAt = toISO(rawCard.completedAt);
      card.discardedAt = toISO(rawCard.discardedAt);
      // 'done' is never a meaningful sourceLane: it records where a card came
      // FROM when it was completed, and nothing is completed out of Done.
      card.sourceLane = (rawCard.sourceLane !== 'done' &&
                         FF.LANE_IDS.indexOf(rawCard.sourceLane) !== -1) ? rawCard.sourceLane : null;

      // Keep the two ways of saying "done" consistent with each other.
      if (card.lane === 'done' && !card.completedAt) {
        card.completedAt = card.updatedAt;
        warnings.push(where + ' ("' + shorten(title) + '") was in Done without a completion time; its last-updated time was used.');
      }
      if (card.lane !== 'done' && card.completedAt && !card.discardedAt) {
        card.lane = 'done';
        warnings.push(where + ' ("' + shorten(title) + '") had a completion time but was not in Done; it was moved to Done.');
      }

      cards.push(card);
    });

    data.cards = cards;

    // ---- Weekly reviews --------------------------------------------
    var seenWeeks = Object.create(null);
    var reviews = [];

    data.weeklyReviews.forEach(function (rawReview, i) {
      var where = 'Weekly review ' + (i + 1);

      if (!isObject(rawReview)) {
        rejected.push(where + ' is not an object and was left out.');
        return;
      }
      if (typeof rawReview.weekOf !== 'string' || !DATE_KEY_RE.test(rawReview.weekOf)) {
        rejected.push(where + ' has no usable "weekOf" date and was left out.');
        return;
      }
      if (seenWeeks[rawReview.weekOf]) {
        rejected.push(where + ' duplicates the week of ' + rawReview.weekOf + ' and was left out.');
        return;
      }
      seenWeeks[rawReview.weekOf] = true;

      var review = copyFields(rawReview);

      review.status = STATUSES.indexOf(rawReview.status) !== -1 ? rawReview.status : 'pending';
      review.completedAt = toISO(rawReview.completedAt);
      review.commitmentIds = Array.isArray(rawReview.commitmentIds)
        ? rawReview.commitmentIds.filter(function (x) { return typeof x === 'string'; })
        : [];
      review.deferrals = Array.isArray(rawReview.deferrals)
        ? rawReview.deferrals.map(toISO).filter(Boolean)
        : [];
      review.note = typeof rawReview.note === 'string' ? rawReview.note : '';

      reviews.push(review);
    });

    data.weeklyReviews = reviews.sort(function (a, b) {
      return a.weekOf < b.weekOf ? -1 : a.weekOf > b.weekOf ? 1 : 0;
    });

    data.app = C.APP_NAME;
    normalizeAll(data);

    return { ok: true, errors: errors, warnings: warnings, rejected: rejected, data: data };
  }

  /**
   * Copy every own field, including ones Forefront does not recognise.
   *
   * defineProperty rather than assignment because JSON.parse produces a real
   * own "__proto__" key when the text contains one, and plain assignment would
   * hand it to the prototype setter instead — silently losing the field and
   * changing the object's prototype. Neither is acceptable in the one function
   * that promises not to throw anything away.
   */
  function copyFields(source) {
    var out = {};
    Object.keys(source).forEach(function (k) {
      Object.defineProperty(out, k, {
        value: source[k], writable: true, enumerable: true, configurable: true
      });
    });
    return out;
  }

  function shorten(text) {
    return text.length > 40 ? text.slice(0, 37) + '…' : text;
  }

  /** Pretty JSON — this file is meant to be read by people and by assistants. */
  function serialize(data) { return JSON.stringify(data, null, 2); }

  // ------------------------------------------------------------------

  FF.model = {
    uid: uid,
    nowISO: nowISO,
    dayDiff: dayDiff,
    dateKey: dateKey,
    startOfDay: startOfDay,
    weekStart: weekStart,
    weekOf: weekOf,

    createEmptyData: createEmptyData,
    createCard: createCard,
    createReview: createReview,

    isActive: isActive,
    ageDays: ageDays,
    ageLabel: ageLabel,
    laneCards: laneCards,
    isRecentlyDone: isRecentlyDone,
    completedCards: completedCards,
    completedSince: completedSince,
    commitments: commitments,
    findCard: findCard,
    laneCounts: laneCounts,

    addCard: addCard,
    updateCard: updateCard,
    moveCard: moveCard,
    nudgeCard: nudgeCard,
    completeCard: completeCard,
    discardCard: discardCard,
    restoreCard: restoreCard,
    restoreLaneFor: restoreLaneFor,
    deleteCardForever: deleteCardForever,
    normalizeAll: normalizeAll,

    reviewFor: reviewFor,
    ensureReview: ensureReview,
    deferReview: deferReview,
    skipReview: skipReview,
    completeReview: completeReview,
    reviewState: reviewState,

    migrateData: migrateData,
    validateData: validateData,
    serialize: serialize
  };
})(window.FF);
