'use strict';

/**
 * Forefront — Focus View.
 *
 * The page you actually see. Everything about this view is subtraction: the
 * backlog is not here, the lanes are not here, nothing is here to be groomed.
 * What is here is the handful of things you already decided mattered, set large
 * enough that a glance is enough, and a way to write down whatever just
 * occurred to you.
 *
 * The counts along the bottom are the one concession to the backlog existing at
 * all. They are numbers, not links to guilt — small, quiet, and deliberately
 * not clickable-looking enough to invite browsing.
 */

(function (FF) {
  var ui = FF.ui;
  var el = ui.el;
  var model = FF.model;
  var C = FF.C;

  function render(data, actions) {
    var all = model.commitments(data);
    var top = all.slice(0, C.FOCUS_COMMITMENTS);
    var extra = all.length - top.length;

    return el('div', { class: 'focus' }, [
      renderHeader(data, actions),
      // A <div>, not a <main>: index.html already provides the page's single
      // <main> landmark and nesting a second one inside it is invalid.
      el('div', { class: 'focus__main' }, [
        el('h2', { class: 'focus__label', id: 'focus-label', text: 'Focus' }),
        top.length
          ? renderCommitments(top, actions)
          : renderEmpty(actions),
        // One line, not two. An earlier version printed "+2 more active" and
        // "5 active — Focus works best with 3" one under the other, which is
        // the same fact told twice and reads as fussing.
        extra > 0 ? el('p', {
          class: 'focus__extra',
          text: '+' + extra + ' more active — Focus works best with ' + C.FOCUS_COMMITMENTS + '.'
        }) : null
      ]),
      renderCapture(actions),
      renderFooter(data, actions)
    ]);
  }

  function renderHeader(data, actions) {
    return el('header', { class: 'focus__header' }, [
      el('p', { class: 'wordmark' }, [
        ui.icon('mark', 'wordmark__mark'),
        el('span', { text: 'Forefront' })
      ]),
      el('p', { class: 'focus__date', text: ui.formatToday() })
    ]);
  }

  function renderCommitments(cards, actions) {
    return el('ol', { class: 'commitments', 'aria-labelledby': 'focus-label' },
      cards.map(function (card, i) { return renderCommitment(card, i, actions); })
    );
  }

  function renderCommitment(card, index, actions) {
    var label = card.title;

    var item = el('li', {
      class: 'commitment',
      dataset: { cardId: card.id },
      tabindex: '0',
      onkeydown: function (e) {
        if (e.key !== 'Enter' || e.altKey) return;
        // The Done button is inside this item, so its Enter arrives here too.
        // Claiming it would cancel the button and open Edit instead.
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        actions.edit(card.id);
      },
      ondblclick: function () { actions.edit(card.id); }
    }, [
      el('button', {
        type: 'button',
        class: 'commitment__done',
        'aria-label': 'Mark “' + label + '” done',
        title: 'Mark done',
        onclick: function (e) { e.stopPropagation(); actions.complete(card.id); }
      }, [tick()]),
      // No notes indicator here on purpose. Focus View is for being reminded
      // what matters, not for reading detail, and a lone dot beside a title
      // reads as a typo more than as information.
      el('span', { class: 'commitment__text' }, [
        el('span', { class: 'commitment__title', text: card.title })
      ]),
      el('span', {
        class: 'commitment__age',
        text: model.ageLabel(card),
        title: 'Added ' + ui.formatShort(card.createdAt)
      })
    ]);

    return item;
  }

  function renderEmpty(actions) {
    return el('div', { class: 'focus__empty' }, [
      el('p', { class: 'focus__empty-line', text: 'Nothing committed yet.' }),
      el('button', {
        type: 'button',
        class: 'link',
        text: 'Open the board and choose what matters',
        onclick: actions.showBoard
      })
    ]);
  }

  function renderCapture(actions) {
    return el('div', { class: 'focus__capture' }, [
      el('button', {
        type: 'button',
        class: 'capture-button',
        'data-capture-trigger': '',
        onclick: actions.capture
      }, [
        el('span', { class: 'capture-button__plus', 'aria-hidden': 'true', text: '+' }),
        el('span', { text: 'Quick Capture' }),
        el('kbd', { class: 'capture-button__key', text: C.CAPTURE_KEY_LABEL || 'N' })
      ])
    ]);
  }

  function renderFooter(data, actions) {
    var counts = model.laneCounts(data);

    var lanes = FF.LANES.filter(function (l) { return l.id !== 'done'; }).map(function (lane) {
      return el('button', {
        type: 'button',
        class: 'count' + (counts[lane.id] === 0 ? ' count--zero' : ''),
        'aria-label': counts[lane.id] + ' in ' + lane.label + ' — open the board',
        onclick: function () { actions.showBoard(lane.id); }
      }, [
        el('span', { class: 'count__label', text: lane.label }),
        el('span', { class: 'count__value', text: String(counts[lane.id]) })
      ]);
    });

    return el('footer', { class: 'focus__footer' }, [
      el('div', { class: 'counts' }, lanes),
      el('div', { class: 'focus__actions' }, [
        el('button', {
          type: 'button', class: 'btn btn--ghost', text: 'Show Board',
          onclick: function () { actions.showBoard(); }
        }),
        el('button', {
          type: 'button', class: 'btn btn--faint', text: 'Data',
          onclick: actions.openData
        }),
        el('button', {
          type: 'button', class: 'btn btn--faint', text: 'Shortcuts',
          onclick: actions.showHelp
        }),
        ui.themeControl(actions.rerender)
      ])
    ]);
  }

  /**
   * A hand-drawn tick, so no icon font or image file is needed.
   *
   * The drawing itself moved to ui.icon when the theme control needed a tick
   * for its menu; this stays as the name the rest of the app already calls,
   * rather than having two ticks that can drift apart.
   */
  function tick() { return ui.icon('tick'); }

  FF.focus = { render: render, tick: tick };
})(window.FF);
