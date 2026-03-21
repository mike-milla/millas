/**
 * date-picker.js — Custom date/datetime picker for Millas Admin
 *
 * Django-style: month nav header, week labels, date grid, shortcuts.
 * Portal-rendered via UI.Dropdown so it is never clipped by parent overflow.
 * Works for both `date` and `datetime-local` fields.
 *
 * Usage (automatic — attaches to all .dp-trigger inputs on DOMContentLoaded):
 *   <input type="text" class="dp-trigger form-control"
 *     data-target="field-my_date"
 *     data-mode="date">           <!-- or "datetime" -->
 *
 * Exposed on window.DatePicker for programmatic use.
 */
(function ($, root) {
  'use strict';

  var DAYS_SHORT  = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  var MONTHS      = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];

  // ── Shared calendar panel (one, reused) ───────────────────────────────────
  var _panel      = null;   // DOM element
  var _dd         = null;   // UI.Dropdown instance
  var _target     = null;   // current hidden input el
  var _trigger    = null;   // current trigger input el
  var _mode       = 'date'; // 'date' | 'datetime'
  var _current    = null;   // Date being viewed (month/year nav)
  var _selected   = null;   // currently selected Date

  function _buildPanel() {
    var el = document.createElement('div');
    el.className = 'dp-panel';
    el.innerHTML =
      '<div class="dp-header">' +
        '<button type="button" class="dp-nav-btn" id="dp-prev" title="Previous month">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>' +
        '</button>' +
        '<span class="dp-month-label" id="dp-month-label"></span>' +
        '<button type="button" class="dp-nav-btn" id="dp-next" title="Next month">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="dp-weekdays" id="dp-weekdays"></div>' +
      '<div class="dp-grid" id="dp-grid"></div>' +
      '<div class="dp-shortcuts">' +
        '<button type="button" class="dp-shortcut" data-offset="-1">Yesterday</button>' +
        '<button type="button" class="dp-shortcut" data-offset="0">Today</button>' +
        '<button type="button" class="dp-shortcut" data-offset="1">Tomorrow</button>' +
      '</div>' +
      '<div class="dp-time-row" id="dp-time-row" style="display:none">' +
        '<label class="dp-time-label">Time</label>' +
        '<input type="time" class="dp-time-input" id="dp-time-input" step="60">' +
      '</div>' +
      '';

    // Weekday headers
    var $days = el.querySelector('#dp-weekdays');
    DAYS_SHORT.forEach(function (d) {
      var s = document.createElement('span');
      s.className = 'dp-day-hdr';
      s.textContent = d;
      $days.appendChild(s);
    });

    // Month nav
    el.querySelector('#dp-prev').addEventListener('click', function () {
      _current.setMonth(_current.getMonth() - 1);
      _renderGrid();
    });
    el.querySelector('#dp-next').addEventListener('click', function () {
      _current.setMonth(_current.getMonth() + 1);
      _renderGrid();
    });

    // Shortcuts
    el.querySelectorAll('.dp-shortcut').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var offset = parseInt(btn.dataset.offset);
        var d = new Date();
        d.setDate(d.getDate() + offset);
        _selected = d;
        _current  = new Date(d.getFullYear(), d.getMonth(), 1);
        _renderGrid();
        if (_mode === 'date') _apply();
      });
    });


    return el;
  }

  function _renderGrid() {
    var label = el('#dp-month-label');
    if (label) label.textContent = MONTHS[_current.getMonth()] + ' ' + _current.getFullYear();

    var grid = el('#dp-grid');
    if (!grid) return;
    grid.innerHTML = '';

    var today = new Date();
    today.setHours(0,0,0,0);

    var year  = _current.getFullYear();
    var month = _current.getMonth();

    // First day of month (0=Sun)
    var firstDay = new Date(year, month, 1).getDay();
    // Days in month
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    // Days in prev month
    var daysInPrev  = new Date(year, month, 0).getDate();

    // Previous month filler
    for (var p = firstDay - 1; p >= 0; p--) {
      grid.appendChild(_cell(daysInPrev - p, false, false, true));
    }

    // Current month days
    for (var d = 1; d <= daysInMonth; d++) {
      var date  = new Date(year, month, d);
      var isTod = date.getTime() === today.getTime();
      var isSel = _selected
        ? (date.getFullYear() === _selected.getFullYear() &&
           date.getMonth()    === _selected.getMonth()    &&
           date.getDate()     === _selected.getDate())
        : false;
      grid.appendChild(_cell(d, isTod, isSel, false, date));
    }

    // Next month filler
    var total = firstDay + daysInMonth;
    var rem   = total % 7 === 0 ? 0 : 7 - (total % 7);
    for (var n = 1; n <= rem; n++) {
      grid.appendChild(_cell(n, false, false, true));
    }

    // Time row visibility
    var timeRow = el('#dp-time-row');
    if (timeRow) timeRow.style.display = _mode === 'datetime' ? 'flex' : 'none';

    // Reposition dropdown after content change
    if (_dd) _dd.reposition();
  }

  function _cell(day, isToday, isSelected, isMuted, date) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dp-cell' +
      (isToday    ? ' dp-today'    : '') +
      (isSelected ? ' dp-selected' : '') +
      (isMuted    ? ' dp-muted'    : '');
    btn.textContent = day;
    if (date) {
      btn.addEventListener('click', function () {
        _selected = date;
        _renderGrid(); // re-render to update selection highlight
        if (_mode === 'date') {
          _apply();
        }
        // datetime: auto-apply immediately too
        _apply();
      });
    }
    return btn;
  }

  function _apply() {
    if (!_selected || !_target || !_trigger) return;

    var y  = _selected.getFullYear();
    var mo = String(_selected.getMonth() + 1).padStart(2, '0');
    var d  = String(_selected.getDate()).padStart(2, '0');

    if (_mode === 'datetime') {
      var timeInput = el('#dp-time-input');
      var time = (timeInput && timeInput.value) ? timeInput.value : '00:00';
      _target.value  = y + '-' + mo + '-' + d + 'T' + time;
      _trigger.value = _formatDisplay(y + '-' + mo + '-' + d, time);
    } else {
      _target.value  = y + '-' + mo + '-' + d;
      _trigger.value = _formatDisplayDate(y, mo, d);
    }

    // Fire change on hidden input
    _target.dispatchEvent(new Event('change', { bubbles: true }));
    _close();
  }

  function _formatDisplayDate(y, mo, d) {
    return MONTHS[parseInt(mo) - 1].slice(0, 3) + ' ' + parseInt(d) + ', ' + y;
  }

  function _formatDisplay(dateStr, time) {
    var parts = dateStr.split('-');
    return _formatDisplayDate(parts[0], parts[1], parts[2]) + ' ' + time;
  }

  function _close() {
    if (_dd) _dd.close();
  }

  function el(id) {
    return _panel ? _panel.querySelector(id) : null;
  }

  // ── Open ──────────────────────────────────────────────────────────────────

  function open(triggerEl, targetEl, mode) {
    _trigger = triggerEl;
    _target  = targetEl;
    _mode    = mode || 'date';

    // Parse existing value
    var raw = targetEl.value;
    if (raw) {
      var d = new Date(raw);
      if (!isNaN(d.getTime())) {
        _selected = d;
        // Pre-fill time input for datetime
        if (_mode === 'datetime') {
          var h = String(d.getHours()).padStart(2, '0');
          var m = String(d.getMinutes()).padStart(2, '0');
          var timeEl = _panel.querySelector('#dp-time-input');
          if (timeEl) timeEl.value = h + ':' + m;
        }
      } else {
        _selected = null;
      }
    } else {
      _selected = null;
    }

    // Navigate to selected month or today
    var nav = _selected ? new Date(_selected) : new Date();
    _current = new Date(nav.getFullYear(), nav.getMonth(), 1);

    _renderGrid();

    // Reposition after render so the dropdown reads the panel's actual
    // height (which varies: 5-row vs 6-row month, time row visible or not)
    // and flips above the anchor if there isn't enough room below.
    if (_dd && _dd.isOpen()) {
      _dd.reposition();
    }

    // Create a new dropdown each open (anchor may differ)
    if (_dd) _dd.destroy();
    _dd = UI.Dropdown.create({
      anchor:    triggerEl,
      content:   _panel,
      placement: 'bottom-start',
      offset:    4,
      maxHeight: 440,   // tallest month (6 rows) + shortcuts + time row ≈ 400px
      onClose:   function () { _dd = null; },
    });
    _dd.open();
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  function init() {
    _panel = _buildPanel();

    document.querySelectorAll('.dp-trigger').forEach(function (trigger) {
      var targetId = trigger.dataset.target;
      var mode     = trigger.dataset.mode || 'date';
      var target   = document.getElementById(targetId);
      if (!target) return;

      // Show formatted display value on load
      if (target.value) {
        var d = new Date(target.value);
        if (!isNaN(d.getTime())) {
          if (mode === 'datetime') {
            var h  = String(d.getHours()).padStart(2,'0');
            var m  = String(d.getMinutes()).padStart(2,'0');
            trigger.value = _formatDisplay(
              d.getFullYear() + '-' +
              String(d.getMonth()+1).padStart(2,'0') + '-' +
              String(d.getDate()).padStart(2,'0'),
              h + ':' + m
            );
          } else {
            trigger.value = _formatDisplayDate(
              d.getFullYear(),
              String(d.getMonth()+1).padStart(2,'0'),
              String(d.getDate()).padStart(2,'0')
            );
          }
        }
      }

      trigger.addEventListener('click', function () {
        open(trigger, target, mode);
      });
      trigger.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(trigger, target, mode); }
      });

      // Make it read-only so browser native picker doesn't interfere
      trigger.setAttribute('readonly', 'readonly');
    });
  }

  $(function () {
    if (typeof UI === 'undefined') {
      console.warn('[DatePicker] UI not loaded — date picker will not initialise');
      return;
    }
    init();
  });

  root.DatePicker = { open: open, init: init };

}(jQuery, window));