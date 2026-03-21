/**
 * ui.js — Millas Admin UI Utilities
 *
 * Zero dependencies. No framework. No third-party libraries.
 * Minify-safe: no dynamic property names, no eval, no template magic.
 *
 * What this solves:
 *   The classic CSS stacking context trap — position:fixed breaks inside any
 *   ancestor that has transform, filter, perspective, or will-change set.
 *   position:absolute is clipped by overflow:hidden parents.
 *   Both issues kill dropdowns and modals in complex layouts.
 *
 * The solution — Portal rendering:
 *   Every floating element (dropdown, modal, tooltip, drawer) is moved into
 *   document.body via a dedicated #ui-portal container that sits at the very
 *   top of the DOM stacking order. Coordinates are calculated from the anchor
 *   element using getBoundingClientRect() and applied as fixed pixel positions.
 *   Scroll and resize listeners keep them in sync.
 *
 * Exports (on window.UI):
 *   Portal       — low-level portal mount/unmount
 *   Dropdown     — anchor-attached floating panel (FK select, action menus)
 *   Modal        — centered overlay dialog
 *   Drawer       — slide-in side panel
 *   Tooltip      — hover label
 *   Toast        — ephemeral status notification
 *   Confirm      — promise-based confirm dialog
 *   FocusTrap    — keyboard focus containment for modals/drawers
 *   ScrollLock   — body scroll lock / unlock
 */

(function (root) {
  'use strict';

  // ── Constants ───────────────────────────────────────────────────────────────

  var PORTAL_ID     = 'ui-portal';
  var Z_DROPDOWN    = 1100;
  var Z_MODAL       = 1200;
  var Z_DRAWER      = 1200;
  var Z_TOOLTIP     = 1300;
  var Z_TOAST       = 1400;
  var EASE_OUT      = 'cubic-bezier(0.16,1,0.3,1)';
  var EASE_IN       = 'cubic-bezier(0.4,0,1,1)';

  // ── Portal ──────────────────────────────────────────────────────────────────

  /**
   * Portal — appends floating elements to document.body, bypassing all
   * stacking context traps from transformed or overflow:hidden ancestors.
   *
   * Usage:
   *   var el = Portal.mount('<div class="my-panel">...</div>');
   *   Portal.unmount(el);
   */
  var Portal = (function () {
    function _container() {
      var c = document.getElementById(PORTAL_ID);
      if (!c) {
        c = document.createElement('div');
        c.id = PORTAL_ID;
        c.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:' + Z_DROPDOWN + ';pointer-events:none';
        document.body.appendChild(c);
      }
      return c;
    }

    /**
     * Mount an element or HTML string into the portal container.
     * Returns the mounted element.
     */
    function mount(elOrHtml) {
      var el;
      if (typeof elOrHtml === 'string') {
        var wrap = document.createElement('div');
        wrap.innerHTML = elOrHtml;
        el = wrap.firstElementChild;
      } else {
        el = elOrHtml;
      }
      el.style.pointerEvents = 'auto';
      _container().appendChild(el);
      return el;
    }

    /**
     * Remove an element from the portal container.
     */
    function unmount(el) {
      if (el && el.parentNode && el.parentNode.id === PORTAL_ID) {
        el.parentNode.removeChild(el);
      }
    }

    /**
     * Remove all portal children (nuclear reset).
     */
    function clear() {
      var c = document.getElementById(PORTAL_ID);
      if (c) c.innerHTML = '';
    }

    return { mount: mount, unmount: unmount, clear: clear };
  })();

  // ── ScrollLock ──────────────────────────────────────────────────────────────

  /**
   * ScrollLock — locks body scroll when modals/drawers are open.
   * Uses a reference count so nested lock/unlock calls are safe.
   */
  var ScrollLock = (function () {
    var _count      = 0;
    var _scrollY    = 0;
    var _origStyle  = '';

    function lock() {
      _count++;
      if (_count > 1) return;
      _scrollY   = window.pageYOffset || document.documentElement.scrollTop;
      _origStyle = document.body.style.cssText;
      document.body.style.cssText = _origStyle +
        ';overflow:hidden;position:fixed;top:-' + _scrollY + 'px;left:0;right:0;';
    }

    function unlock() {
      _count = Math.max(0, _count - 1);
      if (_count > 0) return;
      document.body.style.cssText = _origStyle;
      window.scrollTo(0, _scrollY);
    }

    return { lock: lock, unlock: unlock };
  })();

  // ── FocusTrap ───────────────────────────────────────────────────────────────

  /**
   * FocusTrap — keeps keyboard focus inside a container (modal, drawer).
   * Call activate(el) to trap, deactivate() to release.
   */
  var FocusTrap = (function () {
    var _el         = null;
    var _prevFocus  = null;
    var FOCUSABLE   = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

    function _onKeyDown(e) {
      if (!_el || e.key !== 'Tab') return;
      var focusable = Array.from(_el.querySelectorAll(FOCUSABLE)).filter(function (n) {
        return !n.offsetParent === false; // visible only
      });
      if (!focusable.length) { e.preventDefault(); return; }
      var first = focusable[0];
      var last  = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
      }
    }

    function activate(el) {
      _el        = el;
      _prevFocus = document.activeElement;
      document.addEventListener('keydown', _onKeyDown);
      // Focus first focusable element
      var first = el.querySelector(FOCUSABLE);
      if (first) {
        requestAnimationFrame(function () { first.focus(); });
      }
    }

    function deactivate() {
      document.removeEventListener('keydown', _onKeyDown);
      _el = null;
      if (_prevFocus && _prevFocus.focus) {
        requestAnimationFrame(function () { _prevFocus.focus(); });
      }
    }

    return { activate: activate, deactivate: deactivate };
  })();

  // ── Dropdown ─────────────────────────────────────────────────────────────────

  /**
   * Dropdown — an anchor-attached floating panel rendered in the portal.
   * Handles position, scroll, resize, outside-click, and keyboard dismiss.
   *
   * Usage:
   *   var dd = Dropdown.create({
   *     anchor:    document.getElementById('my-btn'),
   *     content:   '<div class="my-menu">...</div>',
   *     placement: 'bottom-start',   // 'bottom-start'|'bottom-end'|'top-start'|'top-end'
   *     offset:    4,                // gap between anchor and panel (px)
   *     onClose:   function() {},
   *     className: 'my-dropdown-panel',
   *   });
   *   dd.open();
   *   dd.close();
   *   dd.destroy();
   */
  var Dropdown = (function () {

    function create(opts) {
      var anchor    = opts.anchor;
      var placement = opts.placement || 'bottom-start';
      var offset    = opts.offset !== undefined ? opts.offset : 4;
      var onClose   = opts.onClose   || null;
      var className = opts.className || 'ui-dropdown-panel';
      var minWidth  = opts.minWidth  || null;
      var maxHeight = opts.maxHeight || 300;

      // Use the provided HTMLElement directly to avoid double-wrapping.
      // For string content, create a wrapper div.
      var panel;
      if (opts.content instanceof HTMLElement) {
        panel = opts.content;
        if (className && !panel.className) panel.className = className;
      } else {
        panel = document.createElement('div');
        panel.className = className;
        if (typeof opts.content === 'string') panel.innerHTML = opts.content;
      }

      // Own only the positioning properties — leave class-based styles
      // (border, shadow, radius) untouched.
      panel.style.position      = 'fixed';
      panel.style.zIndex        = Z_DROPDOWN;
      panel.style.opacity       = '0';
      panel.style.transform     = 'translateY(-4px)';
      panel.style.transition    = 'opacity .15s,transform .15s ' + EASE_OUT;
      panel.style.pointerEvents = 'none';
      panel.style.maxHeight     = maxHeight + 'px';
      panel.style.overflowY     = 'auto'; // scroll if content exceeds maxHeight
      panel.style.display       = 'none';

      // Transparent backdrop — sits just below the panel, covers the whole
      // viewport. Clicking it closes the dropdown. Gives the user a clear
      // "everything else is off limits" signal without any visible overlay.
      var backdrop = document.createElement('div');
      backdrop.style.cssText =
        'position:fixed;inset:0;z-index:' + (Z_DROPDOWN - 1) + ';' +
        'background:transparent;cursor:default;display:none;';
      backdrop.addEventListener('mousedown', function (e) {
        e.preventDefault(); // don't steal focus from the trigger
        close();
      });

      var _isOpen        = false;
      var _closeTimer    = null;
      var _scrollParents = [];

      function _onEscape(e) {
        if (e.key === 'Escape') close();
      }

      function _getScrollParents() {
        var parents = [];
        var node = anchor.parentNode;
        while (node && node !== document.body) {
          var s = getComputedStyle(node);
          if (/auto|scroll/.test(s.overflow + s.overflowX + s.overflowY)) {
            parents.push(node);
          }
          node = node.parentNode;
        }
        parents.push(window);
        return parents;
      }

      function _position() {
        var rect = anchor.getBoundingClientRect();
        var vw   = window.innerWidth;
        var vh   = window.innerHeight;
        var pw   = panel.offsetWidth  || 220;
        var ph   = panel.offsetHeight || 120;

        var preferTop = placement.startsWith('top');
        var goUp = preferTop
          ? true
          : (vh - rect.bottom < ph + offset && rect.top > vh - rect.bottom);

        var top  = goUp ? rect.top - ph - offset : rect.bottom + offset;
        var left = placement.endsWith('end') ? rect.right - pw : rect.left;

        left = Math.max(8, Math.min(left, vw - pw - 8));
        top  = Math.max(8, Math.min(top,  vh - ph - 8));

        panel.style.top  = top  + 'px';
        panel.style.left = left + 'px';

        if (minWidth === true)        panel.style.minWidth = rect.width + 'px';
        else if (minWidth)            panel.style.minWidth = minWidth + 'px';
      }

      function open() {
        if (_isOpen) return;

        // Cancel any in-flight unmount for this panel
        if (_closeTimer) { clearTimeout(_closeTimer); _closeTimer = null; }

        _isOpen = true;

        backdrop.style.display    = '';
        panel.style.display       = '';
        panel.style.opacity       = '0';
        panel.style.transform     = 'translateY(-4px)';
        panel.style.pointerEvents = 'none';

        Portal.mount(backdrop);
        Portal.mount(panel);
        panel.getBoundingClientRect(); // force layout so dimensions are real
        _position();

        panel.style.opacity       = '1';
        panel.style.transform     = 'translateY(0)';
        panel.style.pointerEvents = 'auto';

        // Per-instance listeners — added on open, removed on close
        _scrollParents = _getScrollParents();
        _scrollParents.forEach(function (p) {
          p.addEventListener('scroll', _position, { passive: true });
        });
        window.addEventListener('resize', _position, { passive: true });
        document.addEventListener('keydown', _onEscape);
      }

      function close() {
        if (!_isOpen) return;
        _isOpen = false;

        // Remove all listeners this instance added
        _scrollParents.forEach(function (p) {
          p.removeEventListener('scroll', _position);
        });
        window.removeEventListener('resize', _position);
        document.removeEventListener('keydown', _onEscape);
        _scrollParents = [];

        // Hide backdrop immediately — no animation needed
        backdrop.style.display    = 'none';
        Portal.unmount(backdrop);

        panel.style.opacity       = '0';
        panel.style.transform     = 'translateY(-4px)';
        panel.style.pointerEvents = 'none';

        _closeTimer = setTimeout(function () {
          _closeTimer = null;
          panel.style.display = 'none';
          Portal.unmount(panel);
          if (onClose) onClose();
        }, 160);
      }

      function toggle() { _isOpen ? close() : open(); }

      function destroy() {
        if (_closeTimer) clearTimeout(_closeTimer);
        if (_isOpen) close();
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        if (panel.parentNode)   panel.parentNode.removeChild(panel);
      }

      function reposition() { requestAnimationFrame(_position); }

      var instance = {
        _el:        panel,
        _anchor:    anchor,
        open:       open,
        close:      close,
        toggle:     toggle,
        destroy:    destroy,
        isOpen:     function () { return _isOpen; },
        reposition: reposition,
      };

      return instance;
    }

    return { create: create };
  })();

  // ── Modal ───────────────────────────────────────────────────────────────────

  /**
   * Modal — centered overlay dialog rendered in the portal.
   * Traps focus, locks scroll, handles Escape.
   *
   * Usage:
   *   var m = Modal.create({
   *     title:     'Confirm Delete',
   *     content:   '<p>Are you sure?</p>',
   *     size:      'sm',          // 'sm'|'md'|'lg'|'xl' — default 'md'
   *     footer:    '<button>OK</button>',
   *     onClose:   function() {},
   *     closeable: true,          // show ✕ and allow Escape/backdrop close
   *   });
   *   m.open();
   *   m.close();
   *
   *   // Or use the shorthand:
   *   Modal.open({ title: 'Hello', content: '<p>World</p>' });
   */
  var Modal = (function () {
    var _stack = []; // support nested modals

    var SIZES = { sm: '400px', md: '520px', lg: '700px', xl: '900px' };

    // Escape closes topmost modal
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && _stack.length) {
        var top = _stack[_stack.length - 1];
        if (top.closeable !== false) top.close();
      }
    });

    function create(opts) {
      var title     = opts.title     || '';
      var content   = opts.content   || '';
      var footer    = opts.footer    || null;
      var size      = opts.size      || 'md';
      var closeable = opts.closeable !== false;
      var onClose   = opts.onClose   || null;
      var onOpen    = opts.onOpen    || null;
      var className = opts.className || '';

      var maxW = SIZES[size] || SIZES.md;

      // Build overlay + dialog
      var overlay = document.createElement('div');
      overlay.style.cssText =
        'position:fixed;inset:0;' +
        'background:rgba(17,24,39,.55);' +
        'backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);' +
        'display:flex;align-items:center;justify-content:center;' +
        'padding:24px;z-index:' + Z_MODAL + ';' +
        'opacity:0;transition:opacity .18s;pointer-events:none;';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      if (title) overlay.setAttribute('aria-label', title);

      var dialog = document.createElement('div');
      dialog.style.cssText =
        'background:var(--surface,#fff);' +
        'border:1px solid var(--border,#e3e6ec);' +
        'border-radius:var(--radius-lg,12px);' +
        'width:100%;max-width:' + maxW + ';' +
        'max-height:90vh;overflow-y:auto;' +
        'transform:translateY(12px) scale(.98);' +
        'transition:transform .22s ' + EASE_OUT + ';' +
        'box-shadow:0 20px 60px rgba(0,0,0,.18);' +
        (className ? '' : '');
      if (className) dialog.className = className;

      // Header
      var header = document.createElement('div');
      header.style.cssText =
        'padding:18px 22px;border-bottom:1px solid var(--border-soft,#edf0f5);' +
        'display:flex;justify-content:space-between;align-items:center;' +
        'position:sticky;top:0;background:var(--surface,#fff);z-index:1;';

      var titleEl = document.createElement('span');
      titleEl.style.cssText = 'font-size:15px;font-weight:600;color:var(--text,#111827)';
      titleEl.textContent = title;
      header.appendChild(titleEl);

      if (closeable) {
        var closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.style.cssText =
          'background:none;border:none;cursor:pointer;color:var(--text-muted,#6b7280);' +
          'padding:4px;border-radius:4px;display:flex;align-items:center;' +
          'transition:background .1s,color .1s;';
        closeBtn.innerHTML =
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        closeBtn.addEventListener('mouseenter', function () {
          closeBtn.style.background = 'var(--surface3,#eef0f4)';
          closeBtn.style.color      = 'var(--text,#111827)';
        });
        closeBtn.addEventListener('mouseleave', function () {
          closeBtn.style.background = '';
          closeBtn.style.color      = '';
        });
        closeBtn.addEventListener('click', function () { instance.close(); });
        header.appendChild(closeBtn);
      }

      // Body
      var body = document.createElement('div');
      body.style.cssText = 'padding:20px 22px;';
      if (typeof content === 'string') {
        body.innerHTML = content;
      } else if (content instanceof HTMLElement) {
        body.appendChild(content);
      }

      // Footer
      var footerEl = null;
      if (footer) {
        footerEl = document.createElement('div');
        footerEl.style.cssText =
          'padding:14px 22px;border-top:1px solid var(--border-soft,#edf0f5);' +
          'display:flex;justify-content:flex-end;gap:8px;' +
          'position:sticky;bottom:0;background:var(--surface,#fff);';
        if (typeof footer === 'string') {
          footerEl.innerHTML = footer;
        } else if (footer instanceof HTMLElement) {
          footerEl.appendChild(footer);
        }
      }

      dialog.appendChild(header);
      dialog.appendChild(body);
      if (footerEl) dialog.appendChild(footerEl);
      overlay.appendChild(dialog);

      // Backdrop click to close
      if (closeable) {
        overlay.addEventListener('mousedown', function (e) {
          if (e.target === overlay) instance.close();
        });
      }

      var _isOpen = false;

      function open() {
        if (_isOpen) return;
        _isOpen = true;
        _stack.push(instance);

        Portal.mount(overlay);
        ScrollLock.lock();
        FocusTrap.activate(dialog);

        // Animate in
        overlay.getBoundingClientRect(); // force layout
        overlay.style.opacity     = '1';
        overlay.style.pointerEvents = 'auto';
        dialog.style.transform    = 'translateY(0) scale(1)';

        if (onOpen) onOpen(instance);
      }

      function close() {
        if (!_isOpen) return;
        _isOpen = false;
        _stack = _stack.filter(function (m) { return m !== instance; });

        overlay.style.opacity     = '0';
        overlay.style.pointerEvents = 'none';
        dialog.style.transform    = 'translateY(12px) scale(.98)';

        FocusTrap.deactivate();
        ScrollLock.unlock();

        setTimeout(function () {
          Portal.unmount(overlay);
          if (onClose) onClose(instance);
        }, 200);
      }

      // Expose body and footer for content updates
      function setContent(html) {
        if (typeof html === 'string') body.innerHTML = html;
        else if (html instanceof HTMLElement) { body.innerHTML = ''; body.appendChild(html); }
      }

      function setTitle(t) {
        titleEl.textContent = t;
      }

      var instance = {
        overlay:    overlay,
        dialog:     dialog,
        body:       body,
        closeable:  closeable,
        open:       open,
        close:      close,
        setContent: setContent,
        setTitle:   setTitle,
      };

      return instance;
    }

    // Shorthand — create + immediately open
    function open(opts) {
      var m = create(opts);
      m.open();
      return m;
    }

    return { create: create, open: open };
  })();

  // ── Drawer ──────────────────────────────────────────────────────────────────

  /**
   * Drawer — slide-in panel from a screen edge.
   *
   * Usage:
   *   var d = Drawer.create({
   *     title:     'Filters',
   *     content:   '<p>Filter controls here</p>',
   *     side:      'right',   // 'right'|'left'|'bottom' — default 'right'
   *     width:     '400px',   // for left/right drawers
   *     height:    '50vh',    // for bottom drawer
   *     onClose:   function() {},
   *   });
   *   d.open();
   */
  var Drawer = (function () {
    function create(opts) {
      var title     = opts.title     || '';
      var content   = opts.content   || '';
      var side      = opts.side      || 'right';
      var width     = opts.width     || '420px';
      var height    = opts.height    || '50vh';
      var closeable = opts.closeable !== false;
      var onClose   = opts.onClose   || null;

      // Backdrop
      var backdrop = document.createElement('div');
      backdrop.style.cssText =
        'position:fixed;inset:0;background:rgba(17,24,39,.4);' +
        'z-index:' + Z_DRAWER + ';opacity:0;pointer-events:none;' +
        'transition:opacity .22s;';

      // Panel
      var panel = document.createElement('div');
      var isHoriz = side === 'left' || side === 'right';
      var panelBase =
        'position:fixed;z-index:' + (Z_DRAWER + 1) + ';' +
        'background:var(--surface,#fff);' +
        'box-shadow:0 0 40px rgba(0,0,0,.18);' +
        'display:flex;flex-direction:column;' +
        'transition:transform .28s ' + EASE_OUT + ';';

      if (side === 'right') {
        panel.style.cssText = panelBase + 'top:0;right:0;bottom:0;width:' + width + ';max-width:95vw;transform:translateX(100%);';
      } else if (side === 'left') {
        panel.style.cssText = panelBase + 'top:0;left:0;bottom:0;width:' + width + ';max-width:95vw;transform:translateX(-100%);';
      } else {
        // bottom
        panel.style.cssText = panelBase + 'left:0;right:0;bottom:0;height:' + height + ';border-radius:12px 12px 0 0;transform:translateY(100%);';
      }

      // Header
      var header = document.createElement('div');
      header.style.cssText =
        'padding:18px 20px;border-bottom:1px solid var(--border,#e3e6ec);' +
        'display:flex;align-items:center;justify-content:space-between;flex-shrink:0;';

      var titleEl = document.createElement('span');
      titleEl.style.cssText = 'font-size:15px;font-weight:600;color:var(--text,#111827)';
      titleEl.textContent = title;
      header.appendChild(titleEl);

      if (closeable) {
        var closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.style.cssText = 'background:none;border:none;cursor:pointer;color:var(--text-muted,#6b7280);padding:4px;border-radius:4px;display:flex;';
        closeBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        closeBtn.addEventListener('click', function () { instance.close(); });
        header.appendChild(closeBtn);
      }

      // Body
      var body = document.createElement('div');
      body.style.cssText = 'flex:1;overflow-y:auto;padding:20px;';
      if (typeof content === 'string') body.innerHTML = content;
      else if (content instanceof HTMLElement) body.appendChild(content);

      panel.appendChild(header);
      panel.appendChild(body);

      if (closeable) {
        backdrop.addEventListener('click', function () { instance.close(); });
      }

      // Escape
      function _onEsc(e) { if (e.key === 'Escape' && closeable) instance.close(); }

      var _isOpen = false;

      function open() {
        if (_isOpen) return;
        _isOpen = true;

        Portal.mount(backdrop);
        Portal.mount(panel);
        ScrollLock.lock();
        FocusTrap.activate(panel);

        backdrop.getBoundingClientRect();
        backdrop.style.opacity      = '1';
        backdrop.style.pointerEvents = 'auto';
        panel.style.transform       = 'translate(0,0)';

        document.addEventListener('keydown', _onEsc);
      }

      function close() {
        if (!_isOpen) return;
        _isOpen = false;

        backdrop.style.opacity      = '0';
        backdrop.style.pointerEvents = 'none';
        if (side === 'right') panel.style.transform = 'translateX(100%)';
        else if (side === 'left') panel.style.transform = 'translateX(-100%)';
        else panel.style.transform = 'translateY(100%)';

        FocusTrap.deactivate();
        ScrollLock.unlock();
        document.removeEventListener('keydown', _onEsc);

        setTimeout(function () {
          Portal.unmount(backdrop);
          Portal.unmount(panel);
          if (onClose) onClose(instance);
        }, 280);
      }

      function setContent(html) {
        if (typeof html === 'string') body.innerHTML = html;
        else if (html instanceof HTMLElement) { body.innerHTML = ''; body.appendChild(html); }
      }

      var instance = {
        panel:      panel,
        body:       body,
        open:       open,
        close:      close,
        setContent: setContent,
      };

      return instance;
    }

    function open(opts) {
      var d = create(opts);
      d.open();
      return d;
    }

    return { create: create, open: open };
  })();

  // ── Tooltip ─────────────────────────────────────────────────────────────────

  /**
   * Tooltip — lightweight hover label anchored to any element.
   *
   * Usage:
   *   // Declarative — add data-tooltip="text" to any element, auto-initialised
   *   <button data-tooltip="Save changes">Save</button>
   *
   *   // Programmatic
   *   var t = Tooltip.create({ anchor: btn, text: 'Save changes', placement: 'top' });
   *   t.show(); t.hide();
   */
  var Tooltip = (function () {
    var _tip = null; // single shared tooltip element, re-used for all

    function _ensureTip() {
      if (!_tip) {
        _tip = document.createElement('div');
        _tip.style.cssText =
          'position:fixed;z-index:' + Z_TOOLTIP + ';' +
          'background:var(--text,#111827);color:#fff;' +
          'font-size:12px;font-family:inherit;' +
          'padding:5px 9px;border-radius:5px;' +
          'pointer-events:none;white-space:nowrap;' +
          'opacity:0;transition:opacity .12s;' +
          'box-shadow:0 2px 8px rgba(0,0,0,.2);';
        Portal.mount(_tip);
      }
      return _tip;
    }

    function _position(anchor, placement) {
      var tip  = _ensureTip();
      var rect = anchor.getBoundingClientRect();
      var tw   = tip.offsetWidth;
      var th   = tip.offsetHeight;
      var gap  = 6;
      var top, left;

      placement = placement || 'top';

      if (placement === 'top') {
        top  = rect.top  - th - gap;
        left = rect.left + rect.width / 2 - tw / 2;
      } else if (placement === 'bottom') {
        top  = rect.bottom + gap;
        left = rect.left + rect.width / 2 - tw / 2;
      } else if (placement === 'left') {
        top  = rect.top  + rect.height / 2 - th / 2;
        left = rect.left - tw - gap;
      } else {
        top  = rect.top  + rect.height / 2 - th / 2;
        left = rect.right + gap;
      }

      // Clamp
      var vw = window.innerWidth, vh = window.innerHeight;
      left = Math.max(8, Math.min(left, vw - tw - 8));
      top  = Math.max(8, Math.min(top,  vh - th - 8));

      tip.style.top  = top  + 'px';
      tip.style.left = left + 'px';
    }

    function create(opts) {
      var anchor    = opts.anchor;
      var text      = opts.text      || '';
      var placement = opts.placement || 'top';

      function show() {
        var tip = _ensureTip();
        tip.textContent = text;
        _position(anchor, placement);
        tip.style.opacity = '1';
      }

      function hide() {
        var tip = _ensureTip();
        tip.style.opacity = '0';
      }

      anchor.addEventListener('mouseenter', show);
      anchor.addEventListener('mouseleave', hide);
      anchor.addEventListener('focus',      show);
      anchor.addEventListener('blur',       hide);

      return { show: show, hide: hide };
    }

    // Auto-init all [data-tooltip] elements
    function init(root) {
      var scope = root || document;
      scope.querySelectorAll('[data-tooltip]').forEach(function (el) {
        create({
          anchor:    el,
          text:      el.dataset.tooltip,
          placement: el.dataset.tooltipPlacement || 'top',
        });
      });
    }

    return { create: create, init: init };
  })();

  // ── Toast ───────────────────────────────────────────────────────────────────

  /**
   * Toast — ephemeral notification shown bottom-right.
   *
   * Usage:
   *   Toast.show('Record saved');
   *   Toast.show('Something went wrong', 'error');
   *   Toast.show('Copied!', 'info', 2000);
   */
  var Toast = (function () {
    var _container = null;

    function _getContainer() {
      if (!_container) {
        _container = document.createElement('div');
        _container.style.cssText =
          'position:fixed;bottom:22px;right:22px;' +
          'display:flex;flex-direction:column-reverse;gap:8px;' +
          'z-index:' + Z_TOAST + ';pointer-events:none;';
        Portal.mount(_container);
      }
      return _container;
    }

    var ICONS = {
      success: '<polyline points="20 6 9 17 4 12"/>',
      error:   '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
      warning: '<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
      info:    '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    };

    var DOT_COLORS = {
      success: '#4ade80',
      error:   '#f87171',
      warning: '#fbbf24',
      info:    '#60a5fa',
    };

    function show(message, type, duration) {
      type     = type     || 'success';
      duration = duration !== undefined ? duration : 3500;

      var c   = _getContainer();
      var el  = document.createElement('div');
      var dot = DOT_COLORS[type] || DOT_COLORS.success;

      el.style.cssText =
        'background:var(--text,#111827);color:#fff;' +
        'border-radius:var(--radius,8px);' +
        'padding:11px 16px;font-size:13px;font-family:inherit;' +
        'max-width:320px;box-shadow:0 8px 24px rgba(0,0,0,.18);' +
        'pointer-events:auto;' +
        'display:flex;align-items:center;gap:9px;' +
        'transform:translateX(16px);opacity:0;' +
        'transition:transform .2s ' + EASE_OUT + ',opacity .2s;';

      el.innerHTML =
        '<span style="flex-shrink:0;color:' + dot + '">' +
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        (ICONS[type] || ICONS.success) +
        '</svg></span>' +
        '<span>' + message + '</span>';

      c.appendChild(el);

      // Animate in
      requestAnimationFrame(function () {
        el.style.transform = 'translateX(0)';
        el.style.opacity   = '1';
      });

      if (duration > 0) {
        setTimeout(function () {
          el.style.transform = 'translateX(16px)';
          el.style.opacity   = '0';
          setTimeout(function () { el.remove(); }, 220);
        }, duration);
      }

      return el;
    }

    return { show: show };
  })();

  // ── Confirm ─────────────────────────────────────────────────────────────────

  /**
   * Confirm — promise-based confirmation dialog.
   * Resolves true on confirm, false on cancel.
   *
   * Usage:
   *   Confirm.show({
   *     title:    'Delete record',
   *     message:  'This cannot be undone.',
   *     confirm:  'Delete',
   *     cancel:   'Cancel',
   *     danger:   true,
   *   }).then(function(ok) {
   *     if (ok) doDelete();
   *   });
   *
   *   // async/await friendly
   *   if (await Confirm.show({ title: 'Sure?' })) doIt();
   */
  var Confirm = (function () {
    function show(opts) {
      opts = opts || {};
      var title      = opts.title   || 'Are you sure?';
      var message    = opts.message || '';
      var confirmTxt = opts.confirm || 'Confirm';
      var cancelTxt  = opts.cancel  || 'Cancel';
      var danger     = opts.danger  !== false;

      return new Promise(function (resolve) {
        var confirmBtnStyle =
          'padding:7px 16px;border-radius:6px;font-size:13px;font-weight:500;cursor:pointer;border:1px solid transparent;font-family:inherit;transition:all .12s;' +
          (danger
            ? 'background:var(--danger,#dc2626);color:#fff;border-color:var(--danger,#dc2626);'
            : 'background:var(--primary,#2563eb);color:#fff;border-color:var(--primary,#2563eb);');

        var bodyContent = message
          ? '<p style="color:var(--text-soft,#374151);line-height:1.6;font-size:13.5px">' + message + '</p>'
          : '';

        var footerHtml =
          '<button id="_confirm-cancel" style="padding:7px 16px;border-radius:6px;font-size:13px;font-weight:500;cursor:pointer;background:transparent;border:1px solid var(--border,#e3e6ec);color:var(--text-soft,#374151);font-family:inherit;transition:all .12s">' +
          cancelTxt + '</button>' +
          '<button id="_confirm-ok" style="' + confirmBtnStyle + '">' + confirmTxt + '</button>';

        var m = Modal.create({
          title:     title,
          content:   bodyContent,
          footer:    footerHtml,
          size:      'sm',
          closeable: true,
          onClose:   function () { resolve(false); },
        });

        m.open();

        // Wire buttons after DOM is ready
        requestAnimationFrame(function () {
          var okBtn     = m.dialog.querySelector('#_confirm-ok');
          var cancelBtn = m.dialog.querySelector('#_confirm-cancel');

          if (okBtn) {
            okBtn.addEventListener('click', function () {
              m.close();
              resolve(true);
            });
          }
          if (cancelBtn) {
            cancelBtn.addEventListener('click', function () {
              m.close();
              resolve(false);
            });
          }
        });
      });
    }

    return { show: show };
  })();

  // ── Auto-init ────────────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    // Init declarative tooltips
    Tooltip.init(document);
  });

  // ── Public API ───────────────────────────────────────────────────────────────

  root.UI = {
    Portal:     Portal,
    Dropdown:   Dropdown,
    Modal:      Modal,
    Drawer:     Drawer,
    Tooltip:    Tooltip,
    Toast:      Toast,
    Confirm:    Confirm,
    FocusTrap:  FocusTrap,
    ScrollLock: ScrollLock,
  };

}(typeof window !== 'undefined' ? window : this));