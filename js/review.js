'use strict';

/**
 * Forefront — the Monday review.
 *
 * The point of this ritual is to stop Forefront becoming the next productivity
 * app you quietly stop opening. So it has to be small enough that doing it is
 * easier than avoiding it.
 *
 * Two deliberate choices:
 *
 * The Monday prompt is an inline panel on Focus View, not a modal. On a Monday
 * you may have opened the browser because something is on fire at 8am, and a
 * dialog demanding a decision before you can move is exactly the behaviour that
 * makes people resent a tool. "Later" gets out of the way in one click.
 *
 * The review itself is a rail across the top of the ordinary board rather than
 * a wizard. Triaging and re-ranking ARE dragging cards around a board; building
 * a separate set of classification forms to do the same job would be slower and
 * would teach you a second way to use the app for no reason.
 */

(function (FF) {
  var ui = FF.ui;
  var el = ui.el;
  var model = FF.model;
  var C = FF.C;

  var STEPS = [
    {
      id: 'look-back',
      title: 'Look back',
      guide: 'This is what actually got done.',
      body: renderLookBack
    },
    {
      id: 'triage',
      title: 'Empty the Inbox',
      guide: 'Move each capture into a lane, or discard it. If you leave one here, make that a deliberate choice.',
      body: renderTriage
    },
    {
      id: 'prune',
      title: 'Decide what is still worth carrying',
      guide: 'For anything stale: advance it, name the next action, delegate it, or drop it. Age is evidence, not a verdict.',
      body: renderPrune
    },
    {
      id: 'rerank',
      title: 'Put them in order',
      guide: 'Reorder the cards within Management, Projects and Just Do It. Position is the priority; the most important work belongs at the top.',
      body: null
    },
    {
      id: 'commit',
      title: 'Commit',
      guide: 'If Friday came and only three meaningful things were done, which three would you most want them to be?',
      body: renderCommit
    }
  ];

  /** How far back "look back" reaches when there is no previous review. */
  var LOOK_BACK_DAYS = 7;

  /** A card older than this is worth a second look during Prune. */
  var PRUNE_AGE_DAYS = 14;

  // ------------------------------------------------------------------
  // The Monday prompt
  // ------------------------------------------------------------------

  /** The inline panel offering the review. Returns null when there is nothing
   *  to say, which is most days. */
  function renderPrompt(data, actions) {
    if (model.reviewState(data) !== 'due') return null;

    return el('section', { class: 'review-prompt', 'aria-labelledby': 'review-prompt-title' }, [
      el('div', { class: 'review-prompt__text' }, [
        el('h2', { class: 'review-prompt__title', id: 'review-prompt-title', text: 'Weekly review' }),
        el('p', { class: 'review-prompt__sub', text: 'Two minutes to reset what matters this week.' })
      ]),
      el('div', { class: 'review-prompt__actions' }, [
        el('button', { type: 'button', class: 'btn btn--primary', text: 'Review now', onclick: actions.startReview }),
        el('button', { type: 'button', class: 'btn btn--quiet', text: 'Later', onclick: actions.deferReview }),
        el('button', { type: 'button', class: 'btn btn--faint', text: 'Skip this week', onclick: actions.skipReview })
      ])
    ]);
  }

  /**
   * The quiet residue. "Later" leaves a pending mark; a Monday that passed
   * without a decision leaves a missed mark. Neither does anything more than
   * sit there — no colour, no badge, no growing count.
   */
  function renderIndicator(data, actions) {
    var state = model.reviewState(data);
    if (state !== 'pending' && state !== 'missed') return null;

    return el('button', {
      type: 'button',
      class: 'review-indicator',
      text: state === 'pending' ? 'Review pending' : 'Review missed',
      title: 'Start the weekly review',
      onclick: actions.startReview
    });
  }

  // ------------------------------------------------------------------
  // The review rail
  // ------------------------------------------------------------------

  /**
   * The session holds only the step number. The dataset is passed in at render
   * time rather than captured here, so that importing data while a review is
   * open cannot leave the rail describing a board that no longer exists.
   */
  function createSession(actions) {
    var step = 0;

    function goNext(data) {
      var current = STEPS[step];
      var inboxCount = model.laneCards(data, 'inbox').length;

      if (current.id === 'triage' && inboxCount > 0) {
        ui.confirmDialog({
          title: 'Leave items in Inbox?',
          message: inboxCount + (inboxCount === 1 ? ' item is' : ' items are') +
                   ' still waiting for a decision. You can continue, but the review will not count them as triaged.',
          cancelLabel: 'Keep triaging',
          confirmLabel: 'Continue review'
        }).then(function (yes) {
          if (!yes) return;
          step++;
          actions.rerender();
        });
        return;
      }

      step++;
      actions.rerender();
    }

    function finish(data) {
      var commitmentCount = model.commitments(data).length;
      var title = null;
      var message = null;

      if (commitmentCount === 0) {
        title = 'Finish with no commitments?';
        message = 'Nothing is in In Progress. That may be intentional, but Focus will have no committed work for the week.';
      } else if (commitmentCount > C.FOCUS_COMMITMENTS) {
        title = 'Finish with ' + commitmentCount + ' commitments?';
        message = 'Focus will show only the first ' + C.FOCUS_COMMITMENTS +
                  '. Continue if the rest are intentionally active.';
      }

      if (!title) return actions.finishReview();

      ui.confirmDialog({
        title: title,
        message: message,
        cancelLabel: 'Keep reviewing',
        confirmLabel: 'Finish review'
      }).then(function (yes) { if (yes) actions.finishReview(); });
    }

    function rail(data) {
      var current = STEPS[step];

      return el('section', {
        class: 'rail',
        'aria-labelledby': 'rail-title',
        dataset: { step: current.id }
      }, [
        el('div', { class: 'rail__main' }, [
          el('div', { class: 'rail__text' }, [
            el('p', { class: 'rail__eyebrow' }, [
              el('span', { text: 'Weekly review' }),
              el('span', { class: 'rail__progress', text: (step + 1) + ' of ' + STEPS.length })
            ]),
            el('h2', { class: 'rail__title', id: 'rail-title', text: current.title }),
            el('p', { class: 'rail__guide', text: current.guide })
          ]),
          el('div', { class: 'rail__actions' }, [
            el('button', {
              type: 'button', class: 'btn btn--quiet', text: 'Back',
              disabled: step === 0,
              onclick: function () { step--; actions.rerender(); }
            }),
            step < STEPS.length - 1
              ? el('button', {
                  type: 'button', class: 'btn btn--primary', text: 'Next',
                  'data-autofocus': '',
                  onclick: function () { goNext(data); }
                })
              : el('button', {
                  type: 'button', class: 'btn btn--primary', text: 'Finish review',
                  onclick: function () { finish(data); }
                }),
            el('button', {
              type: 'button', class: 'rail__exit', text: 'Leave review',
              title: 'Leave without recording the review',
              onclick: function () { actions.abandonReview(); }
            })
          ])
        ]),
        current.body ? el('div', { class: 'rail__body' }, [current.body(data, actions)]) : null
      ]);
    }

    return {
      rail: rail,
      stepId: function () { return STEPS[step].id; },
      isLastStep: function () { return step === STEPS.length - 1; }
    };
  }

  // ---- step bodies -------------------------------------------------

  function renderLookBack(data) {
    var since = lastReviewDate(data);
    var done = model.completedSince(data, since);

    if (!done.length) {
      return el('p', { class: 'rail__empty', text: 'Nothing recorded as finished since the last review. That is information too.' });
    }

    return el('div', { class: 'lookback' }, [
      el('ul', { class: 'lookback__list' }, done.slice(0, 20).map(function (card) {
        return el('li', { class: 'lookback__item' }, [
          el('span', { class: 'lookback__title', text: card.title }),
          el('span', { class: 'lookback__when', text: ui.formatShort(card.completedAt) })
        ]);
      })),
      done.length > 20
        ? el('p', { class: 'rail__more', text: '+' + (done.length - 20) + ' more, all kept in your data file.' })
        : null
    ]);
  }

  function renderTriage(data) {
    var left = model.laneCards(data, 'inbox').length;
    return el('p', { class: 'rail__status', text: left === 0
      ? 'Inbox is empty.'
      : left + (left === 1 ? ' item' : ' items') + ' still to file.' });
  }

  function renderPrune(data) {
    var now = new Date();
    var stale = data.cards.filter(function (card) {
      return model.isActive(card) && !card.completedAt &&
             card.lane !== 'inbox' && model.ageDays(card, now) >= PRUNE_AGE_DAYS;
    }).sort(function (a, b) { return model.ageDays(b, now) - model.ageDays(a, now); });

    if (!stale.length) {
      return el('p', { class: 'rail__empty', text: 'Nothing has been sitting longer than ' + PRUNE_AGE_DAYS + ' days.' });
    }

    return el('p', { class: 'rail__status', text:
      stale.length + (stale.length === 1 ? ' card has' : ' cards have') + ' been open ' +
      PRUNE_AGE_DAYS + ' days or more — the oldest is ' + model.ageDays(stale[0], now) +
      ' days. They are marked on the board.' });
  }

  function renderCommit(data) {
    var active = model.commitments(data);

    if (!active.length) {
      return el('p', { class: 'rail__empty', text: 'Nothing in In Progress yet. Drag in the work you want to be true on Friday.' });
    }

    return el('div', { class: 'commit-list' }, [
      el('ol', { class: 'commit-list__items' }, active.map(function (card, i) {
        return el('li', {
          class: 'commit-list__item' + (i < C.FOCUS_COMMITMENTS ? '' : ' commit-list__item--extra'),
          text: card.title
        });
      })),
      active.length > C.FOCUS_COMMITMENTS
        ? el('p', { class: 'rail__more', text: 'Focus will show the first ' + C.FOCUS_COMMITMENTS + '.' })
        : null
    ]);
  }

  /** When the last review happened, or a week ago if there has not been one. */
  function lastReviewDate(data) {
    var done = data.weeklyReviews
      .filter(function (r) { return r.status === 'completed' && r.completedAt; })
      .sort(function (a, b) { return new Date(b.completedAt) - new Date(a.completedAt); });

    if (done.length) return new Date(done[0].completedAt);

    var fallback = new Date();
    fallback.setDate(fallback.getDate() - LOOK_BACK_DAYS);
    return fallback;
  }

  FF.review = {
    renderPrompt: renderPrompt,
    renderIndicator: renderIndicator,
    createSession: createSession,
    PRUNE_AGE_DAYS: PRUNE_AGE_DAYS
  };
})(window.FF);
