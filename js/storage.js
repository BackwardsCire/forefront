'use strict';

/**
 * Forefront — persistence.
 *
 * The awkward truth this file exists to handle: the app is meant to be opened
 * by double-clicking index.html, and it is meant to keep its data in a file you
 * choose (a OneDrive folder, say) — and browsers deliberately make those two
 * things hard to combine. Rather than pretend otherwise, Forefront probes what
 * the browser will actually let it do, uses the best available option, and says
 * plainly in the Data panel which one is in force.
 *
 * Two tiers, and the first is always on:
 *
 *   1. Browser storage (localStorage). Written synchronously after every change.
 *      Always the safety net, even when a file is connected.
 *   2. A connected JSON file, via the File System Access API. Written through
 *      after a short debounce. This is the human-readable, syncable, portable
 *      copy — the one you hand to an AI assistant.
 *
 * What is deliberately NOT here: any kind of merge or sync engine. Forefront
 * assumes one active writer. If a connected file changed underneath it, it
 * stops, says so, and lets you choose. It never silently overwrites.
 */

(function (FF) {
  var C = FF.C;
  var model = FF.model;

  // ------------------------------------------------------------------
  // Capability probing
  //
  // All of this is measured at runtime rather than inferred from the user
  // agent, because the answers differ between http(s) and file:// on the same
  // browser, and because they have changed over time.
  // ------------------------------------------------------------------

  var caps = {
    localStorage: false,
    indexedDB: false,       // needed only to remember a file between sessions
    filePicker: false,      // can choose a file to read
    fileSave: false,        // can choose a path to create
    fileWrite: false,       // can actually write back to a chosen file
    clipboard: false,
    download: false,
    secureContext: false,
    fileProtocol: (location.protocol === 'file:')
  };

  function probeLocalStorage() {
    try {
      var k = '__forefront_probe__';
      window.localStorage.setItem(k, '1');
      var read = window.localStorage.getItem(k);
      window.localStorage.removeItem(k);
      return read === '1';
    } catch (e) {
      // Safari in private browsing throws on setItem; some enterprise policies
      // block site data entirely.
      return false;
    }
  }

  /**
   * Is IndexedDB usable? Forefront needs it for exactly one thing: remembering
   * the handle on a connected data file, which cannot be persisted any other
   * way.
   *
   * It can fail by throwing, by firing onerror, or by never settling at all,
   * so all three are treated as "no" and the whole thing is bounded by a
   * timeout. Nothing waits on this — it runs after first paint.
   */
  function probeIndexedDB() {
    return new Promise(function (resolve) {
      var settled = false;
      function done(v) { if (!settled) { settled = true; resolve(v); } }
      var timer = setTimeout(function () { done(false); }, 1500);

      try {
        if (!window.indexedDB) { clearTimeout(timer); return done(false); }
        var req = window.indexedDB.open(C.IDB_NAME, 1);
        req.onupgradeneeded = function () {
          try {
            var db = req.result;
            if (!db.objectStoreNames.contains(C.IDB_STORE)) db.createObjectStore(C.IDB_STORE);
          } catch (e) { /* handled by onerror */ }
        };
        req.onsuccess = function () {
          clearTimeout(timer);
          try { req.result.close(); } catch (e) {}
          done(true);
        };
        req.onerror = function () { clearTimeout(timer); done(false); };
        req.onblocked = function () { clearTimeout(timer); done(false); };
      } catch (e) {
        clearTimeout(timer);
        done(false);
      }
    });
  }

  function probeSync() {
    caps.secureContext = !!window.isSecureContext;
    caps.localStorage = probeLocalStorage();
    caps.filePicker = typeof window.showOpenFilePicker === 'function';
    caps.fileSave = typeof window.showSaveFilePicker === 'function';

    // Picking a file and writing to it are separate capabilities. Safari can
    // hand you a FileSystemFileHandle without giving you createWritable, so
    // checking for the picker alone would over-promise.
    caps.fileWrite = caps.filePicker &&
      typeof window.FileSystemFileHandle === 'function' &&
      typeof window.FileSystemFileHandle.prototype.createWritable === 'function';

    caps.clipboard = !!(navigator.clipboard && navigator.clipboard.writeText);
    caps.download = 'download' in document.createElement('a');
  }

  // ------------------------------------------------------------------
  // IndexedDB: the one thing it is used for is remembering a file handle,
  // which is the only way to persist one (handles are structured-cloneable
  // but not serialisable to a string).
  // ------------------------------------------------------------------

  function idb() {
    return new Promise(function (resolve, reject) {
      var req = window.indexedDB.open(C.IDB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(C.IDB_STORE)) db.createObjectStore(C.IDB_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function idbPut(key, value) {
    if (!caps.indexedDB) return Promise.resolve(false);
    return idb().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(C.IDB_STORE, 'readwrite');
        tx.objectStore(C.IDB_STORE).put(value, key);
        tx.oncomplete = function () { db.close(); resolve(true); };
        tx.onerror = function () { db.close(); resolve(false); };
      });
    }).catch(function () { return false; });
  }

  function idbGet(key) {
    if (!caps.indexedDB) return Promise.resolve(null);
    return idb().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(C.IDB_STORE, 'readonly');
        var req = tx.objectStore(C.IDB_STORE).get(key);
        req.onsuccess = function () { db.close(); resolve(req.result || null); };
        req.onerror = function () { db.close(); resolve(null); };
      });
    }).catch(function () { return null; });
  }

  function idbDelete(key) {
    if (!caps.indexedDB) return Promise.resolve(false);
    return idb().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(C.IDB_STORE, 'readwrite');
        tx.objectStore(C.IDB_STORE).delete(key);
        tx.oncomplete = function () { db.close(); resolve(true); };
        tx.onerror = function () { db.close(); resolve(false); };
      });
    }).catch(function () { return false; });
  }

  // ------------------------------------------------------------------
  // Browser-storage tier
  // ------------------------------------------------------------------

  /**
   * A note on browser storage under file://.
   *
   * Chrome gives every page loaded from disk the same origin — the literal
   * string "file://", not one origin per path. Two consequences, both verified
   * rather than assumed:
   *
   *   Good: moving or renaming the Forefront folder does not lose your data,
   *   because the storage was never tied to the path.
   *
   *   Bad: every other local HTML file you open in the same browser shares that
   *   storage area and can read these keys. That is why the keys are namespaced,
   *   why nothing sensitive should live only here, and why connecting a real
   *   data file is the right answer for work you care about. It is a property of
   *   the browser, not something Forefront can fix.
   */
  function localWrite(json) {
    if (!caps.localStorage) {
      return { ok: false, error: 'This browser is not allowing Forefront to store data locally. Nothing has been saved. Export your data before closing this tab.' };
    }
    try {
      window.localStorage.setItem(C.LS_KEY, json);
      return { ok: true };
    } catch (e) {
      var quota = e && (e.name === 'QuotaExceededError' || e.code === 22);
      return {
        ok: false,
        error: quota
          ? 'Browser storage is full, so this change was not saved. Export your data now, then clear space.'
          : 'Forefront could not save to browser storage (' + (e && e.name ? e.name : 'unknown error') + '). This change is not stored.'
      };
    }
  }

  /**
   * Read the browser copy.
   *
   * Returns { data, corrupt }. The distinction matters: unreadable stored data
   * must never be mistaken for a first run, because the difference between
   * those two on screen is an empty board either way — and the very next save
   * would write over whatever was still recoverable.
   */
  function localRead() {
    if (!caps.localStorage) return { data: null, corrupt: false };
    var raw = null;
    try {
      raw = window.localStorage.getItem(C.LS_KEY);
    } catch (e) {
      return { data: null, corrupt: false };
    }
    if (!raw) return { data: null, corrupt: false };
    try {
      return { data: JSON.parse(raw), corrupt: false };
    } catch (e) {
      // Keep the unreadable original before anything can overwrite it.
      writeBackup(raw);
      return { data: null, corrupt: true };
    }
  }

  /** Keep one generation of the previous dataset before a wholesale import. */
  function writeBackup(json) {
    if (!caps.localStorage) return false;
    try {
      window.localStorage.setItem(C.LS_BACKUP_KEY, json);
      return true;
    } catch (e) {
      return false; // a missing backup must never block the import itself
    }
  }

  function readBackup() {
    if (!caps.localStorage) return null;
    try { return window.localStorage.getItem(C.LS_BACKUP_KEY); } catch (e) { return null; }
  }

  // ------------------------------------------------------------------
  // Connected-file tier
  // ------------------------------------------------------------------

  var handle = null;          // FileSystemFileHandle, when connected
  var fileStamp = null;       // { lastModified, size } as of our last read/write
  var fileName = null;
  var needsReconnect = false; // handle remembered, but permission must be re-granted
  var writeTimer = null;
  var pendingJSON = null;
  // Incremented whenever the user deliberately chooses a different source of
  // truth. A failed write resolves asynchronously; without this generation it
  // could put its stale payload back after that choice had already been made.
  var pendingGeneration = 0;
  var listeners = {};

  function emit(name, payload) {
    (listeners[name] || []).forEach(function (fn) {
      try { fn(payload); } catch (e) { /* a bad listener must not break saving */ }
    });
  }

  function on(name, fn) {
    (listeners[name] || (listeners[name] = [])).push(fn);
  }

  function stampOf(file) {
    return { lastModified: file.lastModified, size: file.size };
  }

  function sameStamp(a, b) {
    return !!a && !!b && a.lastModified === b.lastModified && a.size === b.size;
  }

  /**
   * Has the connected file changed since Forefront last read or wrote it?
   * lastModified plus size is not a cryptographic guarantee, but it reliably
   * catches the case that matters: a sync client or an editor rewrote the file
   * while Forefront had it open.
   */
  function fileChangedExternally() {
    if (!handle) return Promise.resolve(false);
    return handle.getFile().then(function (file) {
      return !sameStamp(stampOf(file), fileStamp);
    }).catch(function () {
      return false; // if we cannot check, do not invent a conflict
    });
  }

  function readHandle() {
    return handle.getFile().then(function (file) {
      return file.text().then(function (text) {
        return { text: text, stamp: stampOf(file), name: file.name };
      });
    });
  }

  /**
   * Write to the connected file, unless it changed underneath us.
   *
   * The target handle is captured up front and re-checked after every await:
   * a write can be in flight when the user connects a different file, and a
   * write aimed at one file must never land in another.
   */
  function writeHandle(json) {
    var target = handle;
    var targetName = fileName;

    function stillCurrent() { return handle === target; }

    return fileChangedExternally().then(function (changed) {
      if (!stillCurrent()) return { ok: false, superseded: true };
      if (changed) {
        emit('conflict', { fileName: targetName });
        return { ok: false, conflict: true,
                 error: 'The connected file changed outside Forefront, so it was not overwritten.' };
      }
      return target.createWritable().then(function (w) {
        return w.write(json).then(function () { return w.close(); });
      }).then(function () {
        return target.getFile();
      }).then(function (file) {
        if (!stillCurrent()) return { ok: false, superseded: true };
        fileStamp = stampOf(file);
        emit('filesaved', { fileName: targetName, at: new Date() });
        return { ok: true };
      });
    }).catch(function (e) {
      if (!stillCurrent()) return { ok: false, superseded: true };
      var msg = e && e.name === 'NotAllowedError'
        ? 'Forefront no longer has permission to write to the connected file. Reconnect it from the Data panel.'
        : 'Forefront could not write to the connected file (' + (e && e.name ? e.name : 'unknown error') + ').';
      if (e && e.name === 'NotAllowedError') needsReconnect = true;
      emit('fileerror', { message: msg });
      return { ok: false, error: msg };
    });
  }

  var writeInFlight = null;

  function scheduleFileWrite(json) {
    pendingJSON = json;
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = setTimeout(function () {
      writeTimer = null;
      drainPending();
    }, C.FILE_WRITE_DEBOUNCE_MS);
  }

  /**
   * Write whatever is pending, one write at a time.
   *
   * Serialising matters: fileStamp is only refreshed once a write completes, so
   * a second write starting while the first is still open would compare against
   * a stale stamp, decide the file had been changed by somebody else, and
   * report a conflict that never happened.
   *
   * A payload that fails to write is put back rather than discarded, so the
   * next flush retries it instead of silently leaving the file behind.
   */
  function drainPending() {
    if (writeInFlight) return writeInFlight;
    if (!pendingJSON || !handle || needsReconnect) return Promise.resolve({ ok: true });

    var payload = pendingJSON;
    var generation = pendingGeneration;
    pendingJSON = null;

    writeInFlight = writeHandle(payload).then(function (res) {
      writeInFlight = null;
      // The user accepted another version while this write was settling. Its
      // payload belongs to the board they explicitly chose to replace.
      if (generation !== pendingGeneration) return { ok: false, superseded: true };
      // A superseded write belonged to a file that is no longer connected.
      // Retrying it would push the old board into the new file.
      if (res.superseded) return res;
      if (!res.ok && !pendingJSON) pendingJSON = payload; // keep it for the retry
      if (pendingJSON && res.ok) return drainPending();   // more arrived meanwhile
      return res;
    }).catch(function (e) {
      writeInFlight = null;
      if (generation !== pendingGeneration) return { ok: false, superseded: true };
      if (!pendingJSON) pendingJSON = payload;
      return { ok: false, error: String(e) };
    });

    return writeInFlight;
  }

  /** Write any debounced change through immediately. */
  function flush() {
    if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
    if (writeInFlight) return writeInFlight.then(function () { return drainPending(); });
    return drainPending();
  }

  /** Is there a change that has not reached the connected file? */
  function hasUnwrittenChanges() { return !!pendingJSON || !!writeInFlight; }

  /**
   * Forget queued writes because the user accepted a different version.
   *
   * This is intentionally separate from reloadFromFile(): reading a file does
   * not mean the caller has decided to adopt it. The app calls this only after
   * validation, at the moment the file becomes the source of truth.
   */
  function discardPendingFileWrites() {
    pendingGeneration++;
    if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
    pendingJSON = null;
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  /**
   * Load what we can synchronously, and return it immediately.
   *
   * Forefront is meant to be a browser start page, so first paint must not wait
   * on anything at all. It doesn't: browser storage is synchronous, so the
   * board is on screen in the same tick. Everything asynchronous — probing
   * IndexedDB, restoring a remembered file, checking its permission, reading
   * it — happens afterwards, in resume(), and only redraws if it actually
   * found something different.
   *
   * Keeping those apart matters because the async half is genuinely allowed to
   * be slow. A permission check can block on the browser, a data file may live
   * on a network drive or a sleeping disk, and a storage probe can time out.
   * None of that should be able to delay the page appearing.
   */
  function begin() {
    probeSync();
    var read = localRead();
    var notes = read.corrupt
      ? ['Forefront could not read the data stored in this browser, so it has started with an empty board. The unreadable data has been kept and can be recovered from the Data panel.']
      : [];
    return finishLoad(read.data, 'local', notes);
  }

  /**
   * The asynchronous half: find a remembered data file, and load from it if we
   * still have permission. Resolves with null when there is nothing to change,
   * or with a replacement dataset for the app to adopt.
   *
   * A remembered handle can only be checked with queryPermission here, because
   * requestPermission needs a user gesture and a page load is not one. When
   * permission has lapsed, Forefront keeps working from browser storage and
   * offers a Reconnect button rather than quietly dropping the connection.
   */
  function resume() {
    // Always probe rather than infer from the protocol. IndexedDB on file://
    // is widely believed to be blocked, and in current Chrome it simply is not
    // — it works, so a data file really can be remembered between sessions
    // even when Forefront is opened by double-clicking index.html. Other
    // browsers differ, and may change again; asking costs nothing here because
    // this all runs after the page is already on screen.
    return ensureIDB().then(function (hasIDB) {
      return caps.fileWrite && hasIDB ? idbGet('dataFile') : null;
    }).then(function (saved) {
      if (!saved) return null;
      handle = saved;
      fileName = saved.name || C.DEFAULT_FILENAME;
      if (typeof handle.queryPermission !== 'function') return handle;
      return handle.queryPermission({ mode: 'readwrite' }).then(function (state) {
        if (state === 'granted') return handle;
        needsReconnect = true;
        return null;
      }).catch(function () { needsReconnect = true; return null; });
    }).then(function (live) {
      if (!live) return needsReconnect ? { needsReconnect: true, fileName: fileName } : null;

      return readHandle().then(function (res) {
        fileStamp = res.stamp;
        fileName = res.name;

        var parsed;
        try {
          parsed = res.text.trim() ? JSON.parse(res.text) : null;
        } catch (e) {
          return { notes: ['The connected file ' + fileName + ' is not valid JSON, so Forefront is using its browser copy instead. The file has not been touched.'] };
        }

        // An empty file: keep what is on screen and let the next save fill it.
        if (!parsed) return { fileName: fileName, adopted: false };

        return { fileName: fileName, data: parsed, adopted: true };
      }).catch(function () {
        return { notes: ['Forefront could not read the connected data file, so it is using its browser copy. The file has not been changed.'] };
      });
    }).catch(function () {
      return null;
    });
  }

  function finishLoad(candidate, source, notes) {
    if (!candidate) {
      return { data: model.createEmptyData(), source: source, fresh: true, notes: notes || [], report: null };
    }
    var result = model.validateData(candidate);
    if (!result.ok) {
      // Stored data we cannot read is kept, not discarded — start clean but
      // leave the original in the backup slot so nothing is destroyed.
      var raw = null;
      try { raw = JSON.stringify(candidate); } catch (e) {}
      if (raw) writeBackup(raw);
      return {
        data: model.createEmptyData(), source: source, fresh: true,
        notes: (notes || []).concat(result.errors).concat([
          'Forefront started with an empty board. Your previous data was kept and can be recovered from the Data panel.'
        ]),
        report: result
      };
    }
    return {
      data: result.data, source: source, fresh: false,
      notes: notes || [], report: result
    };
  }

  /**
   * Persist a dataset. The browser copy is written synchronously and its result
   * is returned at once, so the UI can tell the truth immediately about whether
   * a change was stored. The file write-through is debounced and reports
   * separately through the 'filesaved' / 'fileerror' / 'conflict' events.
   */
  /**
   * Persist a dataset across both tiers.
   *
   * The return value answers one question: has this change been accepted
   * somewhere it will survive? If browser storage is blocked but a data file is
   * connected and healthy, the answer is yes — the change is queued for the
   * file. Reporting a flat failure there would be wrong twice over: it would be
   * untrue, and it would make Quick Capture hold its dialog open so the user
   * retypes a card that was in fact already saved.
   */
  function save(data, opts) {
    var json;
    try {
      json = model.serialize(data);
    } catch (e) {
      return { ok: false, error: 'Forefront could not turn the current board into JSON, so nothing was saved.' };
    }

    var local = localWrite(json);
    // localOnly is for data that just came out of the connected file: writing
    // it straight back would only bump the file's timestamp and, on a synced
    // folder, upload an identical copy.
    var toFile = !!handle && !needsReconnect && !(opts && opts.localOnly);

    if (toFile) scheduleFileWrite(json);

    if (local.ok) return { ok: true };

    if (toFile) {
      return {
        ok: true,
        warning: 'This browser is not storing a local copy (' + local.error +
                 ') — your changes are going only to ' + fileName + '.'
      };
    }

    return local;
  }

  // ---- file connection ----
  //
  // Connecting is deliberately two-phase. pickFile() opens the picker and reads
  // what is there, but changes nothing; useHandle() is what actually installs
  // the connection. Doing it in one step meant that a user who picked the wrong
  // file and then said "no, don't load that" had already lost the connection to
  // the file they had been using — the cancel path had nothing to restore.

  var PICKER_OPTS = {
    types: [{ description: 'Forefront data', accept: { 'application/json': ['.json'] } }],
    excludeAcceptAllOption: false,
    multiple: false
  };

  /** Probe IndexedDB once, and let anyone who needs the answer wait for it. */
  var idbProbe = null;
  function ensureIDB() {
    if (!idbProbe) {
      idbProbe = probeIndexedDB().then(function (ok) { caps.indexedDB = ok; return ok; });
    }
    return idbProbe;
  }

  /**
   * Remember a handle so the file reopens next session. Waits for the probe
   * rather than reading caps.indexedDB, which is still false during the first
   * moments after load and would silently skip remembering.
   */
  function rememberHandle(h) {
    return ensureIDB().then(function (ok) {
      return ok ? idbPut('dataFile', h) : false;
    });
  }

  function readFrom(h) {
    return h.getFile().then(function (file) {
      return file.text().then(function (text) {
        var parsed = null, invalid = false;
        if (text.trim()) {
          try { parsed = JSON.parse(text); } catch (e) { invalid = true; }
        }
        return { file: file, text: text, parsed: parsed, invalid: invalid, stamp: stampOf(file), name: file.name };
      });
    });
  }

  function writeTo(h, json) {
    return h.createWritable().then(function (w) {
      return w.write(json).then(function () { return w.close(); });
    });
  }

  /** Open the picker and read the file. Changes nothing. */
  function pickFile() {
    if (!caps.fileWrite) {
      return Promise.resolve({ ok: false, error: 'This browser cannot connect to a data file. Use Export and Import instead.' });
    }
    return window.showOpenFilePicker(PICKER_OPTS).then(function (handles) {
      var picked = handles[0];
      return readFrom(picked).then(function (res) {
        if (res.invalid) {
          return { ok: false, error: 'That file is not valid JSON, so Forefront did not connect to it. It has not been modified.' };
        }
        return {
          ok: true, handle: picked, file: res.file, stamp: res.stamp,
          data: res.parsed, empty: !res.parsed, fileName: res.name
        };
      });
    }).catch(function (e) {
      if (e && e.name === 'AbortError') return { ok: false, cancelled: true };
      return { ok: false, error: 'Forefront could not open that file (' + (e && e.name ? e.name : 'unknown error') + ').' };
    });
  }

  /** Open the save picker. Creates the file but does not connect to it yet. */
  function pickNewFile() {
    if (!caps.fileSave || !caps.fileWrite) {
      return Promise.resolve({ ok: false, error: 'This browser cannot create a data file. Use Export to download your JSON instead.' });
    }
    return window.showSaveFilePicker({
      suggestedName: C.DEFAULT_FILENAME,
      types: PICKER_OPTS.types
    }).then(function (picked) {
      return picked.getFile().then(function (file) {
        return { ok: true, handle: picked, file: file, stamp: stampOf(file), fileName: file.name };
      });
    }).catch(function (e) {
      if (e && e.name === 'AbortError') return { ok: false, cancelled: true };
      return { ok: false, error: 'Forefront could not create that file (' + (e && e.name ? e.name : 'unknown error') + ').' };
    });
  }

  /**
   * Install a picked handle as the live connection.
   *
   * `seedWith` writes a dataset into the file straight away — used when
   * creating a new file, or adopting one that turned out to be empty. Nothing
   * is remembered until the write, if any, has actually succeeded.
   */
  function useHandle(picked, stamp, name, seedWith) {
    var previous = { handle: handle, fileStamp: fileStamp, fileName: fileName, needsReconnect: needsReconnect };

    // Drop anything still queued for the file we are leaving. That payload is
    // the previous board; letting it drain after the switch would write it
    // straight over the file we are connecting to. Bumping the generation also
    // disowns a write already in flight, so the two guards — this one and
    // writeHandle's handle check — cover the same hazard from both directions.
    pendingGeneration++;
    if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
    pendingJSON = null;

    handle = picked;
    fileStamp = stamp;
    fileName = name;
    needsReconnect = false;

    function restore() {
      handle = previous.handle;
      fileStamp = previous.fileStamp;
      fileName = previous.fileName;
      needsReconnect = previous.needsReconnect;
    }

    var seeded = seedWith
      ? writeTo(picked, seedWith).then(function () { return picked.getFile(); })
          .then(function (file) { fileStamp = stampOf(file); emit('filesaved', { fileName: name, at: new Date() }); })
      : Promise.resolve();

    return seeded.then(function () {
      return rememberHandle(picked);
    }).then(function (remembered) {
      return { ok: true, fileName: name, remembered: remembered };
    }).catch(function (e) {
      restore(); // leave the previous connection exactly as it was
      return { ok: false, error: 'Forefront could not write to ' + name +
                                ' (' + (e && e.name ? e.name : 'unknown error') + '). Nothing has been changed.' };
    });
  }

  /**
   * Re-grant permission on a remembered handle. Must be called from a click.
   * Returns the file's contents; whether to adopt them is the caller's call,
   * because a session's worth of work may have happened since.
   */
  function reconnect() {
    if (!handle) return Promise.resolve({ ok: false, error: 'No remembered data file.' });

    function afterGrant() {
      needsReconnect = false;
      return readFrom(handle).then(function (res) {
        fileStamp = res.stamp;
        fileName = res.name;
        return { ok: true, data: res.parsed, invalid: res.invalid, fileName: res.name };
      });
    }

    if (typeof handle.requestPermission !== 'function') return afterGrant();

    return handle.requestPermission({ mode: 'readwrite' }).then(function (state) {
      if (state !== 'granted') {
        return { ok: false, error: 'Permission was not granted, so the data file is still disconnected.' };
      }
      return afterGrant();
    }).catch(function (e) {
      return { ok: false, error: 'Reconnecting failed (' + (e && e.name ? e.name : 'unknown error') + ').' };
    });
  }

  /** Re-read the connected file, discarding nothing — the caller decides. */
  function reloadFromFile() {
    if (!handle) return Promise.resolve({ ok: false, error: 'No data file is connected.' });
    return readFrom(handle).then(function (res) {
      if (res.invalid) return { ok: false, error: 'The connected file is not valid JSON. Nothing was changed.' };
      fileStamp = res.stamp;
      return { ok: true, data: res.parsed, fileName: res.name };
    }).catch(function (e) {
      return { ok: false, error: 'Could not read the connected file (' + (e && e.name ? e.name : 'unknown error') + ').' };
    });
  }

  /** The connected file's current text, for keeping a copy before overwriting it. */
  function readFileText() {
    if (!handle) return Promise.resolve(null);
    return readFrom(handle).then(function (res) { return res.text; }).catch(function () { return null; });
  }

  /** Deliberately overwrite a file that changed externally. */
  function forceWrite(data) {
    if (!handle) return Promise.resolve({ ok: false, error: 'No data file is connected.' });
    var json = model.serialize(data);
    return writeTo(handle, json).then(function () {
      return handle.getFile();
    }).then(function (file) {
      fileStamp = stampOf(file);
      pendingJSON = null;             // this write supersedes anything queued
      emit('filesaved', { fileName: fileName, at: new Date() });
      return { ok: true };
    }).catch(function (e) {
      return { ok: false, error: 'Forefront could not write to ' + (fileName || 'the data file') +
                                ' (' + (e && e.name ? e.name : 'unknown error') + ').' };
    });
  }

  function disconnect() {
    handle = null;
    fileStamp = null;
    fileName = null;
    needsReconnect = false;
    if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
    pendingJSON = null;

    // Report a failure to forget rather than claiming success: a handle still
    // in IndexedDB means the file quietly reconnects next session, which is
    // exactly what someone disconnecting a shared or private file does not want.
    return ensureIDB().then(function (ok) {
      if (!ok) return { ok: true };
      return idbDelete('dataFile').then(function (deleted) {
        return deleted ? { ok: true } : {
          ok: false,
          error: 'Forefront stopped using the file, but could not forget it — it may reconnect next time this browser opens Forefront.'
        };
      });
    });
  }

  function status() {
    return {
      caps: caps,
      connected: !!handle && !needsReconnect,
      remembered: !!handle,
      needsReconnect: needsReconnect,
      fileName: fileName,
      canRememberFile: caps.fileWrite && caps.indexedDB,
      hasBackup: !!readBackup()
    };
  }

  FF.storage = {
    begin: begin,
    resume: resume,
    save: save,
    flush: flush,
    caps: caps,
    status: status,
    on: on,

    pickFile: pickFile,
    pickNewFile: pickNewFile,
    useHandle: useHandle,
    reconnect: reconnect,
    reloadFromFile: reloadFromFile,
    readFileText: readFileText,
    forceWrite: forceWrite,
    disconnect: disconnect,
    fileChangedExternally: fileChangedExternally,
    hasUnwrittenChanges: hasUnwrittenChanges,
    discardPendingFileWrites: discardPendingFileWrites,

    writeBackup: writeBackup,
    readBackup: readBackup
  };
})(window.FF);
