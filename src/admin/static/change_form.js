/**
 * change_form.js — Millas Admin Form & Detail Pages
 *
 * Tab switching, rich text editor sync, client-side field validation,
 * slug auto-fill (prepopulate), FK dropdown widget, and detail page
 * tab / inline form behaviour.
 *
 * Requires: ui.js, core.js, jQuery
 */
(function ($) {
  'use strict';

  // ── Tab ID helper ────────────────────────────────────────────────────────────
  // Converts a tab name to a CSS-safe id fragment.
  // 'Role & Access' → 'Role--Access'
  function _tabId(name) {
    return name.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  }

  // ── Form tab switching ────────────────────────────────────────────────────────
  window.switchFormTab = function (name, btn) {
    $('.tab-btn').removeClass('active');
    $('.tab-form-panel').removeClass('active').hide();
    $(btn).addClass('active');
    $('#fpanel-' + _tabId(name)).addClass('active').show();
  };

  // ── Detail page tab switching ─────────────────────────────────────────────────
  window.switchTab = function (idx) {
    document.querySelectorAll('.tab-btn').forEach(function (b, i) {
      b.classList.toggle('active', i === idx);
    });
    document.querySelectorAll('.tab-panel').forEach(function (p, i) {
      p.classList.toggle('active', i === idx);
    });
  };

  // Wire tab buttons via data attributes (removes need for onclick)
  $(document).on('click', '.tab-btn[data-tab]', function () {
    switchFormTab($(this).data('tab'), this);
  });

  $(document).on('click', '.tab-btn[data-tab-index]', function () {
    switchTab(parseInt($(this).data('tab-index'), 10));
  });

  // ── Rich text editor ──────────────────────────────────────────────────────────
  window.rtCmd = function (cmd) {
    document.execCommand(cmd, false, null);
  };

  window.rtLink = function () {
    var url = prompt('Enter URL:');
    if (url) document.execCommand('createLink', false, url);
  };

  // Sync rich text editor content back to the hidden textarea on input
  $(document).on('input', '.richtext-editor', function () {
    var fieldName = this.id.replace('rt-', '');
    $('#field-' + fieldName).val(this.innerHTML);
  });

  // Wire rich text toolbar buttons via data attributes
  $(document).on('click', '[data-rt-cmd]', function () {
    rtCmd($(this).data('rt-cmd'));
  });

  $(document).on('click', '[data-rt-link]', function () {
    rtLink();
  });

  // ── Password reveal in form widgets ──────────────────────────────────────────
  $(document).on('click', '[data-pw-toggle]', function () {
    var $input = $(this).prev('input');
    $input.attr('type', $input.attr('type') === 'password' ? 'text' : 'password');
  });

  // ── Inline form show / hide (detail page) ────────────────────────────────────
  $(document).on('click', '[data-inline-show]', function () {
    var id = $(this).data('inline-show');
    $('#' + id).show();
    $(this).hide();
  });

  $(document).on('click', '[data-inline-hide]', function () {
    var id   = $(this).data('inline-hide');
    var $card = $(this).closest('.card');
    $('#' + id).hide();
    $card.find('[data-inline-show="' + id + '"]').show();
  });

  // Native confirm() replacement for inline delete buttons
  $(document).on('click', '[data-confirm-inline]', function (e) {
    var msg = $(this).data('confirm-inline') || 'Are you sure?';
    if (!window.confirm(msg)) {
      e.preventDefault();
      return false;
    }
  });

  // data-confirm-delete wired in detail page (same as core.js confirmDelete)
  $(document).on('click', '[data-confirm-delete]', function () {
    confirmDelete($(this).data('confirm-delete'), $(this).data('confirm-label'));
  });


  function showFieldError(name, msg) {
    var errorIcon = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
                  + '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>'
                  + '<line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
    $('#field-' + name + ', [name="' + name + '"]').first().addClass('error');
    $('#feedback-' + name).html('<span class="form-error">' + errorIcon + ' ' + msg + '</span>');
  }

  function clearFieldError(name) {
    $('#field-' + name + ', [name="' + name + '"]').first().removeClass('error');
    var $fb  = $('#feedback-' + name);
    var help = $fb.data('help');
    $fb.html(help ? '<span class="form-help">' + help + '</span>' : '');
  }

  function validateField(input) {
    var $input   = $(input);
    var name     = $input.attr('name');
    if (!name) return true;

    var val      = $.trim($input.val());
    var required = $input.data('required') === true || $input.data('required') === 'true';
    var validate = $input.data('validate');
    clearFieldError(name);

    if (required && val === '') {
      var label = $('label[for="field-' + name + '"]').text().replace('*', '').trim() || name;
      showFieldError(name, label + ' is required');
      return false;
    }
    if (val && validate === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
      showFieldError(name, 'Please enter a valid email address');
      return false;
    }
    if (val && validate === 'url') {
      try { new URL(val); } catch (e) {
        showFieldError(name, 'Please enter a valid URL (include https://)');
        return false;
      }
    }
    if (val && validate === 'json') {
      try { JSON.parse(val); } catch (e) {
        showFieldError(name, 'Invalid JSON format');
        return false;
      }
    }

    var min = $input.data('min');
    var max = $input.data('max');
    if (val && min !== undefined && Number(val) < Number(min)) {
      showFieldError(name, 'Minimum value is ' + min);
      return false;
    }
    if (val && max !== undefined && Number(val) > Number(max)) {
      showFieldError(name, 'Maximum value is ' + max);
      return false;
    }
    return true;
  }

  // Live validation
  $(document).on('blur',  '.form-control', function () { validateField(this); });
  $(document).on('input', '.form-control', function () {
    if ($(this).hasClass('error')) validateField(this);
  });

  // ── Form submit: validate + loading state ─────────────────────────────────────
  $(document).on('submit', '#record-form', function (e) {
    var valid  = true;
    var $first = null;

    $(this).find('.form-control').each(function () {
      if (!validateField(this)) {
        valid = false;
        if (!$first) $first = $(this);
      }
    });

    if (!valid) {
      e.preventDefault();
      $first.focus();
      $first[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    var $btn = $('#submit-btn');
    $btn.prop('disabled', true).html(
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"'
      + ' stroke-linecap="round" stroke-linejoin="round" style="animation:spin 1s linear infinite">'
      + '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>'
      + '<path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>'
      + '</svg> Saving\u2026'
    );
  });

  // ── Auto-switch to tab containing the first server-side error ────────────────
  $(function () {
    var $firstErr = $('.form-control.error').first();
    if ($firstErr.length) {
      var $panel = $firstErr.closest('.tab-form-panel');
      if ($panel.length) {
        var panelId = $panel.attr('id').replace('fpanel-', '');
        var $tabBtn = $('.tab-btn').filter(function () {
          return _tabId($(this).data('tab')) === panelId;
        }).first();
        if ($tabBtn.length) switchFormTab($tabBtn.data('tab'), $tabBtn[0]);
      }
    }
  });

  // ── Slug auto-fill (prepopulate) ──────────────────────────────────────────────
  function slugify(str) {
    return str.toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  $(function () {
    $('[data-prepopulate]').each(function () {
      var targetName = this.name;
      var sourceName = $(this).data('prepopulate');
      var $src       = $('[name="' + sourceName + '"]');
      var $tgt       = $('[name="' + targetName + '"]');
      if (!$src.length || !$tgt.length) return;

      var userEdited = !!$tgt.val();
      $tgt.on('input', function () { userEdited = true; });
      $src.on('input', function () {
        if (!userEdited) $tgt.val(slugify($src.val()));
      });
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  //  FK DROPDOWN WIDGET
  //  Self-contained — one instance per FK field on the page.
  //  Async, paginated, searchable, keyboard nav.
  // ════════════════════════════════════════════════════════════════════════════
  (function () {
    var ADMIN_PREFIX    = window.MILLAS_ADMIN_PREFIX    || '/admin';
    var SOURCE_RESOURCE = window.MILLAS_RESOURCE_SLUG   || '';
    var PER_PAGE        = 20;
    var DEBOUNCE_MS     = 220;

    function _initAllFKWidgets() {
      document.querySelectorAll('.fk-widget').forEach(function (widget) {
        initFKWidget(widget);
      });
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _initAllFKWidgets);
    } else {
      _initAllFKWidgets();
    }

    function initFKWidget(widget) {
      var name       = widget.dataset.name;
      var resource   = widget.dataset.resource;
      var fkField    = widget.dataset.fkField || name;
      var nullable   = widget.dataset.nullable === 'true';
      var currentId  = widget.dataset.currentId || '';

      var hidden   = document.getElementById('field-' + name);
      var trigger  = document.getElementById('fktrig-' + name);
      var panel    = document.getElementById('fkpanel-' + name);
      var list     = document.getElementById('fklist-' + name);
      var search   = document.getElementById('fksearch-' + name);
      var clearBtn = document.getElementById('fkclear-' + name);
      var footer   = document.getElementById('fkfoot-' + name);
      var countEl  = document.getElementById('fkcount-' + name);
      var pageInfo = document.getElementById('fkpageinfo-' + name);
      var prevBtn  = document.getElementById('fkprev-' + name);
      var nextBtn  = document.getElementById('fknext-' + name);
      var searchClear = widget.querySelector('.fk-search-clear');

      if (!resource) {
        console.warn('[FK Widget] field "' + name + '" has no fkResource — cannot load dropdown.');
        return;
      }
      if (!hidden || !trigger || !panel) {
        console.warn('[FK Widget] field "' + name + '" is missing DOM elements.');
        return;
      }

      var state = {
        open:          false,
        query:         '',
        page:          1,
        total:         0,
        data:          [],
        loading:       false,
        focusIndex:    -1,
        selectedId:    currentId,
        selectedLabel: '',
      };

      var debounceTimer = null;

      // Resolve initial label for pre-selected value
      if (currentId) {
        fetch(ADMIN_PREFIX + '/api/' + resource + '/options?q=&page=1&limit=100&field=' + fkField + '&from=' + SOURCE_RESOURCE)
          .then(function (r) { return r.json(); })
          .then(function (json) {
            var match = (json.data || []).find(function (r) { return String(r.id) === String(currentId); });
            if (match) {
              state.selectedLabel = match.label;
              renderTriggerLabel();
            }
          })
          .catch(function () {});
      }

      var dropdown = UI.Dropdown.create({
        anchor:    trigger,
        content:   panel,
        placement: 'bottom-start',
        offset:    0,
        minWidth:  true,
        maxHeight: 320,
        className: 'fk-panel',
        onClose:   function () {
          state.open = false;
          trigger.setAttribute('aria-expanded', 'false');
          state.focusIndex = -1;
          document.removeEventListener('keydown', globalKeydown);
        },
      });

      function open() {
        if (state.open) return;
        state.open = true;
        state.page = 1;
        trigger.setAttribute('aria-expanded', 'true');
        search.value = '';
        if (searchClear) searchClear.hidden = true;
        state.query = '';
        dropdown.open();
        fetchOptions();
        requestAnimationFrame(function () { search.focus(); });
        document.addEventListener('keydown', globalKeydown);
      }

      function close() {
        if (!state.open) return;
        dropdown.close();
      }

      trigger.addEventListener('click', function () { state.open ? close() : open(); });
      trigger.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
          e.preventDefault();
          open();
        }
      });

      if (search) {
        search.addEventListener('input', function () {
          var q = search.value;
          if (searchClear) searchClear.hidden = !q;
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(function () {
            state.query = q;
            state.page  = 1;
            fetchOptions();
          }, DEBOUNCE_MS);
        });
      }

      if (searchClear) {
        searchClear.addEventListener('click', function () {
          search.value = '';
          searchClear.hidden = true;
          state.query = '';
          state.page  = 1;
          fetchOptions();
          search.focus();
        });
      }

      if (prevBtn) {
        prevBtn.addEventListener('click', function () {
          if (state.page > 1) { state.page--; fetchOptions(); }
        });
      }
      if (nextBtn) {
        nextBtn.addEventListener('click', function () {
          var totalPages = Math.ceil(state.total / PER_PAGE);
          if (state.page < totalPages) { state.page++; fetchOptions(); }
        });
      }
      if (clearBtn) {
        clearBtn.addEventListener('click', function () {
          select(null, '');
          close();
        });
      }

      function fetchOptions() {
        state.loading = true;
        renderList();

        var params = new URLSearchParams({
          q:     state.query,
          page:  state.page,
          limit: PER_PAGE,
          field: fkField,
          from:  SOURCE_RESOURCE,
        });

        fetch(ADMIN_PREFIX + '/api/' + resource + '/options?' + params)
          .then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + r.statusText);
            return r.json();
          })
          .then(function (json) {
            state.data        = json.data  || [];
            state.total       = json.total || 0;
            state.loading     = false;
            state.focusIndex  = -1;
            if (json.labelCol && search) {
              search.placeholder = 'Search by ' + json.labelCol.replace(/_/g, ' ') + '\u2026';
            }
            renderList();
            renderFooter();
          })
          .catch(function (err) {
            state.loading = false;
            state.data    = [];
            console.error('[FK Widget] fetch error for resource "' + resource + '":', err);
            list.innerHTML = '<div class="fk-empty-row">Failed to load \u2014 check console</div>';
          });
      }

      function renderList() {
        if (state.loading) {
          list.innerHTML =
            '<div class="fk-skeleton-row"><span class="fk-skel fk-skel-chip"></span><span class="fk-skel fk-skel-text"></span></div>' +
            '<div class="fk-skeleton-row"><span class="fk-skel fk-skel-chip"></span><span class="fk-skel fk-skel-text" style="width:55%"></span></div>' +
            '<div class="fk-skeleton-row"><span class="fk-skel fk-skel-chip"></span><span class="fk-skel fk-skel-text" style="width:70%"></span></div>';
          return;
        }

        if (!state.data.length) {
          var emptyMsg = state.query
            ? 'No results for <strong style="color:var(--text)">&ldquo;' + escapeHtml(state.query) + '&rdquo;</strong>'
            : 'No records found';
          list.innerHTML =
            '<div class="fk-empty-row">' +
            '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--border);flex-shrink:0"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
            '<span>' + emptyMsg + '</span>' +
            '</div>';
          return;
        }

        list.innerHTML = state.data.map(function (row, i) {
          var isSelected = String(row.id) === String(state.selectedId);
          var isFocused  = i === state.focusIndex;
          return '<div class="fk-option' + (isSelected ? ' fk-selected' : '') + (isFocused ? ' fk-focused' : '') + '"'
            + ' role="option" aria-selected="' + isSelected + '"'
            + ' data-id="' + row.id + '"'
            + ' data-label="' + escapeAttr(String(row.label != null ? row.label : row.id)) + '">'
            + '<span class="fk-id-chip">#' + row.id + '</span>'
            + '<span class="fk-opt-label">' + escapeHtml(String(row.label != null ? row.label : row.id)) + '</span>'
            + (isSelected ? '<svg class="fk-check" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : '')
            + '</div>';
        }).join('');

        list.querySelectorAll('.fk-option').forEach(function (opt) {
          opt.addEventListener('mousedown', function (e) {
            e.preventDefault();
            select(opt.dataset.id, opt.dataset.label);
            close();
          });
          opt.addEventListener('mousemove', function () {
            var idx = Array.from(list.querySelectorAll('.fk-option')).indexOf(opt);
            setFocus(idx);
          });
        });
      }

      function renderFooter() {
        if (!footer) return;
        var totalPages = Math.ceil(state.total / PER_PAGE);
        if (state.total === 0) { footer.hidden = true; return; }
        footer.hidden = false;
        var from = (state.page - 1) * PER_PAGE + 1;
        var to   = Math.min(state.page * PER_PAGE, state.total);
        if (countEl)  countEl.textContent  = from + '\u2013' + to + ' of ' + state.total;
        if (pageInfo) pageInfo.textContent = state.page + ' / ' + totalPages;
        if (prevBtn)  prevBtn.disabled     = state.page <= 1;
        if (nextBtn)  nextBtn.disabled     = state.page >= totalPages;
      }

      function select(id, label) {
        state.selectedId    = id || '';
        state.selectedLabel = label || '';
        hidden.value        = state.selectedId;
        renderTriggerLabel();
        hidden.dispatchEvent(new Event('change', { bubbles: true }));
      }

      function renderTriggerLabel() {
        var labelEl = trigger.querySelector('.fk-trigger-label');
        if (!labelEl) return;
        if (state.selectedId) {
          labelEl.innerHTML =
            '<span class="fk-id-chip">#' + state.selectedId + '</span>' +
            '<span class="fk-selected-label">' + escapeHtml(state.selectedLabel || state.selectedId) + '</span>';
        } else {
          labelEl.innerHTML = '<span class="fk-placeholder">\u2014 Select \u2014</span>';
        }
      }

      function globalKeydown(e) {
        if (!state.open) return;
        var opts = Array.from(list.querySelectorAll('.fk-option'));
        switch (e.key) {
          case 'ArrowDown':
            e.preventDefault();
            setFocus(Math.min(state.focusIndex + 1, opts.length - 1));
            break;
          case 'ArrowUp':
            e.preventDefault();
            setFocus(Math.max(state.focusIndex - 1, 0));
            break;
          case 'Enter':
            e.preventDefault();
            if (state.focusIndex >= 0 && opts[state.focusIndex]) {
              var opt = opts[state.focusIndex];
              select(opt.dataset.id, opt.dataset.label);
              close();
            }
            break;
          case 'Escape':
            e.preventDefault();
            close();
            trigger.focus();
            break;
          case 'Tab':
            close();
            break;
          case 'PageDown':
            e.preventDefault();
            if (nextBtn && !nextBtn.disabled) { state.page++; fetchOptions(); }
            break;
          case 'PageUp':
            e.preventDefault();
            if (prevBtn && !prevBtn.disabled) { state.page--; fetchOptions(); }
            break;
        }
      }

      function setFocus(idx) {
        var opts = Array.from(list.querySelectorAll('.fk-option'));
        opts.forEach(function (o) { o.classList.remove('fk-focused'); });
        state.focusIndex = idx;
        if (idx >= 0 && opts[idx]) {
          opts[idx].classList.add('fk-focused');
          opts[idx].scrollIntoView({ block: 'nearest' });
        }
      }

      function escapeHtml(str) {
        return str
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
      }

      function escapeAttr(str) {
        return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      }
    }
  }());

}(jQuery));