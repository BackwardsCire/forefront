'use strict';

/**
 * Forefront — DOM helpers, dialogs, and status messaging.
 *
 * One rule runs through this file: task text never reaches innerHTML. Every
 * piece of user-supplied text goes in through textContent or a value property,
 * so a card titled `<img onerror=...>` is a card with a funny title and nothing
 * more. There is no sanitiser here because there is no HTML parsing of user
 * input to sanitise.
 */

(function (FF) {

  // ------------------------------------------------------------------
  // Element construction
  // ------------------------------------------------------------------

  /**
   * el('div', {class: 'card', text: title}, [child, child])
   *
   * `text` sets textContent. `html` is deliberately not supported.
   */
  function el(tag, props, children) {
    var node = document.createElement(tag);
    props = props || {};

    Object.keys(props).forEach(function (key) {
      var value = props[key];
      if (value === null || value === undefined || value === false) return;

      if (key === 'text') {
        node.textContent = value;
      } else if (key === 'class') {
        node.className = value;
      } else if (key === 'dataset') {
        Object.keys(value).forEach(function (k) { node.dataset[k] = value[k]; });
      } else if (key === 'style') {
        Object.keys(value).forEach(function (k) { node.style.setProperty(k, value[k]); });
      } else if (key.slice(0, 2) === 'on' && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key in node && key !== 'list' && key !== 'type' && key !== 'form') {
        node[key] = value;
      } else {
        node.setAttribute(key, value === true ? '' : value);
      }
    });

    (children || []).forEach(function (child) {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });

    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  // ------------------------------------------------------------------
  // Dates
  // ------------------------------------------------------------------

  /** "Tuesday, August 25" — the quiet marker that this page belongs to today. */
  function formatToday(date) {
    return (date || new Date()).toLocaleDateString(undefined, {
      weekday: 'long', month: 'long', day: 'numeric'
    });
  }

  /** "Mon 24 Aug" — compact, for review history and Look Back. */
  function formatShort(date) {
    return new Date(date).toLocaleDateString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric'
    });
  }

  function formatTime(date) {
    return new Date(date).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  // ------------------------------------------------------------------
  // Dialogs
  //
  // Built on the native <dialog> element, which brings focus trapping, Escape
  // handling, inertness of the page behind it and top-layer stacking for free.
  // Reimplementing all of that by hand is how modals end up subtly inaccessible.
  // ------------------------------------------------------------------

  var openDialogs = [];

  /**
   * openDialog({ className, labelledBy, build(close), onClose })
   * `build` receives a close function and returns the dialog's content.
   */
  function openDialog(opts) {
    var dialog = el('dialog', {
      class: 'dialog ' + (opts.className || ''),
      'aria-label': opts.label || null,
      'aria-labelledby': opts.labelledBy || null
    });

    var closed = false;

    /**
     * Close and remove the dialog, synchronously.
     *
     * An earlier version waited for the native 'close' event before removing
     * the node, to leave room for a closing transition. There is no closing
     * transition, and 'close' is dispatched as a separate task — so all that
     * bought was a window in which the dialog was closing but still in the
     * document, which is exactly the sort of thing that turns into an
     * intermittent bug. Everything happens in one go instead.
     */
    function close(result) {
      if (closed) return;
      closed = true;

      var idx = openDialogs.indexOf(dialog);
      if (idx !== -1) openDialogs.splice(idx, 1);

      try { dialog.close(); } catch (e) { /* already closed */ }
      if (dialog.parentNode) dialog.parentNode.removeChild(dialog);
      if (opts.onClose) opts.onClose(result);
    }

    dialog.appendChild(opts.build(close));

    // Native Escape fires 'cancel'; route it through our own close so that
    // onClose always runs exactly once with a consistent result.
    dialog.addEventListener('cancel', function (e) {
      e.preventDefault();
      close(undefined);
    });

    // Clicking the backdrop dismisses. The dialog element's own box covers the
    // whole viewport, so a click whose target is the dialog itself — rather
    // than anything inside it — is a backdrop click.
    if (opts.dismissOnBackdrop !== false) {
      dialog.addEventListener('mousedown', function (e) {
        if (e.target === dialog) close(undefined);
      });
    }

    document.body.appendChild(dialog);
    openDialogs.push(dialog);
    dialog.showModal();

    // Focus what the dialog nominates. Failing that, focus the dialog itself
    // rather than letting the browser land on the close button, which puts a
    // focus ring on "dismiss" the moment a panel opens.
    var autofocus = dialog.querySelector('[data-autofocus]');
    if (autofocus) {
      autofocus.focus();
    } else {
      dialog.setAttribute('tabindex', '-1');
      dialog.focus();
    }

    return { dialog: dialog, close: close };
  }

  function anyDialogOpen() { return openDialogs.length > 0; }

  /** A small yes/no. Returns a promise for true/false. */
  function confirmDialog(opts) {
    return new Promise(function (resolve) {
      var settled = false;
      openDialog({
        className: 'dialog--confirm',
        label: opts.title,
        build: function (close) {
          return el('div', { class: 'dialog__body' }, [
            el('h2', { class: 'dialog__title', text: opts.title }),
            opts.message ? el('p', { class: 'dialog__message', text: opts.message }) : null,
            el('div', { class: 'dialog__actions' }, [
              el('button', {
                type: 'button',
                class: 'btn btn--quiet',
                text: opts.cancelLabel || 'Cancel',
                onclick: function () { settled = true; resolve(false); close(); }
              }),
              el('button', {
                type: 'button',
                class: 'btn ' + (opts.danger ? 'btn--danger' : 'btn--primary'),
                text: opts.confirmLabel || 'Continue',
                'data-autofocus': '',
                onclick: function () { settled = true; resolve(true); close(); }
              })
            ])
          ]);
        },
        onClose: function () { if (!settled) resolve(false); }
      });
    });
  }

  // ------------------------------------------------------------------
  // Status messaging
  //
  // Two channels, on purpose. A toast is for "that worked"; the persistent
  // banner is for "your data is not being saved", which must not scroll away
  // after three seconds.
  // ------------------------------------------------------------------

  var toastHost = null;
  var bannerHost = null;
  var liveRegion = null;

  function ensureHosts() {
    if (!toastHost) {
      toastHost = el('div', { class: 'toasts', 'aria-live': 'polite', 'aria-atomic': 'false' });
      document.body.appendChild(toastHost);
    }
    if (!liveRegion) {
      liveRegion = el('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(liveRegion);
    }
  }

  function toast(message, kind) {
    ensureHosts();
    var node = el('div', { class: 'toast toast--' + (kind || 'info'), text: message });
    toastHost.appendChild(node);
    setTimeout(function () {
      node.classList.add('toast--leaving');
      setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 240);
    }, kind === 'error' ? 6000 : 2600);
  }

  /**
   * The persistent banner. Used when Forefront cannot save, when a connected
   * file changed underneath it, or when a remembered file needs reconnecting —
   * conditions the user has to actually resolve.
   */
  function setBanner(config) {
    if (!bannerHost) {
      bannerHost = el('div', { class: 'banner-host' });
      document.body.insertBefore(bannerHost, document.body.firstChild);
    }
    clear(bannerHost);
    if (!config) {
      bannerHost.hidden = true;
      return;
    }
    bannerHost.hidden = false;
    bannerHost.appendChild(
      el('div', { class: 'banner banner--' + (config.kind || 'warn'), role: 'alert' }, [
        el('p', { class: 'banner__text', text: config.message }),
        el('div', { class: 'banner__actions' },
          (config.actions || []).map(function (action) {
            return el('button', {
              type: 'button',
              class: 'btn btn--small ' + (action.primary ? 'btn--primary' : 'btn--quiet'),
              text: action.label,
              onclick: action.onClick
            });
          }).concat(config.dismissible === false ? [] : [
            el('button', {
              type: 'button', class: 'banner__dismiss', 'aria-label': 'Dismiss this message',
              text: '×', onclick: function () { setBanner(null); }
            })
          ])
        )
      ])
    );
  }

  /** Announce a change to screen readers without showing anything on screen. */
  function announce(message) {
    ensureHosts();
    liveRegion.textContent = '';
    // The reassignment on a later tick is what makes repeat announcements of
    // identical text actually get spoken.
    setTimeout(function () { liveRegion.textContent = message; }, 30);
  }

  // ------------------------------------------------------------------
  // Popup menu
  //
  // The card menu is the non-drag route through every card action, so it has to
  // work properly from the keyboard: arrow keys move, Home/End jump, Escape
  // closes and puts focus back where it came from. One button per card buys all
  // of that without covering the board in controls.
  // ------------------------------------------------------------------

  var openMenu = null;

  function closeMenu(restoreFocus) {
    if (!openMenu) return;
    var m = openMenu;
    openMenu = null;
    document.removeEventListener('mousedown', m.onOutside, true);
    document.removeEventListener('keydown', m.onKey, true);
    window.removeEventListener('resize', m.onDismiss);
    window.removeEventListener('scroll', m.onDismiss, true);
    if (m.node.parentNode) m.node.parentNode.removeChild(m.node);
    m.anchor.setAttribute('aria-expanded', 'false');
    if (restoreFocus !== false && document.body.contains(m.anchor)) m.anchor.focus();
  }

  /**
   * popupMenu(anchorButton, [{label, onSelect, danger, disabled} | {separator:true} | {heading}])
   */
  function popupMenu(anchor, items, label) {
    closeMenu(false);

    var node = el('div', {
      class: 'menu',
      role: 'menu',
      'aria-label': label || anchor.getAttribute('aria-label') || 'Actions'
    });
    var buttons = [];

    items.forEach(function (item) {
      if (!item) return;
      if (item.separator) { node.appendChild(el('div', { class: 'menu__sep', role: 'separator' })); return; }
      // role="presentation": a group label is not a menu item, and leaving it
      // as a bare child of role="menu" makes the menu's contents invalid.
      if (item.heading) {
        node.appendChild(el('div', { class: 'menu__heading', role: 'presentation', text: item.heading }));
        return;
      }

      var button = el('button', {
        type: 'button',
        role: 'menuitem',
        class: 'menu__item' + (item.danger ? ' menu__item--danger' : ''),
        text: item.label,
        tabindex: '-1',
        disabled: item.disabled || false,
        onclick: function () { closeMenu(); item.onSelect(); }
      });
      buttons.push(button);
      node.appendChild(button);
    });

    document.body.appendChild(node);

    // Position under the anchor, flipping when it would run off screen.
    var box = anchor.getBoundingClientRect();
    var size = node.getBoundingClientRect();
    var margin = 8;
    var left = Math.min(box.right - size.width, window.innerWidth - size.width - margin);
    var top = box.bottom + 4;
    if (top + size.height > window.innerHeight - margin) top = box.top - size.height - 4;
    node.style.setProperty('left', Math.max(margin, left) + 'px');
    node.style.setProperty('top', Math.max(margin, top) + 'px');

    var index = 0;
    function focusAt(i) {
      if (!buttons.length) return;
      index = (i + buttons.length) % buttons.length;
      buttons[index].focus();
    }

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); focusAt(index + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); focusAt(index - 1); }
      else if (e.key === 'Home') { e.preventDefault(); focusAt(0); }
      else if (e.key === 'End') { e.preventDefault(); focusAt(buttons.length - 1); }
      else if (e.key === 'Tab') { closeMenu(); }
    }
    function onOutside(e) { if (!node.contains(e.target) && e.target !== anchor) closeMenu(false); }
    function onDismiss() { closeMenu(false); }

    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onDismiss);
    window.addEventListener('scroll', onDismiss, true);

    anchor.setAttribute('aria-expanded', 'true');
    openMenu = { node: node, anchor: anchor, onOutside: onOutside, onKey: onKey, onDismiss: onDismiss };
    focusAt(0);
  }

  function anyMenuOpen() { return !!openMenu; }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  FF.ui = {
    el: el, clear: clear, $: $, $$: $$,
    formatToday: formatToday, formatShort: formatShort, formatTime: formatTime,
    openDialog: openDialog, confirmDialog: confirmDialog, anyDialogOpen: anyDialogOpen,
    toast: toast, setBanner: setBanner, announce: announce,
    popupMenu: popupMenu, closeMenu: closeMenu, anyMenuOpen: anyMenuOpen,
    prefersReducedMotion: prefersReducedMotion
  };
})(window.FF);
