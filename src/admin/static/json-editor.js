/**
 * json-editor.js — Phase 7: Polish
 *
 * PHASE 1: Stable DOM, incremental mutations, focus preserved
 * PHASE 2: Explicit root type toggle, array index badges, no heuristic serialisation
 * PHASE 3: row._depth/_isArray stored on row, _detachSubtree, infinite nesting
 * PHASE 4: Type switching with inline safety banner, serialize-to-string escape hatch
 * PHASE 5: Drag to reorder — same-level, drop indicator, no re-render
 * PHASE 6: Undo / redo — snapshot stack, Ctrl+Z/Y, toolbar buttons
 * PHASE 7 (new):
 *   - Keyboard navigation: Arrow Up/Down moves focus between rows,
 *     Arrow Right expands a collapsed container, Arrow Left collapses it,
 *     Tab/Shift+Tab moves between editable fields within a row,
 *     Delete/Backspace on a focused empty row removes it
 *   - Paste at every level: value inputs now also detect JSON paste,
 *     not just key inputs. Pasting a plain value into a string field
 *     still works normally — only valid JSON objects/arrays are intercepted
 *   - Empty state: #je-tree shows a friendly placeholder when _tree is empty,
 *     with a quick-add button
 *   - Error state: _fullRender wraps in try/catch and shows an inline error
 *     message if something goes wrong rather than silently breaking
 *   - Number input: type="number" on number rows so mobile gets a numpad
 *     and browser validates; value is still stored as JS number
 *   - Key dedup warning: duplicate keys in the same object are highlighted
 *     in red with a tooltip — they will overwrite each other on serialise
 *   - Snapshot dedup: consecutive identical snapshots are not pushed
 *     (prevents undo stack filling up from rapid type-ahead in key/value)
 *   - _renderTree alias removed — was only kept for legacy; gone cleanly
 */
(function (root) {
  'use strict';

  var PREVIEW_ROWS  = 3;
  // Phase 3: TREE_COLLAPSE removed — all rows always visible at every depth.
  var TYPE_COLORS   = {
    string:  'var(--success,#16a34a)',
    number:  'var(--info,#0284c7)',
    boolean: 'var(--warning,#d97706)',
    null:    'var(--text-xmuted,#9ca3af)',
    object:  'var(--primary,#2563eb)',
    array:   'var(--primary,#2563eb)',
  };

  // ── State ──────────────────────────────────────────────────────────────────
  var _fieldName = null;
  var _modal     = null;
  var _view      = 'pretty';
  var _tree      = [];
  var _rootType  = 'object';
  var _template  = null;
  var _nextId    = 1;

  // Phase 5: drag state
  var _dragRow       = null;
  var _dragIndicator = null;

  // Phase 6: undo / redo
  var _undoStack = [];  // array of snapshot strings (oldest first)
  var _redoStack = [];  // array of snapshot strings
  var UNDO_LIMIT = 50;

  function _id() { return _nextId++; }

  // ── Phase 6: Undo / Redo ───────────────────────────────────────────────────

  /**
   * Take a snapshot of the current tree BEFORE a mutation.
   * Call this at the top of every function that changes _tree or _rootType.
   * Clears the redo stack — a new action forks the history.
   */
  function _snapshot() {
    var snap = JSON.stringify({ rootType: _rootType, tree: _serialiseForHistory() });
    // Phase 7: dedup — don't push if identical to the last snapshot
    if (_undoStack.length && _undoStack[_undoStack.length - 1] === snap) return;
    _undoStack.push(snap);
    if (_undoStack.length > UNDO_LIMIT) _undoStack.shift();
    _redoStack = [];
    _updateUndoButtons();
  }

  function _undo() {
    if (!_undoStack.length) return;
    // Push current state onto redo stack before restoring
    _redoStack.push(JSON.stringify({ rootType: _rootType, tree: _serialiseForHistory() }));
    var snap = _undoStack.pop();
    _restoreSnapshot(snap);
    _updateUndoButtons();
  }

  function _redo() {
    if (!_redoStack.length) return;
    _undoStack.push(JSON.stringify({ rootType: _rootType, tree: _serialiseForHistory() }));
    var snap = _redoStack.pop();
    _restoreSnapshot(snap);
    _updateUndoButtons();
  }

  /**
   * Serialise the current tree to a plain JS value (no DOM refs) for history storage.
   * Uses the same _serialise() path so it's always consistent.
   */
  function _serialiseForHistory() {
    return _serialise();
  }

  /**
   * Restore tree from a snapshot string.
   * Parses → _objToRows → _fullRender. Fast because _objToRows is pure data.
   */
  function _restoreSnapshot(snap) {
    try {
      var state = JSON.parse(snap);
      _rootType = state.rootType || 'object';
      _tree     = _objToRows(state.tree);
      _renderRootTypeToggle();
      _fullRender();
      _updateCount();
    } catch(e) {
      console.error('[JsonEditor] undo/redo restore failed:', e);
    }
  }

  /** Clear both stacks — called on open() so each editor session starts fresh. */
  function _clearHistory() {
    _undoStack = [];
    _redoStack = [];
    _updateUndoButtons();
  }

  /** Refresh the enabled/disabled state of the undo/redo toolbar buttons. */
  function _updateUndoButtons() {
    var undoBtn = document.getElementById('je-undo-btn');
    var redoBtn = document.getElementById('je-redo-btn');
    if (undoBtn) undoBtn.disabled = (_undoStack.length === 0);
    if (redoBtn) redoBtn.disabled = (_redoStack.length === 0);
  }

  /** Global keydown handler — attached while the modal is open. */
  function _onKeyDown(e) {
    var isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    var mod   = isMac ? e.metaKey : e.ctrlKey;

    // ── Undo / Redo ──────────────────────────────────────────────────────────
    if (mod) {
      if (e.key === 'z' && !e.shiftKey) {
        if (document.activeElement && document.activeElement.id === 'je-raw-ta') return;
        e.preventDefault();
        _undo();
        return;
      }
      if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
        if (document.activeElement && document.activeElement.id === 'je-raw-ta') return;
        e.preventDefault();
        _redo();
        return;
      }
    }

    // ── Tree keyboard navigation (Phase 7) ──────────────────────────────────
    // Only active when focus is on a je-row or a direct child of one
    var active = document.activeElement;
    if (!active) return;
    var rowEl = active.closest ? active.closest('.je-row') : null;
    if (!rowEl) return;

    // Find the row object from the element
    var row = _rowFromEl(rowEl);
    if (!row) return;

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        var next = _nextVisibleRow(rowEl);
        if (next) _focusRowEl(next);
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        var prev = _prevVisibleRow(rowEl);
        if (prev) _focusRowEl(prev);
        break;
      }
      case 'ArrowRight': {
        // Expand if collapsed container and focus not in a text input
        if (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') return;
        if ((row.type === 'object' || row.type === 'array') && row.collapsed) {
          e.preventDefault();
          _toggleCollapse(row);
        }
        break;
      }
      case 'ArrowLeft': {
        if (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') return;
        if ((row.type === 'object' || row.type === 'array') && !row.collapsed) {
          e.preventDefault();
          _toggleCollapse(row);
        } else if (row._depth > 0) {
          // Jump to parent row
          e.preventDefault();
          var parentEl = _findParentRowEl(rowEl);
          if (parentEl) _focusRowEl(parentEl);
        }
        break;
      }
      case 'Delete':
      case 'Backspace': {
        // Delete the row only if focus is on the row itself (not inside an input)
        if (active === rowEl) {
          e.preventDefault();
          _deleteRow(row);
        }
        break;
      }
    }
  }

  // ── Phase 7: keyboard nav helpers ─────────────────────────────────────────

  /** Find the row object whose _el matches a DOM element. */
  function _rowFromEl(el) {
    return _findRowByEl(el, _tree);
  }
  function _findRowByEl(el, rows) {
    for (var i = 0; i < rows.length; i++) {
      if (rows[i]._el === el) return rows[i];
      if (rows[i].children) {
        var found = _findRowByEl(el, rows[i].children);
        if (found) return found;
      }
    }
    return null;
  }

  /** Next visible je-row element in DOM order. */
  function _nextVisibleRow(rowEl) {
    var all = Array.from(document.getElementById('je-tree').querySelectorAll('.je-row'));
    var idx = all.indexOf(rowEl);
    return idx >= 0 && idx < all.length - 1 ? all[idx + 1] : null;
  }

  /** Previous visible je-row element in DOM order. */
  function _prevVisibleRow(rowEl) {
    var all = Array.from(document.getElementById('je-tree').querySelectorAll('.je-row'));
    var idx = all.indexOf(rowEl);
    return idx > 0 ? all[idx - 1] : null;
  }

  /** Focus a row element — make it tabbable and focus it. */
  function _focusRowEl(rowEl) {
    if (!rowEl) return;
    rowEl.setAttribute('tabindex', '0');
    rowEl.focus();
  }

  /** Find the parent row element of a nested row by walking up through .je-children. */
  function _findParentRowEl(rowEl) {
    var childrenWrap = rowEl.parentNode;
    if (!childrenWrap || !childrenWrap.classList.contains('je-children')) return null;
    // The parent row is the sibling immediately before the children wrapper
    var prev = childrenWrap.previousSibling;
    while (prev && !prev.classList) prev = prev.previousSibling;
    return (prev && prev.classList.contains('je-row')) ? prev : null;
  }

  // ── Row factory ────────────────────────────────────────────────────────────
  // row._el              → its <div class="je-row"> in the DOM (null until mounted)
  // row._childrenEl      → its <div class="je-children"> wrapper (null until mounted)
  // row._depth           → nesting depth (0 = root), set at mount time (Phase 3)
  // row._isArray         → whether THIS row lives inside an array container (Phase 3)
  // row.isArrayContainer → true when this object/array row holds array items (Phase 2)
  function makeRow(key, type, value, children, isArrayContainer) {
    return {
      id:                _id(),
      key:               key,
      type:              type,
      value:             value,
      children:          children || null,
      isArrayContainer:  !!isArrayContainer,
      collapsed:         true,
      _el:               null,
      _childrenEl:       null,
      _depth:            0,
      _isArray:          false,
      _warnEl:           null,  // Phase 4: active type-change warning banner
      _dragEl:           null,  // Phase 5: drag handle element reference
    };
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  function open(fieldName) {
    _fieldName = fieldName;
    var raw = document.getElementById('field-' + fieldName).value || '{}';
    var parsed;
    try { parsed = JSON.parse(raw); } catch(e) { parsed = {}; }

    _rootType = Array.isArray(parsed) ? 'array' : 'object';
    _tree     = _objToRows(parsed);
    _view     = 'pretty';

    _clearHistory(); // Phase 6: fresh history per session

    var $content = $(_template.cloneNode(true));
    $content.css('display', '');

    _modal = UI.Modal.create({
      title:     'JSON Editor',
      size:      'lg',
      className: 'je-modal',
      content:   $content[0],
      onClose:   function() {
        document.removeEventListener('keydown', _onKeyDown); // Phase 6
        _modal = null;
      },
    });

    _modal.open();
    document.addEventListener('keydown', _onKeyDown); // Phase 6

    $content.find('#je-title').text(fieldName.replace(/_/g, ' '));
    _renderRootTypeToggle();
    _setView('pretty');
    _updateCount();
    _updateUndoButtons(); // Phase 6: initialise button states
  }

  // Phase 2: render the root-level {obj} / [arr] toggle in the toolbar
  function _renderRootTypeToggle() {
    var wrap = document.getElementById('je-root-type-wrap');
    if (!wrap) return;
    wrap.innerHTML = '';

    var label = document.createElement('span');
    label.className = 'je-root-type-label';
    label.textContent = 'Root:';
    wrap.appendChild(label);

    ['object', 'array'].forEach(function(t) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'je-root-type-btn' + (_rootType === t ? ' active' : '');
      btn.textContent = t === 'object' ? '{ } object' : '[ ] array';
      btn.dataset.type = t;
      btn.addEventListener('click', function() {
        if (_rootType === t) return;
        _snapshot(); // Phase 6
        _rootType = t;
        // Update button states
        wrap.querySelectorAll('.je-root-type-btn').forEach(function(b) {
          b.classList.toggle('active', b.dataset.type === t);
        });
        // Full re-render — structure changed
        _fullRender();
        _updateCount();
      });
      wrap.appendChild(btn);
    });
  }

  function _apply() {
    if (_view === 'raw') {
      var raw = document.getElementById('je-raw-ta').value;
      var parsed;
      try { parsed = JSON.parse(raw); } catch(e) {
        _showRawHint('Invalid JSON — fix before applying', true);
        return;
      }
      _rootType = Array.isArray(parsed) ? 'array' : 'object';
      _tree     = _objToRows(parsed);
    }

    var result  = _serialise();
    var jsonStr = JSON.stringify(result);

    document.getElementById('field-' + _fieldName).value = jsonStr;
    _renderPreview(_fieldName, result);
    document.removeEventListener('keydown', _onKeyDown); // Phase 6
    _modal.close();
    _modal = null;
  }

  function _cancel() {
    document.removeEventListener('keydown', _onKeyDown); // Phase 6
    if (_modal) { _modal.close(); _modal = null; }
  }

  function _setView(v) {
    _view = v;
    $('#je-tab-pretty').toggleClass('active', v === 'pretty');
    $('#je-tab-raw').toggleClass('active',    v === 'raw');
    $('#je-format-btn').toggle(v === 'raw');

    if (v === 'raw') {
      var obj = _serialise();
      $('#je-raw-ta').val(JSON.stringify(obj, null, 2));
      _showRawHint('');
      $('#je-pretty-view').hide();
      $('#je-raw-view').show();
      $('#je-raw-ta').focus();
    } else {
      // Sync raw → tree if switching back
      var rawVal = $('#je-raw-ta').val();
      if (rawVal) {
        try {
          var parsed = JSON.parse(rawVal);
          _rootType  = Array.isArray(parsed) ? 'array' : 'object';
          _tree      = _objToRows(parsed);
          _showRawHint('');
        } catch(e) { /* keep current tree */ }
      }
      $('#je-raw-view').hide();
      $('#je-pretty-view').show();
      _renderRootTypeToggle();
      _fullRender();
    }
    _updateCount();
  }

  function _format() {
    var raw = $('#je-raw-ta').val();
    try {
      $('#je-raw-ta').val(JSON.stringify(JSON.parse(raw), null, 2));
      _showRawHint('Formatted', false);
    } catch(e) {
      _showRawHint('Invalid JSON', true);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  RENDERING — stable DOM approach
  // ══════════════════════════════════════════════════════════════════════════

  // Full render: clears #je-tree and rebuilds from _tree.
  // Only called on open(), view switch, root type toggle, paste, or undo/redo.
  function _fullRender() {
    var treeEl = document.getElementById('je-tree');
    if (!treeEl) return;
    treeEl.innerHTML = '';

    // Phase 7: empty state
    if (!_tree.length) {
      var empty = document.createElement('div');
      empty.className = 'je-empty-state';
      empty.innerHTML =
        '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--border)"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
        '<p>No entries yet.</p>' +
        '<button type="button" class="je-empty-add-btn">+ Add first row</button>';
      empty.querySelector('.je-empty-add-btn').addEventListener('click', function() {
        // Push a blank row into the data model, then do a clean full render
        // so _mountRows sets up the container and add-btn properly
        _snapshot();
        var isArr = _rootType === 'array';
        var row   = makeRow('', 'string', '', null);
        row._depth   = 0;
        row._isArray = isArr;
        _tree.push(row);
        _fullRender();
        _updateCount();
        // Focus the new row's first input
        setTimeout(function() {
          var firstInput = treeEl.querySelector('.je-key-input, .je-val-input');
          if (firstInput) firstInput.focus();
        }, 30);
      });
      treeEl.appendChild(empty);
      return;
    }

    // Phase 7: wrap in try/catch — show inline error if render fails
    try {
      _mountRows(_tree, treeEl, 0, _rootType === 'array');
    } catch(err) {
      console.error('[JsonEditor] render error:', err);
      treeEl.innerHTML =
        '<div class="je-render-error">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
        ' Render error — switch to Raw view to inspect and fix the data.' +
        '</div>';
    }
  }

  /**
   * Mount a list of rows into a container element.
   * Phase 3: all rows always visible — no TREE_COLLAPSE truncation.
   */
  function _mountRows(rows, container, depth, isArray) {
    rows.forEach(function(row) {
      _mountRow(row, container, depth, isArray);
    });
    // Stable add-row button — created once, lives at bottom of this container
    var addBtn = _makeAddBtn(rows, container, depth, isArray);
    addBtn.classList.add('je-add-row-btn--container');
    container.appendChild(addBtn);
  }

  /**
   * Mount a single row into a container.
   * Phase 3: stamps row._depth and row._isArray at mount time.
   */
  function _mountRow(row, container, depth, isArray) {
    row._depth   = depth;   // Phase 3: stored so we don't thread depth everywhere
    row._isArray = isArray; // Phase 3: stored for same reason
    var el = _buildRowEl(row, depth, isArray);
    row._el = el;
    container.appendChild(el);

    if ((row.type === 'object' || row.type === 'array') && !row.collapsed && row.children) {
      _mountChildrenEl(row);
    }
  }

  /**
   * Unmount a row (and its children) from the DOM without touching siblings.
   */
  function _unmountRow(row) {
    if (row._childrenEl && row._childrenEl.parentNode) {
      row._childrenEl.parentNode.removeChild(row._childrenEl);
      row._childrenEl = null;
    }
    if (row._el && row._el.parentNode) {
      row._el.parentNode.removeChild(row._el);
      row._el = null;
    }
  }

  /**
   * Patch an existing row's DOM node in-place.
   * Phase 3: uses row._depth and row._isArray stored on the row.
   */
  function _patchRow(row) {
    if (!row._el) return;
    var depth   = row._depth;
    var isArray = row._isArray;

    // Re-render the toggle icon
    var toggleEl = row._el.querySelector('.je-toggle');
    if (toggleEl) {
      if (row.type === 'object' || row.type === 'array') {
        toggleEl.innerHTML = row.collapsed
          ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>'
          : '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
        toggleEl.classList.add('je-toggle-active');
      } else {
        toggleEl.innerHTML = '';
        toggleEl.classList.remove('je-toggle-active');
      }
    }

    // Update type select colour
    var typeSelect = row._el.querySelector('.je-type-select');
    if (typeSelect) {
      typeSelect.style.color = TYPE_COLORS[row.type] || '';
    }

    // Replace value cell
    var oldValueCell = row._el.querySelector('.je-value-cell');
    if (oldValueCell) {
      var newValueCell = _buildValueCell(row);
      row._el.replaceChild(newValueCell, oldValueCell);
    }

    // Update index badge if this is an array item
    var indexBadge = row._el.querySelector('.je-index-badge');
    if (indexBadge) {
      var idx = _getRowIndex(row);
      indexBadge.textContent = idx >= 0 ? String(idx) : '—';
    }
  }

  /**
   * Mount the children wrapper for a row (object/array that is expanded).
   * Phase 3: uses row._depth instead of a depth argument.
   * Detaches/reattaches the existing wrapper element to keep descendant _el refs valid.
   */
  function _mountChildrenEl(row) {
    if (!row._el) return;
    var childDepth   = row._depth + 1;
    var childIsArray = row.isArrayContainer;

    if (row._childrenEl) {
      // Wrapper already exists — clear only the DOM children, remount rows
      // This preserves the element reference so CSS transitions stay intact
      while (row._childrenEl.firstChild) {
        row._childrenEl.removeChild(row._childrenEl.firstChild);
      }
      _mountRows(row.children, row._childrenEl, childDepth, childIsArray);
      // Re-attach if it was detached
      if (!row._childrenEl.parentNode) {
        row._el.parentNode.insertBefore(row._childrenEl, row._el.nextSibling);
      }
      return;
    }

    var div = document.createElement('div');
    div.className = 'je-children';
    row._childrenEl = div;
    _mountRows(row.children, div, childDepth, childIsArray);
    row._el.parentNode.insertBefore(div, row._el.nextSibling);
  }

  // ── Element builders ───────────────────────────────────────────────────────

  function _buildRowEl(row, depth, isArray) {
    var el = document.createElement('div');
    el.className = 'je-row';
    el.dataset.id = row.id;
    el.draggable = true;
    el.setAttribute('tabindex', '0'); // Phase 7: keyboard nav

    // Phase 5: drag handle — 6-dot grip, leftmost element
    var handle = document.createElement('span');
    handle.className = 'je-drag-handle';
    handle.title = 'Drag to reorder';
    handle.innerHTML =
      '<svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">' +
      '<circle cx="2.5" cy="2.5" r="1.5"/><circle cx="7.5" cy="2.5" r="1.5"/>' +
      '<circle cx="2.5" cy="7"   r="1.5"/><circle cx="7.5" cy="7"   r="1.5"/>' +
      '<circle cx="2.5" cy="11.5" r="1.5"/><circle cx="7.5" cy="11.5" r="1.5"/>' +
      '</svg>';
    row._dragEl = handle;
    el.appendChild(handle);

    // Indent
    if (depth) {
      var indent = document.createElement('span');
      indent.className = 'je-indent';
      indent.style.width = (depth * 20) + 'px';
      el.appendChild(indent);
    }

    // Toggle
    var toggle = document.createElement('span');
    toggle.className = 'je-toggle';
    if (row.type === 'object' || row.type === 'array') {
      toggle.innerHTML = row.collapsed
        ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>'
        : '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
      toggle.classList.add('je-toggle-active');
      toggle.addEventListener('click', function() { _toggleCollapse(row); }); // Phase 3: no depth arg
    }
    el.appendChild(toggle);

    // Phase 2: array items get a read-only index badge; object items get a key input
    if (isArray) {
      var indexBadge = document.createElement('span');
      indexBadge.className = 'je-index-badge';
      // We'll compute the actual index at render time
      indexBadge.textContent = _getRowIndex(row) >= 0 ? String(_getRowIndex(row)) : '—';
      el.appendChild(indexBadge);

      var colon2 = document.createElement('span');
      colon2.className = 'je-colon';
      el.appendChild(colon2);
    } else {
      var keyInput = document.createElement('input');
      keyInput.type = 'text';
      keyInput.className = 'je-key-input';
      keyInput.placeholder = 'key';
      keyInput.value = row.key;
      keyInput.addEventListener('input', function() {
        row.key = keyInput.value;
        _checkDupKey(row, keyInput); // Phase 7
        _updateCount();
      });
      keyInput.addEventListener('paste', function(e) {
        _handlePaste(e, row);
      });
      // Phase 7: initial dup check on mount
      setTimeout(function() { _checkDupKey(row, keyInput); }, 0);
      el.appendChild(keyInput);

      var colon = document.createElement('span');
      colon.className = 'je-colon';
      el.appendChild(colon);
    }

    // Type select
    var typeSelect = document.createElement('select');
    typeSelect.className = 'je-type-select';
    typeSelect.style.color = TYPE_COLORS[row.type] || '';
    ['string','number','boolean','null','object','array'].forEach(function(t) {
      var opt = document.createElement('option');
      opt.value = t;
      opt.text  = t;
      opt.selected = (t === row.type);
      typeSelect.appendChild(opt);
    });
    typeSelect.addEventListener('change', function() {
      _changeType(row, typeSelect.value); // Phase 3: no depth/isArray args
    });
    el.appendChild(typeSelect);

    // Value cell
    el.appendChild(_buildValueCell(row));

    // Delete button
    var delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'je-del-btn';
    delBtn.title = 'Remove';
    delBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    delBtn.addEventListener('click', function() {
      _deleteRow(row);
    });
    el.appendChild(delBtn);

    // Phase 5: drag events
    el.addEventListener('dragstart', function(e) {
      _dragRow = row;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(row.id)); // required by Firefox
      // Use the handle as the drag image anchor so the whole row doesn't ghost weirdly
      setTimeout(function() { el.classList.add('je-dragging'); }, 0);
    });

    el.addEventListener('dragend', function() {
      el.classList.remove('je-dragging');
      _removeDragIndicator();
      _dragRow = null;
    });

    el.addEventListener('dragover', function(e) {
      if (!_dragRow || _dragRow === row) return;
      // Only allow same-container drops
      var dragParent = _findParentRows(_dragRow, _tree);
      var thisParent = _findParentRows(row, _tree);
      if (dragParent !== thisParent) return;

      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      // Decide whether to insert before or after based on cursor Y position
      var rect   = el.getBoundingClientRect();
      var midY   = rect.top + rect.height / 2;
      var before = e.clientY < midY;
      _showDragIndicator(el, before);
    });

    el.addEventListener('dragleave', function(e) {
      // Only remove indicator if leaving to outside this row entirely
      if (!el.contains(e.relatedTarget)) {
        _removeDragIndicator();
      }
    });

    el.addEventListener('drop', function(e) {
      e.preventDefault();
      if (!_dragRow || _dragRow === row) return;

      var dragParent = _findParentRows(_dragRow, _tree);
      var thisParent = _findParentRows(row, _tree);
      if (dragParent !== thisParent) return;

      var rect   = el.getBoundingClientRect();
      var before = e.clientY < rect.top + rect.height / 2;

      _reorderRow(_dragRow, row, before, dragParent);
      _removeDragIndicator();
    });

    return el;
  }

  // Phase 2: find the index of a row in its parent array (for index badge)
  function _getRowIndex(row) {
    var parent = _findParentRows(row, _tree);
    if (!parent) return -1;
    return parent.indexOf(row);
  }

  function _buildValueCell(row) {
    var cell = document.createElement('span');
    cell.className = 'je-value-cell';

    if (row.type === 'object' || row.type === 'array') {
      var count  = row.children ? row.children.length : 0;
      var label  = row.isArrayContainer ? count + ' items' : count + ' keys';
      var badge  = document.createElement('span');
      badge.className = 'je-nested-badge';
      badge.textContent = label;
      badge.addEventListener('click', function() { _toggleCollapse(row); }); // Phase 3
      cell.appendChild(badge);
      return cell;
    }

    if (row.type === 'boolean') {
      var sel = document.createElement('select');
      sel.className = 'je-val-select';
      ['true','false'].forEach(function(v) {
        var o = document.createElement('option');
        o.value = v; o.text = v;
        o.selected = (String(row.value) === v);
        sel.appendChild(o);
      });
      sel.addEventListener('change', function() { row.value = sel.value === 'true'; });
      cell.appendChild(sel);
      return cell;
    }

    if (row.type === 'null') {
      var nullLabel = document.createElement('span');
      nullLabel.className = 'je-null-label';
      nullLabel.textContent = 'null';
      cell.appendChild(nullLabel);
      return cell;
    }

    var input = document.createElement('input');
    // Phase 7: use type="number" for number rows — mobile numpad + browser validation
    input.type = row.type === 'number' ? 'number' : 'text';
    input.className = 'je-val-input';
    input.placeholder = row.type === 'number' ? '0' : 'value';
    input.value = (row.value === null || row.value === undefined) ? '' : String(row.value);
    input.addEventListener('input', function() {
      row.value = row.type === 'number' ? Number(input.value) : input.value;
    });
    input.addEventListener('paste', function(e) { _handlePaste(e, row); }); // Phase 3: no depth/isArray
    cell.appendChild(input);
    return cell;
  }

  function _makeAddBtn(rows, container, depth, isArray) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'je-add-row-btn';
    btn.style.marginLeft = (depth * 20) + 'px';
    btn.innerHTML =
      '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add row';
    btn.addEventListener('click', function() {
      _addRow(rows, container, depth, isArray);
    });
    return btn;
  }

  // ── Row operations ─────────────────────────────────────────────────────────

  /**
   * Toggle collapse on an object/array row.
   * Phase 3: uses row._depth stored on the row.
   * Collapsing detaches the children wrapper from the DOM but keeps the reference.
   * Expanding re-attaches it (or builds it fresh if first expand).
   */
  function _toggleCollapse(row) {
    row.collapsed = !row.collapsed;

    if (row.collapsed) {
      // First recursively detach any expanded descendants so their DOM
      // doesn't linger when the parent wrapper is removed
      _detachSubtree(row);
      if (row._childrenEl && row._childrenEl.parentNode) {
        row._childrenEl.parentNode.removeChild(row._childrenEl);
      }
    } else {
      if (!row.children) row.children = [];
      _mountChildrenEl(row);
    }

    _patchRow(row);
    _updateCount();
  }

  /**
   * Recursively detach all descendant children wrappers from the DOM.
   * Used when collapsing a parent that has expanded children beneath it.
   * Logical collapsed state of descendants is NOT changed — only DOM visibility.
   */
  function _detachSubtree(row) {
    if (!row.children) return;
    row.children.forEach(function(child) {
      _detachSubtree(child);
      if (child._childrenEl && child._childrenEl.parentNode) {
        child._childrenEl.parentNode.removeChild(child._childrenEl);
      }
    });
  }

  /**
   * Change the type of a row.
   * Phase 4: if the row has children and the user is switching to a primitive,
   * show a confirmation with two options:
   *   - Drop children (destructive, was the old silent behaviour)
   *   - Serialize to string (saves the nested value as a JSON string)
   * If there are no children, or the user is switching between object/array, proceed immediately.
   */
  function _changeType(row, newType) {
    var oldType = row.type;

    // Switching between two container types — just update flag and re-render, no data loss
    if ((oldType === 'object' || oldType === 'array') &&
        (newType === 'object' || newType === 'array')) {
      _snapshot(); // Phase 6
      row.type = newType;
      row.isArrayContainer = (newType === 'array');
      // Detach children DOM and rebuild (structure changed)
      if (row._childrenEl && row._childrenEl.parentNode) {
        row._childrenEl.parentNode.removeChild(row._childrenEl);
        row._childrenEl = null;
      }
      row.collapsed = true;
      _patchRow(row);
      _updateCount();
      return;
    }

    // Switching from a container to a primitive — children would be lost
    if ((oldType === 'object' || oldType === 'array') &&
        row.children && row.children.length > 0) {

      _showTypeWarning(row, newType);
      // Revert the <select> visually until the user confirms
      var typeSelect = row._el && row._el.querySelector('.je-type-select');
      if (typeSelect) typeSelect.value = oldType;
      return;
    }

    // Switching from primitive to container — safe, no data loss
    if (newType === 'object' || newType === 'array') {
      _snapshot(); // Phase 6
      row.type = newType;
      if (!row.children) row.children = [];
      row.isArrayContainer = (newType === 'array');
      row.collapsed = true;
      row.value = null;
      if (row._childrenEl && row._childrenEl.parentNode) {
        row._childrenEl.parentNode.removeChild(row._childrenEl);
      }
      _patchRow(row);
      var toggleEl = row._el && row._el.querySelector('.je-toggle');
      if (toggleEl) {
        toggleEl.classList.add('je-toggle-active');
        toggleEl.addEventListener('click', function() { _toggleCollapse(row); });
      }
      _updateCount();
      return;
    }

    // Primitive → different primitive — just update
    _snapshot(); // Phase 6
    row.type  = newType;
    row.value = _defaultValue(newType);
    _patchRow(row);
    _updateCount();
  }

  /**
   * Show a non-blocking inline warning banner under the row when the user tries
   * to switch a container type to a primitive.
   * Offers two actions: Drop children | Serialize as string
   */
  function _showTypeWarning(row, targetType) {
    // Remove any existing warning for this row
    _clearTypeWarning(row);

    var banner = document.createElement('div');
    banner.className = 'je-type-warn';
    banner.dataset.rowId = row.id;

    var icon = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
    var childCount = row.children ? row.children.length : 0;
    var noun = childCount === 1 ? '1 child' : childCount + ' children';

    var msg = document.createElement('span');
    msg.className = 'je-type-warn-msg';
    msg.innerHTML = icon + ' Switching to <strong>' + targetType + '</strong> will remove ' + noun + '.';
    banner.appendChild(msg);

    var actions = document.createElement('span');
    actions.className = 'je-type-warn-actions';

    // Option A: Drop children
    var dropBtn = document.createElement('button');
    dropBtn.type = 'button';
    dropBtn.className = 'je-type-warn-btn je-type-warn-drop';
    dropBtn.textContent = 'Drop children';
    dropBtn.addEventListener('click', function() {
      _snapshot(); // Phase 6
      _clearTypeWarning(row);
      row.type     = targetType;
      row.children = null;
      row.value    = _defaultValue(targetType);
      if (row._childrenEl && row._childrenEl.parentNode) {
        row._childrenEl.parentNode.removeChild(row._childrenEl);
        row._childrenEl = null;
      }
      // Update the select to the confirmed type
      var typeSelect = row._el && row._el.querySelector('.je-type-select');
      if (typeSelect) typeSelect.value = targetType;
      _patchRow(row);
      _updateCount();
    });

    // Option B: Serialize as JSON string
    var serBtn = document.createElement('button');
    serBtn.type = 'button';
    serBtn.className = 'je-type-warn-btn je-type-warn-ser';
    serBtn.textContent = 'Keep as JSON string';
    serBtn.addEventListener('click', function() {
      _snapshot(); // Phase 6
      _clearTypeWarning(row);
      var serialized = JSON.stringify(_rowsToValue(row.children, row.isArrayContainer));
      row.type     = 'string';
      row.children = null;
      row.value    = serialized;
      if (row._childrenEl && row._childrenEl.parentNode) {
        row._childrenEl.parentNode.removeChild(row._childrenEl);
        row._childrenEl = null;
      }
      var typeSelect = row._el && row._el.querySelector('.je-type-select');
      if (typeSelect) typeSelect.value = 'string';
      _patchRow(row);
      _updateCount();
    });

    // Cancel
    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'je-type-warn-btn je-type-warn-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', function() { _clearTypeWarning(row); });

    actions.appendChild(dropBtn);
    actions.appendChild(serBtn);
    actions.appendChild(cancelBtn);
    banner.appendChild(actions);

    // Insert banner immediately after the row element
    if (row._el && row._el.parentNode) {
      var next = row._childrenEl || row._el.nextSibling;
      row._el.parentNode.insertBefore(banner, next);
      row._warnEl = banner;
    }
  }

  function _clearTypeWarning(row) {
    if (row._warnEl && row._warnEl.parentNode) {
      row._warnEl.parentNode.removeChild(row._warnEl);
      row._warnEl = null;
    }
  }

  // ── Phase 7: duplicate key detection ──────────────────────────────────────

  /**
   * Highlight a key input red if its key is a duplicate within its parent object.
   * Clears the highlight if the key is unique or blank.
   */
  function _checkDupKey(row, keyInputEl) {
    var parentRows = _findParentRows(row, _tree);
    if (!parentRows) return;
    var key = row.key;
    if (!key) {
      keyInputEl.classList.remove('je-dup-key');
      keyInputEl.title = '';
      return;
    }
    var count = parentRows.filter(function(r) { return r !== row && r.key === key; }).length;
    if (count > 0) {
      keyInputEl.classList.add('je-dup-key');
      keyInputEl.title = 'Duplicate key — will overwrite on save';
    } else {
      keyInputEl.classList.remove('je-dup-key');
      keyInputEl.title = '';
    }
  }

  // ── Phase 5: Drag to Reorder ───────────────────────────────────────────────

  /**
   * Move draggedRow before or after targetRow within their shared parent array.
   * Splices the data array, then moves the DOM node — no full re-render needed.
   */
  function _reorderRow(draggedRow, targetRow, insertBefore, parentRows) {
    _snapshot(); // Phase 6
    var fromIdx = parentRows.indexOf(draggedRow);
    var toIdx   = parentRows.indexOf(targetRow);
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;

    // Splice data array
    parentRows.splice(fromIdx, 1);
    var newIdx = parentRows.indexOf(targetRow);
    if (insertBefore) {
      parentRows.splice(newIdx, 0, draggedRow);
    } else {
      parentRows.splice(newIdx + 1, 0, draggedRow);
    }

    // Move DOM node — no re-render, just reposition
    var container = targetRow._el.parentNode;
    if (!container) return;

    if (insertBefore) {
      container.insertBefore(draggedRow._el, targetRow._el);
      // Also move children wrapper if expanded
      if (draggedRow._childrenEl) {
        container.insertBefore(draggedRow._childrenEl, targetRow._el);
      }
    } else {
      // Insert after targetRow (and its children if expanded)
      var anchor = (targetRow._childrenEl && targetRow._childrenEl.parentNode)
        ? targetRow._childrenEl.nextSibling
        : targetRow._el.nextSibling;
      container.insertBefore(draggedRow._el, anchor);
      if (draggedRow._childrenEl) {
        container.insertBefore(draggedRow._childrenEl, draggedRow._el.nextSibling);
      }
    }

    // Refresh index badges in the whole container (array items only)
    _refreshIndexBadges(parentRows);
  }

  /**
   * Show or reposition the 2px blue drop indicator line.
   * Inserts it before or after the target row element.
   */
  function _showDragIndicator(targetEl, before) {
    if (!_dragIndicator) {
      _dragIndicator = document.createElement('div');
      _dragIndicator.className = 'je-drop-indicator';
    }
    var parent = targetEl.parentNode;
    if (!parent) return;
    if (before) {
      parent.insertBefore(_dragIndicator, targetEl);
    } else {
      parent.insertBefore(_dragIndicator, targetEl.nextSibling);
    }
  }

  function _removeDragIndicator() {
    if (_dragIndicator && _dragIndicator.parentNode) {
      _dragIndicator.parentNode.removeChild(_dragIndicator);
    }
  }

  /**
   * After a reorder, refresh all index badges in a rows array.
   * Only does anything if the parent is an array container.
   */
  function _refreshIndexBadges(rows) {
    rows.forEach(function(row, i) {
      if (!row._el) return;
      var badge = row._el.querySelector('.je-index-badge');
      if (badge) badge.textContent = String(i);
    });
  }

  /**
   * Add a new empty row to a rows array.
   * Phase 3: stamps row._depth and row._isArray at add time.
   */
  function _addRow(rows, container, depth, isArray) {
    _snapshot(); // Phase 6
    var row = makeRow('', 'string', '', null);
    row._depth   = depth;
    row._isArray = isArray;
    rows.push(row);

    var addBtn = container.querySelector('.je-add-row-btn--container');
    var rowEl  = _buildRowEl(row, depth, isArray);
    row._el    = rowEl;
    if (addBtn) {
      container.insertBefore(rowEl, addBtn);
    } else {
      container.appendChild(rowEl);
    }

    _updateCount();

    setTimeout(function() {
      var keyInput = rowEl.querySelector('.je-key-input');
      if (keyInput) keyInput.focus();
      else {
        var valInput = rowEl.querySelector('.je-val-input');
        if (valInput) valInput.focus();
      }
    }, 30);
  }

  /**
   * Delete a row. Removes from its parent array and from the DOM.
   * Finds the parent array by walking _tree.
   */
  function _deleteRow(row) {
    _snapshot(); // Phase 6
    _clearTypeWarning(row);
    var parentRows = _findParentRows(row, _tree);
    if (parentRows) {
      var idx = parentRows.indexOf(row);
      if (idx > -1) parentRows.splice(idx, 1);
    }
    _unmountRow(row);
    _updateCount();
  }

  function _findParentRows(row, rows) {
    if (rows.indexOf(row) > -1) return rows;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].children) {
        var found = _findParentRows(row, rows[i].children);
        if (found) return found;
      }
    }
    return null;
  }

  // ── Paste detection ────────────────────────────────────────────────────────

  function _handlePaste(e, row) {
    var text = (e.originalEvent
      ? e.originalEvent.clipboardData
      : e.clipboardData
    ).getData('text');

    var trimmed = text.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return;

    try {
      var parsed = JSON.parse(trimmed);
      e.preventDefault();
      _snapshot(); // Phase 6

      if (row && (row.type === 'object' || row.type === 'array') && row._depth > 0) {
        row.isArrayContainer = Array.isArray(parsed);
        row.children  = _objToRows(parsed);
        row.collapsed = false;
        if (row._childrenEl && row._childrenEl.parentNode) {
          row._childrenEl.parentNode.removeChild(row._childrenEl);
          row._childrenEl = null;
        }
        _mountChildrenEl(row);
        _patchRow(row);
      } else {
        _rootType = Array.isArray(parsed) ? 'array' : 'object';
        _tree     = _objToRows(parsed);
        _renderRootTypeToggle();
        _fullRender();
      }
      _updateCount();
    } catch(err) {
      // Not valid JSON — let browser handle
    }
  }

  // ── Conversion helpers ─────────────────────────────────────────────────────

  function _objToRows(obj) {
    if (Array.isArray(obj)) {
      return obj.map(function(v) { return _valueToRow('', v); });
    }
    if (obj && typeof obj === 'object') {
      return Object.keys(obj).map(function(k) { return _valueToRow(k, obj[k]); });
    }
    return [];
  }

  function _valueToRow(key, value) {
    var type = _typeOf(value);
    // Phase 2: set isArrayContainer from the actual JS type
    var isArrayContainer = (type === 'array');
    var row  = makeRow(String(key), type, null, null, isArrayContainer);
    if (type === 'object' || type === 'array') {
      row.children = _objToRows(value);
    } else {
      row.value = value;
    }
    return row;
  }

  // ── Serialisation — Phase 2: no more heuristic array detection ────────────

  // Top-level serialise: uses _rootType
  function _serialise() {
    return _rowsToValue(_tree, _rootType === 'array');
  }

  // Serialise a rows array into a JS value.
  // isArrayContainer comes from the parent row's isArrayContainer flag,
  // or from _rootType at the top level.
  function _rowsToValue(rows, isArrayContainer) {
    if (isArrayContainer) {
      return rows.map(function(r) { return _rowToValue(r); });
    }
    var obj = {};
    rows.forEach(function(r) {
      if (r.key === '') return; // skip blank-keyed rows in objects
      obj[r.key] = _rowToValue(r);
    });
    return obj;
  }

  function _rowToValue(row) {
    if (row.type === 'null')    return null;
    if (row.type === 'boolean') return row.value === true || row.value === 'true';
    if (row.type === 'number')  return Number(row.value);
    if (row.type === 'object' || row.type === 'array') {
      return row.children
        ? _rowsToValue(row.children, row.isArrayContainer)
        : (row.isArrayContainer ? [] : {});
    }
    return row.value === null || row.value === undefined ? '' : String(row.value);
  }

  // Keep _rowsToObj as a thin alias so any external callers don't break
  function _rowsToObj(rows) { return _rowsToValue(rows, false); }

  function _typeOf(v) {
    if (v === null)            return 'null';
    if (Array.isArray(v))      return 'array';
    if (typeof v === 'object') return 'object';
    if (typeof v === 'boolean') return 'boolean';
    if (typeof v === 'number')  return 'number';
    return 'string';
  }

  function _defaultValue(type) {
    if (type === 'string')  return '';
    if (type === 'number')  return 0;
    if (type === 'boolean') return false;
    return null;
  }

  // ── Count + hints ──────────────────────────────────────────────────────────

  function _updateCount() {
    var total = _countRows(_tree);
    var el = document.getElementById('je-count');
    if (el) el.textContent = total + ' entr' + (total === 1 ? 'y' : 'ies');
  }

  function _countRows(rows) {
    return rows.reduce(function(n, r) {
      return n + 1 + (r.children ? _countRows(r.children) : 0);
    }, 0);
  }

  function _showRawHint(msg, isError) {
    var el = document.getElementById('je-raw-hint');
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('je-raw-hint-error', !!isError);
  }

  // ── Inline preview ─────────────────────────────────────────────────────────

  function _renderPreview(fieldName, obj) {
    var wrap = document.getElementById('jep-' + fieldName);
    if (!wrap) return;
    wrap.innerHTML = '';

    if (!obj || typeof obj !== 'object') {
      var ph = document.createElement('span');
      ph.className = 'je-preview-placeholder';
      ph.textContent = String(obj);
      wrap.appendChild(ph);
      return;
    }

    var keys    = Object.keys(obj);
    var visible = keys.slice(0, PREVIEW_ROWS);
    var rest    = keys.length - visible.length;

    visible.forEach(function(k) {
      var v    = obj[k];
      var type = _typeOf(v);
      var disp = type === 'object' ? '{…}' : type === 'array' ? '[…]' : type === 'null' ? 'null' : String(v);

      var chip   = document.createElement('span'); chip.className = 'je-chip';
      var keyEl  = document.createElement('span'); keyEl.className = 'je-chip-key'; keyEl.textContent = k;
      var sepEl  = document.createElement('span'); sepEl.className = 'je-chip-sep'; sepEl.textContent = ': ';
      var valEl  = document.createElement('span'); valEl.className = 'je-chip-val'; valEl.textContent = disp;
      valEl.style.color = TYPE_COLORS[type] || '';
      chip.appendChild(keyEl); chip.appendChild(sepEl); chip.appendChild(valEl);
      wrap.appendChild(chip);
    });

    if (rest > 0) {
      var more = document.createElement('span');
      more.className = 'je-chip-more';
      more.textContent = '+' + rest + ' more';
      wrap.appendChild(more);
    }
    if (keys.length === 0) {
      var empty = document.createElement('span');
      empty.className = 'je-preview-placeholder';
      empty.textContent = '{}  (empty)';
      wrap.appendChild(empty);
    }
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  $(function() {
    var tpl = document.getElementById('je-dialog-content');
    if (!tpl) return;
    _template = tpl.cloneNode(true);
    tpl.parentNode.removeChild(tpl);

    // Render inline previews for any pre-populated JSON fields
    document.querySelectorAll('[id^="jet-"]').forEach(function(el) {
      var fieldName = el.dataset.field;
      var hidden    = document.getElementById('field-' + fieldName);
      if (!hidden || !hidden.value) return;
      try {
        _renderPreview(fieldName, JSON.parse(hidden.value));
      } catch(e) {
        var wrap = document.getElementById('jep-' + fieldName);
        if (wrap) wrap.innerHTML = '<span class="je-preview-placeholder je-preview-error">Invalid JSON</span>';
      }
    });
  });

  // ── Export ─────────────────────────────────────────────────────────────────

  root.JsonEditor = {
    open:     open,
    _apply:   _apply,
    _cancel:  _cancel,
    _setView: _setView,
    _format:  _format,
    _undo:    _undo,   // Phase 6
    _redo:    _redo,   // Phase 6
    _addRootRow: function() {
      var container = document.getElementById('je-tree');
      if (container) _addRow(_tree, container, 0, _rootType === 'array');
    },
  };

}(window));