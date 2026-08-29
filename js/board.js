'use strict';

/**
 * Forefront — Board View.
 *
 * The planning surface. You come here on purpose, rearrange things, and leave.
 *
 * Two decisions here carry most of the product's weight:
 *
 * Inbox is not a sixth column. It is a shallow strip across the top, because it
 * is a holding pen you empty rather than a place work lives. Making it a column
 * would quietly turn it into another backlog.
 *
 * Just Do It is narrower and set in a lighter key than Management and Projects.
 * Twelve five-minute chores are easier to look at than one hard document, and
 * without this they would win that competition every time.
 */

(function (FF) {
  var ui = FF.ui;
  var el = ui.el;
  var model = FF.model;
  var C = FF.C;

  var dragController = null;

  function render(data, actions, options) {
    options = options || {};
    var counts = model.laneCounts(data);

    var board = el('div', { class: 'board' }, [
      renderHeader(actions),
      options.reviewRail || null,
      renderInbox(data, counts.inbox, actions, options),
      el('div', { class: 'board__scroller' }, [
        el('div', { class: 'board__lanes' },
          FF.LANES.filter(function (l) { return l.id !== 'inbox'; })
                  .map(function (lane) { return renderLane(lane, data, counts, actions, options); })
        )
      ]),
      ui.appFooter(actions, {
        primary: { label: 'Focus', onClick: actions.showFocus }
      })
    ]);

    return board;
  }

  function renderHeader(actions) {
    return el('header', { class: 'board__header' }, [
      el('div', { class: 'brand' }, [
        el('button', {
          type: 'button', class: 'wordmark wordmark--button',
          title: 'Back to Focus', 'aria-label': 'Back to Focus',
          onclick: actions.showFocus
        }, [
          ui.icon('mark', 'wordmark__mark'),
          el('span', { text: 'Forefront' })
        ]),
        ui.versionTag(actions.showChangelog)
      ]),
      // Only what you do FROM the board. Data, Shortcuts and the theme moved
      // to the shared footer so they are in the same place in every view.
      el('div', { class: 'board__actions' }, [
        el('button', { type: 'button', class: 'btn btn--quiet', 'data-capture-trigger': '', onclick: actions.capture }, [
          el('span', { 'aria-hidden': 'true', text: '+ ' }),
          el('span', { text: 'Quick Capture' })
        ])
      ])
    ]);
  }

  // ---- Inbox -------------------------------------------------------

  function renderInbox(data, count, actions, options) {
    var cards = model.laneCards(data, 'inbox');

    return el('section', {
      class: 'inbox' + (cards.length ? '' : ' inbox--empty'),
      'aria-labelledby': 'inbox-heading',
      dataset: { lane: 'inbox' }
    }, [
      el('div', { class: 'inbox__bar' }, [
        el('h2', { class: 'inbox__heading', id: 'inbox-heading' }, [
          el('span', { text: 'Inbox' }),
          el('span', { class: 'inbox__count', text: String(count) })
        ]),
        cards.length
          ? el('p', { class: 'inbox__hint', text: 'Drag each one into a lane, or discard it.' })
          : null
      ]),
      el('ul', {
        class: 'inbox__list',
        dataset: { laneList: '', lane: 'inbox', orientation: 'horizontal' },
        'aria-label': 'Inbox'
      }, cards.length
        ? cards.map(function (card) { return renderCard(card, 'inbox', actions, undefined, options); })
        : [el('li', { class: 'lane__empty lane__empty--inbox', dataset: { dragSkip: '' },
                      text: 'Nothing waiting. Captured thoughts land here.' })]
      )
    ]);
  }

  // ---- Lanes -------------------------------------------------------

  function renderLane(lane, data, counts, actions, options) {
    var cards = model.laneCards(data, lane.id);
    var classes = ['lane', 'lane--' + lane.id];
    if (lane.secondary) classes.push('lane--secondary');
    if (lane.emphasis) classes.push('lane--emphasis');
    if (lane.terminal) classes.push('lane--terminal');

    var headingId = 'lane-' + lane.id + '-heading';

    return el('section', {
      class: classes.join(' '),
      dataset: { lane: lane.id },
      style: { '--lane-weight': String(lane.weight) },
      'aria-labelledby': headingId
    }, [
      el('div', { class: 'lane__header' }, [
        el('h2', { class: 'lane__title', id: headingId, text: lane.label }),
        el('span', { class: 'lane__count', text: String(counts[lane.id]) }),
        lane.id === 'inprogress' ? commitmentNote(counts.inprogress) : null,
        lane.id === 'done'
          ? el('span', { class: 'lane__note', text: 'last ' + C.DONE_VISIBLE_DAYS + ' days' })
          : null
      ]),
      el('ul', {
        class: 'lane__list',
        dataset: { laneList: '', lane: lane.id },
        'aria-labelledby': headingId
      }, cards.length
        ? cards.map(function (card, i) { return renderCard(card, lane.id, actions, i, options); })
        : [el('li', { class: 'lane__empty', dataset: { dragSkip: '' }, text: emptyText(lane) })]
      )
    ]);
  }

  /**
   * The one lane that says how full it is.
   *
   * "full" at rest is the cheap half of enforcing the limit — it means the
   * refusal dialog is a reminder rather than a surprise. The over-count line
   * only appears for data that arrived over the limit through an import or a
   * connected file, which the limit deliberately does not police.
   */
  function commitmentNote(count) {
    if (count > C.FOCUS_COMMITMENTS) {
      return el('span', { class: 'lane__note lane__note--over',
        text: count + ' of ' + C.FOCUS_COMMITMENTS + ' — take ' +
              (count - C.FOCUS_COMMITMENTS) + ' out' });
    }
    if (C.ENFORCE_COMMITMENT_LIMIT && count === C.FOCUS_COMMITMENTS) {
      return el('span', { class: 'lane__note', text: 'full' });
    }
    return null;
  }

  function emptyText(lane) {
    if (lane.id === 'inprogress') return 'Drag in what you are committing to.';
    if (lane.id === 'done') return 'Nothing finished in the last few days.';
    return 'Empty.';
  }

  // ---- Cards -------------------------------------------------------

  function renderCard(card, laneId, actions, indexInLane, options) {
    var isDone = laneId === 'done';
    var isCommitment = laneId === 'inprogress';
    var focusRank = isCommitment && indexInLane !== undefined && indexInLane < C.FOCUS_COMMITMENTS;

    // During the Prune step of the weekly review, cards that have been sitting
    // a while are marked. Only then — age is worth noticing once a week, not
    // every time you look at the board.
    var stale = options && options.highlightStale && !isDone &&
                laneId !== 'inbox' && model.ageDays(card) >= options.staleDays;

    var classes = ['card'];
    if (isDone) classes.push('card--done');
    if (focusRank) classes.push('card--focus');
    if (stale) classes.push('card--stale');

    var menuButton = el('button', {
      type: 'button',
      class: 'card__menu',
      'aria-label': 'Actions for “' + card.title + '”',
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      title: 'Actions',
      onclick: function (e) {
        e.stopPropagation();
        ui.popupMenu(menuButton, buildMenu(card, laneId, actions));
      }
    }, [el('span', { 'aria-hidden': 'true', text: '···' })]);

    var node = el('li', {
      class: classes.join(' '),
      dataset: { cardId: card.id },
      tabindex: '0',
      ondblclick: function () { actions.edit(card.id); },
      onkeydown: function (e) { onCardKey(e, card, laneId, actions, menuButton); }
    }, [
      isDone ? null : el('button', {
        type: 'button',
        class: 'card__done',
        'aria-label': 'Mark “' + card.title + '” done',
        title: 'Mark done',
        onclick: function (e) { e.stopPropagation(); actions.complete(card.id); }
      }, [FF.focus.tick()]),

      el('div', { class: 'card__body' }, [
        el('p', { class: 'card__title', text: card.title }),
        card.notes ? el('p', { class: 'card__notes', text: card.notes }) : null
      ]),

      el('span', {
        class: 'card__age',
        text: isDone ? doneLabel(card) : model.ageLabel(card),
        title: isDone
          ? 'Finished ' + ui.formatShort(card.completedAt) + ' at ' + ui.formatTime(card.completedAt)
          : 'Added ' + ui.formatShort(card.createdAt)
      }),

      menuButton
    ]);

    return node;
  }

  function doneLabel(card) {
    var days = model.dayDiff(new Date(card.completedAt), new Date());
    return days === 0 ? 'today' : days === 1 ? 'yesterday' : days + 'd ago';
  }

  /**
   * Keyboard moves. Alt is the modifier because it is the one that neither
   * Windows nor macOS has already claimed for text navigation inside a list.
   */
  function onCardKey(e, card, laneId, actions, menuButton) {
    if (e.key === 'Enter' && !e.altKey) {
      // Enter belongs to whatever is focused. The Done and menu buttons live
      // inside the card, so their Enter bubbles up to here, and claiming it
      // would cancel the button's own activation: pressing Enter on Done would
      // open Edit instead of marking the card done.
      if (e.target !== e.currentTarget) return;
      e.preventDefault();
      actions.edit(card.id);
    } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      actions.nudge(card.id, e.key === 'ArrowUp' ? -1 : 1);
    } else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      actions.shiftLane(card.id, e.key === 'ArrowLeft' ? -1 : 1);
    } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      ui.popupMenu(menuButton, buildMenu(card, laneId, actions));
    }
  }

  function buildMenu(card, laneId, actions) {
    var items = [];

    if (laneId !== 'done') {
      items.push({ label: 'Mark done', onSelect: function () { actions.complete(card.id); } });
    } else {
      items.push({
        label: 'Not finished after all',
        onSelect: function () { actions.move(card.id, model.restoreLaneFor(card), 0); }
      });
    }
    items.push({ label: 'Edit…', onSelect: function () { actions.edit(card.id); } });

    items.push({ separator: true });
    items.push({ heading: 'Move to' });

    FF.LANES.forEach(function (lane) {
      if (lane.id === 'done' || lane.id === laneId) return;
      items.push({
        label: lane.label,
        onSelect: function () { actions.move(card.id, lane.id, 0); }
      });
    });

    items.push({ separator: true });
    items.push({ label: 'Move up', onSelect: function () { actions.nudge(card.id, -1); } });
    items.push({ label: 'Move down', onSelect: function () { actions.nudge(card.id, 1); } });

    // Discard says "this no longer matters", which is not a thing you can
    // decide about work you already finished. Completed cards leave the board
    // by themselves after a few days and stay in your history either way.
    if (laneId !== 'done') {
      items.push({ separator: true });
      items.push({
        label: 'Discard',
        danger: true,
        onSelect: function () { actions.discard(card.id); }
      });
    }

    return items;
  }

  // ---- Drag wiring -------------------------------------------------

  function attachDrag(boardNode, actions) {
    if (dragController) dragController.cancel();
    dragController = FF.drag.init({
      root: boardNode,
      itemSelector: '.card',
      listSelector: '[data-lane-list]',
      columnSelector: '.lane, .inbox',
      scrollerSelector: '.board__scroller',
      onDrop: function (cardId, laneId, index) { actions.move(cardId, laneId, index, { fromDrag: true }); }
    });
    return dragController;
  }

  function cancelDrag() { if (dragController) dragController.cancel(); }

  FF.board = { render: render, attachDrag: attachDrag, cancelDrag: cancelDrag, renderCard: renderCard };
})(window.FF);
