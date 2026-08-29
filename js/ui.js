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
  // Icons
  //
  // Drawn here rather than loaded, for the same reason there are no web fonts:
  // an icon font or a sprite file is a network request, and this app has to
  // behave identically opened from a memory stick on a plane. Every glyph is
  // on a 16-unit grid and painted with currentColor, so an icon inherits the
  // colour of whatever it sits in and needs no theme-specific version.
  // ------------------------------------------------------------------

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function svgNode(tag, attrs, children) {
    var node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (attrs[k] === null || attrs[k] === undefined) return;
      node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (child) { if (child) node.appendChild(child); });
    return node;
  }

  var STROKE = { fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5',
                 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };

  function stroked(attrs) {
    var out = {};
    Object.keys(STROKE).forEach(function (k) { out[k] = STROKE[k]; });
    Object.keys(attrs).forEach(function (k) { out[k] = attrs[k]; });
    return out;
  }

  /** The eight rays of the sun, at 45° intervals, as one path. */
  function sunRays() {
    var d = '';
    for (var i = 0; i < 8; i++) {
      var a = i * Math.PI / 4;
      var x = Math.cos(a), y = Math.sin(a);
      d += 'M' + (8 + x * 5.6).toFixed(2) + ' ' + (8 + y * 5.6).toFixed(2) +
           'L' + (8 + x * 7.1).toFixed(2) + ' ' + (8 + y * 7.1).toFixed(2) + ' ';
    }
    return d.trim();
  }

  var ICONS = {
    /** Done. The app's oldest glyph; everything else was drawn to match it. */
    tick: function () {
      return [svgNode('path', stroked({ d: 'M3.5 8.5 L6.5 11.5 L12.5 4.5', 'stroke-width': '1.75' }))];
    },

    /**
     * The Forefront mark: three cards seen edge-on, the foremost solid and at
     * full height, the two behind it shorter, narrower and fading out.
     *
     * It is the product drawn literally. One thing is in front at full
     * strength; the rest exist, are clearly still there, and are just as
     * clearly not what you are being asked to look at. A mark that showed a
     * neat stack of equals would be describing a different application.
     *
     * Depth is carried by fill-opacity rather than by a second colour, so the
     * whole thing is one currentColor and works anywhere a piece of text does
     * — light, dark, on an accent fill, in a favicon.
     *
     * Drawn back to front so the near card is painted last and any future
     * overlap resolves the way depth actually does. Widths 8 / 2.5 / 1.5 and
     * heights 12 / 9 / 6 on a 16 grid, all three centred on y=8, gaps of 1.
     */
    mark: function () {
      return [
        svgNode('rect', { x: '13.5', y: '5', width: '1.5', height: '6', rx: '0.75',
                          fill: 'currentColor', 'fill-opacity': '0.3' }),
        svgNode('rect', { x: '10', y: '3.5', width: '2.5', height: '9', rx: '1',
                          fill: 'currentColor', 'fill-opacity': '0.55' }),
        svgNode('rect', { x: '1', y: '2', width: '8', height: '12', rx: '1.5',
                          fill: 'currentColor' })
      ];
    },
    /** Light. */
    sun: function () {
      return [
        svgNode('circle', stroked({ cx: '8', cy: '8', r: '3.1' })),
        svgNode('path', stroked({ d: sunRays() }))
      ];
    },
    /** Dark. */
    moon: function () {
      return [svgNode('path', stroked({ d: 'M13.6 9.4A5.9 5.9 0 0 1 6.6 2.4 6 6 0 1 0 13.6 9.4Z' }))];
    },
    /**
     * Match system. A disc with one half filled — the convention every OS and
     * every browser settled on for "auto", and the only one of the three that
     * has to say "not a choice between these two, but whichever they are using".
     */
    auto: function () {
      return [
        svgNode('circle', stroked({ cx: '8', cy: '8', r: '5.4' })),
        svgNode('path', { d: 'M8 2.6 A5.4 5.4 0 0 1 8 13.4 Z', fill: 'currentColor' })
      ];
    }
  };

  /**
   * icon('moon') → an <svg> that inherits colour and font size.
   *
   * aria-hidden because every icon in Forefront sits inside a control that
   * already has a text label or an aria-label. An icon that announces itself
   * as well just makes the button say everything twice.
   */
  function icon(name, className) {
    if (!ICONS[name]) throw new Error('ui.icon: no such icon "' + name + '"');
    return svgNode('svg', {
      viewBox: '0 0 16 16',
      class: 'icon' + (className ? ' ' + className : ''),
      'aria-hidden': 'true',
      focusable: 'false'
    }, ICONS[name]());
  }

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

      // `checked` present at all makes the row a radio: it gains a gutter, a
      // tick when it is the current one, and aria-checked so a screen reader
      // says "selected" rather than leaving the user to infer it from a shape.
      var checkable = typeof item.checked === 'boolean';

      var button = el('button', {
        type: 'button',
        role: checkable ? 'menuitemradio' : 'menuitem',
        'aria-checked': checkable ? String(item.checked) : null,
        class: 'menu__item' + (item.danger ? ' menu__item--danger' : '') +
               (checkable ? ' menu__item--checkable' : ''),
        text: checkable ? null : item.label,
        tabindex: '-1',
        disabled: item.disabled || false,
        onclick: function () { closeMenu(); item.onSelect(); }
      });

      if (checkable) {
        button.appendChild(el('span', { class: 'menu__check' },
          [item.checked ? icon('tick') : null]));
        button.appendChild(el('span', { text: item.label }));
      }

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

  // ------------------------------------------------------------------
  // The theme control
  //
  // One icon button, in the same row as Data and Shortcuts, opening the same
  // menu the rest of the app uses. It is deliberately not a two-state switch:
  // once you flip one of those you can never get back to following the
  // operating system, which is the setting most people actually want. Three
  // radio rows cost one extra line of code and remove that trap.
  //
  // The icon shows the PREFERENCE, not the resolved theme — a half-filled disc
  // while following the system, rather than a moon that looks like a choice
  // nobody made.
  // ------------------------------------------------------------------

  var THEME_ICONS = { system: 'auto', light: 'sun', dark: 'moon' };

  function themeControl(onChange) {
    var theme = FF.theme;
    var label = 'Theme: ' + theme.describe();

    var button = el('button', {
      type: 'button',
      class: 'btn btn--faint btn--icon',
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      'aria-label': label,
      title: label,
      onclick: function () {
        if (button.getAttribute('aria-expanded') === 'true') { closeMenu(); return; }
        popupMenu(button, theme.PREFS.map(function (pref) {
          return {
            label: theme.LABELS[pref],
            checked: theme.get() === pref,
            onSelect: function () { theme.set(pref); if (onChange) onChange(); }
          };
        }), 'Theme');
      }
    }, [icon(THEME_ICONS[theme.get()])]);

    return button;
  }

  /**
   * The version badge that sits beside the wordmark in both views.
   *
   * Quiet enough to ignore and specific enough to be worth clicking: it is the
   * only place the application says which build you are looking at, which
   * matters now that the same board can be opened from a hosted copy, a single
   * file and a folder that may all be different ages.
   */
  function versionTag(onSelect) {
    return el('button', {
      type: 'button',
      class: 'version',
      title: 'What changed in ' + FF.C.APP_NAME + ' ' + FF.C.VERSION,
      'aria-label': FF.C.APP_NAME + ' version ' + FF.C.VERSION + ' — see what changed',
      text: 'v' + FF.C.VERSION,
      onclick: onSelect
    });
  }

  /**
   * The footer, identical in every view.
   *
   * It used to exist only in Focus, with the same controls duplicated into the
   * top-right of the board — so Data and Shortcuts were in two different places
   * depending on where you happened to be. They are utilities, not part of
   * either view, and now they live in one place that does not move.
   *
   * The view-switch button is the only thing that differs, because it is the
   * only thing that means something different in each place.
   *
   *   opts.leading   a node for the left-hand side (Focus puts lane counts there)
   *   opts.primary   {label, onClick} — the view switch
   */
  function appFooter(actions, opts) {
    opts = opts || {};

    return el('footer', { class: 'app-footer' }, [
      opts.leading || el('div', { class: 'app-footer__leading' }),
      el('div', { class: 'app-footer__actions' }, [
        opts.primary ? el('button', {
          type: 'button', class: 'btn btn--ghost', text: opts.primary.label,
          onclick: opts.primary.onClick
        }) : null,
        el('button', {
          type: 'button', class: 'btn btn--faint', text: 'Data',
          onclick: actions.openData
        }),
        el('button', {
          type: 'button', class: 'btn btn--faint', text: 'Shortcuts',
          onclick: actions.showHelp
        }),
        themeControl(actions.rerender)
      ])
    ]);
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  FF.ui = {
    el: el, clear: clear, $: $, $$: $$,
    svgNode: svgNode, icon: icon, themeControl: themeControl, versionTag: versionTag, appFooter: appFooter,
    formatToday: formatToday, formatShort: formatShort, formatTime: formatTime,
    openDialog: openDialog, confirmDialog: confirmDialog, anyDialogOpen: anyDialogOpen,
    toast: toast, setBanner: setBanner, announce: announce,
    popupMenu: popupMenu, closeMenu: closeMenu, anyMenuOpen: anyMenuOpen,
    prefersReducedMotion: prefersReducedMotion
  };
})(window.FF);
