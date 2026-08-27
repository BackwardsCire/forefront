'use strict';

/**
 * Forefront — dragging cards.
 *
 * Built on pointer events rather than the native HTML5 drag-and-drop API. The
 * native API gives you a translucent OS drag image you cannot really control,
 * and its dragenter/dragleave events fire for every child element, which is why
 * so many boards flicker as you cross a column. The spec for this app asks for
 * dragging that feels like sliding a sticky note, so it is worth the extra
 * hundred lines to own the interaction.
 *
 * The card being dragged is not cloned into a floating copy and hidden. The
 * real element is moved through the DOM as you go, so the lanes open up to
 * receive it and what you see during the drag is exactly what you get when you
 * let go. A separate proxy follows the pointer.
 *
 * All measurement happens in a requestAnimationFrame callback, never in the
 * pointermove handler, so a fast drag cannot force more than one layout per
 * frame.
 */

(function (FF) {
  var C = FF.C;

  /** Touch needs a press-and-hold, because a swipe on a card should still
   *  scroll the page. Mouse and pen engage on movement alone. */
  var TOUCH_HOLD_MS = 350;
  var TOUCH_HOLD_TOLERANCE_PX = 8;

  /** How close to the edge of the board before it scrolls itself, and how fast. */
  var EDGE_ZONE_PX = 72;
  var EDGE_SPEED_PX = 18;

  function init(config) {
    var root = config.root;
    var state = null;
    var frame = null;

    root.addEventListener('pointerdown', onPointerDown);

    function itemFrom(target) {
      var node = target.closest(config.itemSelector);
      if (!node || !root.contains(node)) return null;
      // Controls inside a card are for pressing, not for dragging by.
      if (target.closest('button, a, input, textarea, select, [data-no-drag]')) return null;
      return node;
    }

    function onPointerDown(e) {
      if (state) return;
      if (e.button !== undefined && e.button !== 0) return; // primary button only

      var item = itemFrom(e.target);
      if (!item) return;

      var list = item.closest(config.listSelector);
      if (!list) return;

      state = {
        pointerId: e.pointerId,
        pointerType: e.pointerType,
        item: item,
        originList: list,
        originNext: item.nextElementSibling,
        startX: e.clientX,
        startY: e.clientY,
        x: e.clientX,
        y: e.clientY,
        grabOffsetX: 0,
        grabOffsetY: 0,
        engaged: false,
        holdTimer: null,
        proxy: null,
        targetList: list,
        scroller: config.scrollerSelector ? root.querySelector(config.scrollerSelector) : null
      };

      var rect = item.getBoundingClientRect();
      state.grabOffsetX = e.clientX - rect.left;
      state.grabOffsetY = e.clientY - rect.top;
      state.width = rect.width;
      state.height = rect.height;

      window.addEventListener('pointermove', onPointerMove, { passive: false });
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerCancel);
      window.addEventListener('keydown', onKeyDown, true);

      if (e.pointerType === 'touch') {
        state.holdTimer = setTimeout(function () {
          state.holdTimer = null;
          if (state && !state.engaged) engage();
        }, TOUCH_HOLD_MS);
      }
    }

    function onPointerMove(e) {
      if (!state || e.pointerId !== state.pointerId) return;

      state.x = e.clientX;
      state.y = e.clientY;

      if (!state.engaged) {
        var dx = e.clientX - state.startX;
        var dy = e.clientY - state.startY;
        var distance = Math.sqrt(dx * dx + dy * dy);

        if (state.pointerType === 'touch') {
          // Moving before the hold completes means they meant to scroll.
          if (state.holdTimer && distance > TOUCH_HOLD_TOLERANCE_PX) return finish(false);
          if (!state.engaged) return;
        } else if (distance < C.DRAG_THRESHOLD_PX) {
          return; // still a click
        } else {
          engage();
        }
      }

      e.preventDefault(); // suppress text selection and native scroll while dragging
      schedule();
    }

    function engage() {
      state.engaged = true;

      try { state.item.setPointerCapture(state.pointerId); } catch (err) { /* not fatal */ }

      // The proxy is what follows the pointer. It is inert to hit-testing so
      // that elementFromPoint still reports the lane underneath it.
      var proxy = state.item.cloneNode(true);
      proxy.classList.add('card--proxy');
      proxy.removeAttribute('id');
      proxy.setAttribute('aria-hidden', 'true');
      proxy.style.setProperty('width', state.width + 'px');
      proxy.style.setProperty('height', state.height + 'px');
      document.body.appendChild(proxy);
      state.proxy = proxy;

      state.item.classList.add('card--placeholder');
      document.body.classList.add('is-dragging');

      if (config.onStart) config.onStart(state.item);
      schedule();
    }

    function schedule() {
      if (frame) return;
      frame = requestAnimationFrame(function () {
        frame = null;
        if (state && state.engaged) update();
      });
    }

    function update() {
      // Move the proxy first — this is the part the eye tracks.
      state.proxy.style.setProperty('transform',
        'translate3d(' + (state.x - state.grabOffsetX) + 'px,' + (state.y - state.grabOffsetY) + 'px,0)');

      autoScroll();

      var list = listUnder(state.x, state.y);
      if (!list) return;

      if (config.canDrop && !config.canDrop(state.item.dataset.cardId, list.dataset.lane)) return;

      var before = insertionPoint(list, state.x, state.y);
      // insertBefore with an unchanged position is a no-op in the DOM, so this
      // does not thrash even though it runs every frame.
      if (before !== state.item) {
        list.insertBefore(state.item, before);
        state.targetList = list;
      }
    }

    /**
     * Which lane list is under the pointer. elementFromPoint is used rather
     * than cached rectangles because it gets scrolled and clipped containers
     * right without any bookkeeping, and the proxy is pointer-events:none so it
     * never shadows the answer.
     */
    function listUnder(x, y) {
      var node = document.elementFromPoint(x, y);
      if (!node) return null;
      var list = node.closest(config.listSelector);
      if (list && root.contains(list)) return list;

      // Past the end of a short lane the pointer lands on the column itself.
      var column = node.closest(config.columnSelector || config.listSelector);
      if (column && root.contains(column)) {
        var inner = column.querySelector(config.listSelector);
        if (inner) return inner;
      }
      return null;
    }

    /**
     * The element the dragged card should sit before, or null for the end.
     * The Inbox triage strip runs horizontally while the lanes run vertically,
     * so which axis decides the split depends on the list.
     */
    function insertionPoint(list, x, y) {
      var horizontal = list.dataset.orientation === 'horizontal';
      var children = list.children;
      for (var i = 0; i < children.length; i++) {
        var child = children[i];
        if (child === state.item || child.dataset.dragSkip !== undefined) continue;
        var rect = child.getBoundingClientRect();
        if (horizontal) {
          if (x < rect.left + rect.width / 2) return child;
        } else if (y < rect.top + rect.height / 2) {
          return child;
        }
      }
      return null;
    }

    /**
     * Scroll when the pointer nears an edge, so a card can be dragged to a
     * column that is off-screen on a narrower laptop, or to the bottom of a
     * long lane.
     *
     * The board area is its own scroll container in both axes, so vertical
     * autoscroll has to drive it rather than the window — scrolling the window
     * would do nothing at all while the lanes stayed put.
     */
    function autoScroll() {
      var scroller = state.scroller;

      if (scroller) {
        var box = scroller.getBoundingClientRect();

        if (scroller.scrollWidth > scroller.clientWidth) {
          if (state.x < box.left + EDGE_ZONE_PX) { scroller.scrollLeft -= EDGE_SPEED_PX; schedule(); }
          else if (state.x > box.right - EDGE_ZONE_PX) { scroller.scrollLeft += EDGE_SPEED_PX; schedule(); }
        }

        if (scroller.scrollHeight > scroller.clientHeight) {
          if (state.y < box.top + EDGE_ZONE_PX) { scroller.scrollTop -= EDGE_SPEED_PX; schedule(); }
          else if (state.y > box.bottom - EDGE_ZONE_PX) { scroller.scrollTop += EDGE_SPEED_PX; schedule(); }
          return;
        }
      }

      // Nothing to scroll inside the board; fall back to the page.
      if (state.y < EDGE_ZONE_PX) { window.scrollBy(0, -EDGE_SPEED_PX); schedule(); }
      else if (state.y > window.innerHeight - EDGE_ZONE_PX) { window.scrollBy(0, EDGE_SPEED_PX); schedule(); }
    }

    function onKeyDown(e) {
      if (e.key === 'Escape' && state) {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      }
    }

    function onPointerUp(e) {
      if (!state || e.pointerId !== state.pointerId) return;
      finish(true);
    }

    function onPointerCancel(e) {
      if (!state || e.pointerId !== state.pointerId) return;
      finish(false);
    }

    /** End the drag. `commit` false puts the card back exactly where it was. */
    function finish(commit) {
      if (!state) return;

      var s = state;
      state = null;

      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('keydown', onKeyDown, true);
      if (s.holdTimer) clearTimeout(s.holdTimer);
      if (frame) { cancelAnimationFrame(frame); frame = null; }

      if (!s.engaged) return; // it was only ever a click

      try { s.item.releasePointerCapture(s.pointerId); } catch (err) {}

      if (s.proxy && s.proxy.parentNode) s.proxy.parentNode.removeChild(s.proxy);
      s.item.classList.remove('card--placeholder');
      document.body.classList.remove('is-dragging');

      if (!commit) {
        s.originList.insertBefore(s.item, s.originNext);
        if (config.onCancel) config.onCancel();
        return;
      }

      var list = s.item.closest(config.listSelector) || s.originList;
      var index = 0;
      var siblings = list.children;
      for (var i = 0; i < siblings.length; i++) {
        if (siblings[i] === s.item) break;
        if (siblings[i].dataset.dragSkip === undefined) index++;
      }

      config.onDrop(s.item.dataset.cardId, list.dataset.lane, index);
    }

    return {
      /** Abort any drag in flight — used when a re-render pulls the DOM away. */
      cancel: function () { if (state) finish(false); },
      isDragging: function () { return !!(state && state.engaged); }
    };
  }

  FF.drag = { init: init };
})(window.FF);
