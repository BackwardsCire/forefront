'use strict';

/**
 * Forefront — the Data panel.
 *
 * Deliberately out of the way, and deliberately complete. This is where you get
 * your JSON out to hand to an assistant, get the groomed version back in, point
 * Forefront at a file in a synced folder, and — importantly — read a straight
 * answer about where your data actually lives in this browser right now.
 *
 * The export is the whole dataset, always: open cards, the Inbox, completed
 * work well past the point it left the board, discarded work, ordering,
 * timestamps, review history, metadata, schema version. It is a backup, not a
 * task list. The one thing it cannot carry is the browser's handle on a
 * connected file, because that is a permission this browser granted to this
 * machine, not a fact about your work.
 */

(function (FF) {
  var ui = FF.ui;
  var el = ui.el;
  var model = FF.model;
  var C = FF.C;

  function open(app) {
    ui.openDialog({
      className: 'dialog--data',
      labelledBy: 'data-title',
      build: function (close) {
        return el('div', { class: 'dialog__body data-panel' }, [
          el('div', { class: 'dialog__head' }, [
            el('h2', { class: 'dialog__title', id: 'data-title', text: 'Data' }),
            el('button', { type: 'button', class: 'dialog__close', 'aria-label': 'Close', text: '×', onclick: function () { close(); } })
          ]),
          renderWhereItLives(app, close),
          renderExport(app),
          renderImport(app, close),
          renderDiscarded(app, close)
        ]);
      }
    });
  }

  // ------------------------------------------------------------------
  // Where the data lives — the honest readout
  // ------------------------------------------------------------------

  function renderWhereItLives(app, close) {
    var s = FF.storage.status();
    var caps = s.caps;
    var rows = [];

    if (s.connected) {
      rows.push(line('Data file', s.fileName, 'ok'));
      rows.push(note(s.canRememberFile
        ? 'Forefront will reopen this file automatically next time.'
        : 'This browser cannot remember the file between sessions — you will need to reconnect it each time you open Forefront. That is a limitation of pages opened directly from disk, not of Forefront.'));
    } else if (s.needsReconnect) {
      rows.push(line('Data file', s.fileName + ' — permission needed', 'warn'));
    } else {
      rows.push(line('Data file', 'None connected', 'muted'));
    }

    rows.push(line('Browser storage',
      caps.localStorage ? 'Working, used as the safety copy' : 'Blocked by this browser',
      caps.localStorage ? 'ok' : 'bad'));

    if (!caps.localStorage) {
      rows.push(note(caps.fileProtocol
        ? 'This browser refuses storage for pages opened directly from disk. On macOS, use start-mac.command to run Forefront on localhost instead.'
        : 'Your browser is blocking site data. Private browsing and some managed policies do this.'));
    } else if (caps.fileProtocol) {
      // Every page opened from disk shares one storage area in Chrome — the
      // origin is the bare string "file://". Worth saying plainly, because it
      // is the real reason to connect a file rather than rely on this.
      rows.push(note('Forefront is running from a file on disk. Browser storage for local files is shared with every other local page you open in this browser, so it is not a private place to keep work information. Connecting a data file keeps your data out of it.'));
      rows.push(note('Browser storage can also be cleared by the browser itself under disk pressure, or by "clear browsing data". Treat it as a safety copy, not a backup.'));
    }

    var actions = [];

    if (s.needsReconnect) {
      actions.push(btn('Reconnect ' + s.fileName, 'primary', function () {
        close();
        app.reconnectFile();
      }));
    }

    if (caps.fileWrite && !s.connected) {
      actions.push(btn('Connect a data file…', s.needsReconnect ? 'quiet' : 'primary', function () {
        connectExisting(app, close);
      }));
      actions.push(btn('Create a new data file…', 'quiet', function () {
        createNew(app, close);
      }));
    }

    if (s.connected) {
      actions.push(btn('Reload from file', 'quiet', function () {
        FF.storage.reloadFromFile().then(function (res) {
          if (!res.ok) return ui.toast(res.error, 'error');
          close();
          // Explicitly asked for, and the outgoing board is kept recoverable.
          app.adoptFromFile(res.data, res.fileName, { force: true });
        });
      }));
      actions.push(btn('Disconnect', 'faint', function () {
        ui.confirmDialog({
          title: 'Disconnect the data file?',
          message: 'Forefront will keep working from browser storage. The file itself is left exactly as it is.',
          confirmLabel: 'Disconnect'
        }).then(function (yes) {
          if (!yes) return;
          FF.storage.disconnect().then(function (res) {
            close();
            ui.toast(res.ok ? 'Data file disconnected' : res.error, res.ok ? 'info' : 'error');
            app.refresh();
          });
        });
      }));
    }

    if (!caps.fileWrite) {
      rows.push(note('Forefront is fully usable with browser storage in this browser. Directly connected JSON files are a Chrome enhancement; use Export and Import below for a portable backup.'));
    }

    return section('Where your data lives', rows.concat(
      actions.length ? [el('div', { class: 'data-panel__actions' }, actions)] : []
    ));
  }

  /**
   * Connect an existing file.
   *
   * Picking and connecting are separate steps: the file is read first and only
   * installed once the user has agreed to what it will do. Backing out here
   * leaves whatever was connected before completely untouched.
   */
  function connectExisting(app, close) {
    FF.storage.pickFile().then(function (res) {
      if (res.cancelled) return;
      if (!res.ok) return ui.toast(res.error, 'error');

      function install(seed) {
        FF.storage.useHandle(res.handle, res.stamp, res.fileName, seed).then(function (r) {
          if (!r.ok) return ui.toast(r.error, 'error');
          close();
          if (seed) {
            ui.toast('Now saving to ' + res.fileName, 'ok');
            app.refresh();
          } else {
            // The user has just confirmed exactly what this replaces.
            app.adoptFromFile(res.data, res.fileName, { force: true });
          }
          warnIfNotRemembered(r);
        });
      }

      // A blank file: keep what is on screen and fill it.
      if (res.empty) return install(model.serialize(app.getData()));

      var mine = app.getData().cards.length;
      if (!mine) return install(null);

      ui.confirmDialog({
        title: 'Load ' + res.fileName + '?',
        message: 'That file has its own cards. Loading it replaces the ' + mine +
                 (mine === 1 ? ' card' : ' cards') + ' currently open here. A copy of the current board is kept and can be recovered from this panel.',
        confirmLabel: 'Load the file'
      }).then(function (yes) {
        if (yes) install(null);
        // Declining changes nothing at all — no connection was made yet.
      });
    });
  }

  function createNew(app, close) {
    FF.storage.pickNewFile().then(function (res) {
      if (res.cancelled) return;
      if (!res.ok) return ui.toast(res.error, 'error');

      FF.storage.useHandle(res.handle, res.stamp, res.fileName, model.serialize(app.getData()))
        .then(function (r) {
          if (!r.ok) return ui.toast(r.error, 'error');
          close();
          ui.toast('Now saving to ' + res.fileName, 'ok');
          warnIfNotRemembered(r);
          app.refresh();
        });
    });
  }

  function warnIfNotRemembered(r) {
    if (!r.remembered) {
      ui.toast('Connected. This browser will not remember the file, so reconnect it next session.', 'info');
    }
  }

  // ------------------------------------------------------------------
  // Export
  // ------------------------------------------------------------------

  function renderExport(app) {
    var data = app.getData();
    var stats = summarize(data);

    return section('Export', [
      el('p', { class: 'data-panel__lede', text:
        'One file with everything in it: ' + stats + '. Enough to restore Forefront exactly on another computer, and readable enough to hand to an AI assistant for grooming.' }),
      el('div', { class: 'data-panel__actions' }, [
        btn('Download JSON', 'primary', function () { downloadJSON(app.getData()); }),
        btn('Copy to clipboard', 'quiet', function () { copyJSON(app.getData()); })
      ]),

      // The annotated pair. Strict JSON has no comments, so an annotated file
      // is not valid JSON — which would normally make it useless. It is useful
      // here because Import strips comments on the way back in, so the file
      // that explains itself is also the file you can hand back.
      note('An annotated copy carries the whole format in comments — the lanes, what a card needs, ' +
           'and what Forefront deliberately has no field for. It is the thing to paste into a chat ' +
           'along with "add these to my board". Comments are stripped when you import it back.'),
      el('div', { class: 'data-panel__actions' }, [
        btn('Copy annotated', 'quiet', function () {
          copyText(model.annotate(app.getData()), 'Annotated JSON copied to clipboard');
        }),
        btn('Download annotated', 'quiet', function () {
          downloadText(model.annotate(app.getData()), 'forefront-' + model.dateKey(new Date()) + '.jsonc');
        }),
        btn('Blank template', 'faint', function () {
          downloadText(model.annotate(model.createEmptyData()), 'forefront-template.jsonc');
        })
      ])
    ]);
  }

  function summarize(data) {
    var active = data.cards.filter(function (c) { return model.isActive(c) && !c.completedAt; }).length;
    var done = data.cards.filter(function (c) { return c.completedAt && model.isActive(c); }).length;
    var dropped = data.cards.filter(function (c) { return c.discardedAt; }).length;
    var parts = [
      active + (active === 1 ? ' open card' : ' open cards'),
      done + ' completed',
      dropped + ' discarded',
      data.weeklyReviews.length + (data.weeklyReviews.length === 1 ? ' weekly review' : ' weekly reviews')
    ];
    return parts.join(', ');
  }

  function exportFilename() {
    return 'forefront-' + model.dateKey(new Date()) + '.json';
  }

  function downloadJSON(data) { downloadText(model.serialize(data), exportFilename()); }

  function downloadText(text, filename) {
    try {
      var blob = new Blob([text], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = el('a', { href: url, download: filename });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revoking immediately can cut the download short in some browsers.
      setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
      ui.toast('Exported ' + filename, 'ok');
    } catch (e) {
      ui.toast('Download failed. Use "Copy to clipboard" instead.', 'error');
    }
  }

  function copyJSON(data) { copyText(model.serialize(data), 'JSON copied to clipboard'); }

  function copyText(json, successMessage) {

    function fallback() {
      // execCommand is deprecated but is the only route when the async
      // clipboard API is unavailable, which happens on some file:// pages.
      try {
        var area = el('textarea', { value: json, class: 'sr-only' });
        document.body.appendChild(area);
        area.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(area);
        ui.toast(ok ? successMessage : 'Could not copy — use Download instead.', ok ? 'ok' : 'error');
      } catch (e) {
        ui.toast('Could not copy — use Download instead.', 'error');
      }
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(json)
        .then(function () { ui.toast(successMessage, 'ok'); })
        .catch(fallback);
    } else {
      fallback();
    }
  }

  // ------------------------------------------------------------------
  // Import
  // ------------------------------------------------------------------

  function renderImport(app, close) {
    var textarea = el('textarea', {
      class: 'data-panel__paste',
      rows: '6',
      placeholder: 'Paste Forefront JSON here…',
      'aria-label': 'Paste Forefront JSON'
    });

    var fileInput = el('input', {
      type: 'file', accept: '.json,.jsonc,application/json', class: 'sr-only',
      onchange: function () {
        var file = fileInput.files && fileInput.files[0];
        if (!file) return;
        file.text().then(function (text) {
          attemptImport(app, text, close, file.name);
          fileInput.value = '';
        }).catch(function () {
          ui.toast('Could not read that file.', 'error');
        });
      }
    });

    var rows = [
      el('p', { class: 'data-panel__lede', text:
        'Imported data is checked before anything changes, and the current board is kept as a recoverable copy first. You choose then whether to add the cards to your board or replace it.' }),
      note('A whole export, or just a list of titles an assistant wrote — ["Call the vendor back", ' +
           '"Book the offsite room"] is a valid file, and lands in Inbox. Comments and trailing commas ' +
           'are forgiven, and lane names like "In Progress" or "just do it" are understood.'),
      el('div', { class: 'data-panel__actions' }, [
        btn('Choose a file…', 'quiet', function () { fileInput.click(); }),
        fileInput
      ]),
      textarea,
      el('div', { class: 'data-panel__actions' }, [
        btn('Import pasted JSON', 'quiet', function () {
          if (!textarea.value.trim()) return ui.toast('Nothing pasted yet.', 'error');
          attemptImport(app, textarea.value, close, 'pasted JSON');
        })
      ])
    ];

    if (FF.storage.status().hasBackup) {
      rows.push(el('div', { class: 'data-panel__actions' }, [
        btn('Recover the previous dataset', 'faint', function () {
          var backup = FF.storage.readBackup();
          if (!backup) return ui.toast('No recoverable copy found.', 'error');
          attemptImport(app, backup, close, 'the recovered copy', { replaceOnly: true });
        })
      ]));
    }

    return section('Import', rows);
  }

  /**
   * @param options.replaceOnly  Recovering a backup is a restore, not a merge:
   *                             offering "add" there would silently double
   *                             every card the user still has.
   */
  function attemptImport(app, text, close, label, options) {
    options = options || {};

    // readAny, not JSON.parse: it strips comments, straightens a looser shape
    // and then runs exactly the same validation as any other route in.
    var result = model.readAny(text);

    if (!result.ok) return showReport(result, label, []);

    var choices = [];

    if (!options.replaceOnly && result.data.cards.length) {
      choices.push({
        label: 'Add to my board',
        kind: 'quiet',
        onSelect: function () { app.adoptMerged(result.data.cards); close(); }
      });
    }

    choices.push({
      label: 'Replace my data',
      kind: 'primary',
      onSelect: function () { app.adoptImported(result.data); close(); }
    });

    showReport(result, label, choices);
  }

  /** Always show what happened before anything changes. */
  function showReport(result, label, choices) {
    ui.openDialog({
      className: 'dialog--report',
      labelledBy: 'report-title',
      build: function (closeReport) {
        var counts = result.ok
          ? result.data.cards.length + (result.data.cards.length === 1 ? ' card' : ' cards') +
            ' and ' + result.data.weeklyReviews.length +
            (result.data.weeklyReviews.length === 1 ? ' weekly review' : ' weekly reviews')
          : null;

        var canMerge = choices.some(function (c) { return c.kind === 'quiet'; });

        return el('div', { class: 'dialog__body report' }, [
          el('h2', { class: 'dialog__title', id: 'report-title',
                     text: result.ok ? 'Ready to import' : 'Cannot import' }),
          el('p', { class: 'report__lede', text: result.ok
            ? 'Read ' + counts + ' from ' + label + '.'
            : 'Nothing was changed.' }),

          // Said here rather than in a tooltip, because these two buttons sit
          // next to each other and one of them throws away the current board.
          result.ok && canMerge ? el('p', { class: 'report__lede', text:
            'Adding puts them at the bottom of their lanes and leaves everything you already have. ' +
            'Replacing swaps the whole board for this file.' }) : null,

          list('report__errors', 'Problems', result.errors),
          list('report__rejected', 'Left out', result.rejected),
          list('report__warnings', 'Adjusted on the way in', result.warnings),

          el('div', { class: 'dialog__actions' }, [
            el('button', {
              type: 'button', class: 'btn btn--quiet',
              text: result.ok ? 'Cancel' : 'Close',
              onclick: function () { closeReport(); }
            })
          ].concat(result.ok ? choices.map(function (choice, i) {
            return el('button', {
              type: 'button', class: 'btn btn--' + choice.kind, text: choice.label,
              // Focus the first offered action, which is Add whenever adding
              // is possible: the safe one should be the one Enter lands on.
              'data-autofocus': i === 0 ? '' : null,
              onclick: function () { closeReport(); choice.onSelect(); }
            });
          }) : []))
        ]);
      }
    });
  }

  function list(className, heading, items) {
    if (!items || !items.length) return null;
    return el('div', { class: 'report__block ' + className }, [
      el('h3', { class: 'report__heading', text: heading + ' (' + items.length + ')' }),
      el('ul', { class: 'report__list' }, items.slice(0, 25).map(function (line) {
        return el('li', { text: line });
      })),
      items.length > 25 ? el('p', { class: 'report__more', text: '+' + (items.length - 25) + ' more.' }) : null
    ]);
  }

  // ------------------------------------------------------------------
  // Discarded work
  //
  // Discard is reversible and quiet. Permanent deletion lives down here, behind
  // a confirmation, because it is the one action in Forefront that actually
  // destroys history.
  // ------------------------------------------------------------------

  function renderDiscarded(app, close) {
    var data = app.getData();
    var dropped = data.cards
      .filter(function (c) { return c.discardedAt; })
      .sort(function (a, b) { return new Date(b.discardedAt) - new Date(a.discardedAt); });

    if (!dropped.length) {
      return section('Discarded', [
        el('p', { class: 'data-panel__lede', text: 'Nothing discarded. Cards you discard are kept here rather than deleted.' })
      ]);
    }

    return section('Discarded (' + dropped.length + ')', [
      el('p', { class: 'data-panel__lede', text: 'Kept, not deleted — deciding something no longer matters is worth remembering.' }),
      el('ul', { class: 'discarded__list' }, dropped.slice(0, 30).map(function (card) {
        return el('li', { class: 'discarded__item' }, [
          el('span', { class: 'discarded__title', text: card.title }),
          el('span', { class: 'discarded__when', text: ui.formatShort(card.discardedAt) }),
          el('button', {
            type: 'button', class: 'link link--small', text: 'Restore',
            onclick: function () { close(); app.restore(card.id); }
          }),
          el('button', {
            type: 'button', class: 'link link--small link--danger', text: 'Delete forever',
            onclick: function () {
              ui.confirmDialog({
                title: 'Delete permanently?',
                message: '“' + card.title + '” will be removed from your data entirely. This cannot be undone.',
                confirmLabel: 'Delete forever',
                danger: true
              }).then(function (yes) { if (yes) { close(); app.deleteForever(card.id); } });
            }
          })
        ]);
      })),
      dropped.length > 30 ? el('p', { class: 'report__more', text: '+' + (dropped.length - 30) + ' more in your data file.' }) : null
    ]);
  }

  // ---- small builders ----------------------------------------------

  function section(title, children) {
    return el('section', { class: 'data-panel__section' },
      [el('h3', { class: 'data-panel__heading', text: title })].concat(children.filter(Boolean)));
  }

  function line(label, value, tone) {
    return el('p', { class: 'data-line data-line--' + tone }, [
      el('span', { class: 'data-line__label', text: label }),
      el('span', { class: 'data-line__value', text: value })
    ]);
  }

  function note(text) { return el('p', { class: 'data-note', text: text }); }

  function btn(label, kind, onClick) {
    return el('button', { type: 'button', class: 'btn btn--' + kind, text: label, onclick: onClick });
  }

  FF.dataPanel = { open: open, downloadJSON: downloadJSON, exportFilename: exportFilename };
})(window.FF);
