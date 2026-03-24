/**
 * actions.js — Millas Admin List Page
 *
 * Bulk selection, bulk delete, bulk actions, filter toggle,
 * per-row action dropdowns and context menus.
 *
 * Requires: ui.js, core.js, jQuery
 */
(function ($) {
  'use strict';

  $(function () {
    var PREFIX = (window.MILLAS_ADMIN_PREFIX || '/admin').replace(/\/+$/, '');
    var SLUG   = (window.MILLAS_RESOURCE_SLUG || '').replace(/\/+$/, '');

    // ── Filter panel ─────────────────────────────────────────────────────────
    if (window.MILLAS_HAS_ACTIVE_FILTERS) {
      $('#filter-panel').show();
    }

    $(document).on('click', '#filter-toggle', function () {
      $('#filter-panel').toggle();
    });

    // ── Live search on Enter ──────────────────────────────────────────────────
    $('#search-form input[name="search"]').on('keydown', function (e) {
      if (e.key === 'Enter') $('#search-form').submit();
    });

    // ── Bulk selection ────────────────────────────────────────────────────────
    function updateBulkBar() {
      var $checked = $('.item-check:checked');
      var n        = $checked.length;
      var total    = $('.item-check').length;
      $('#bulk-bar').toggleClass('visible', n > 0);
      $('#bulk-count').text(n + ' selected');
      $('#check-all')
        .prop('indeterminate', n > 0 && n < total)
        .prop('checked',       n > 0 && n === total);
    }

    $(document).on('click', '#check-all', function () {
      $('.item-check').prop('checked', this.checked);
      updateBulkBar();
    });

    $(document).on('change', '.item-check', updateBulkBar);

    $(document).on('click', '#clear-selection', function () {
      $('.item-check, #check-all').prop('checked', false).prop('indeterminate', false);
      updateBulkBar();
    });

    // ── Bulk delete ───────────────────────────────────────────────────────────
    $(document).on('click', '#bulk-delete-btn', function () {
      var ids   = $('.item-check:checked').map(function () { return this.value; }).get();
      if (!ids.length) return;
      var label = ids.length + ' record' + (ids.length > 1 ? 's' : '');
      UI.Confirm.show({
        title:   'Delete ' + label,
        message: 'Delete <strong>' + label + '</strong>? This cannot be undone.',
        confirm: 'Delete',
        danger:  true,
      }).then(function (ok) {
        if (!ok) return;
        var csrf  = $('meta[name="csrf-token"]').attr('content') || '';
        var $form = $('<form method="POST">').attr('action', PREFIX + '/' + SLUG + '/bulk-delete');
        $form.append('<input name="_csrf" value="' + csrf + '">');
        $.each(ids, function (_, id) {
          $form.append('<input type="hidden" name="ids[]" value="' + id + '">');
        });
        $form.appendTo('body').submit();
      });
    });

    // ── Bulk action ───────────────────────────────────────────────────────────
    $(document).on('click', '[data-bulk-action]', function () {
      var actionIndex = $(this).data('bulk-action');
      var ids         = $('.item-check:checked').map(function () { return this.value; }).get();
      if (!ids.length) return;
      var csrf  = $('meta[name="csrf-token"]').attr('content') || '';
      var $form = $('<form method="POST">').attr('action', PREFIX + '/' + SLUG + '/bulk-action');
      $form.append('<input name="_csrf" value="' + csrf + '">');
      $form.append('<input type="hidden" name="actionIndex" value="' + actionIndex + '">');
      $.each(ids, function (_, id) {
        $form.append('<input type="hidden" name="ids[]" value="' + id + '">');
      });
      $form.appendTo('body').submit();
    });

    // ── Export menu ───────────────────────────────────────────────────────────
    var $exportBtn   = $('#export-menu-btn');
    var $exportPanel = $('#export-menu-panel');
    if ($exportBtn.length && $exportPanel.length) {
      var exportDd = UI.Dropdown.create({
        anchor:    $exportBtn[0],
        content:   $exportPanel[0],
        placement: 'bottom-end',
        offset:    4,
      });
      $exportBtn.on('click', function () { exportDd.toggle(); });
    }

    // ── Per-row action menus ──────────────────────────────────────────────────
    $('.ui-menu').each(function () {
      var $menu  = $(this);
      var $btn   = $menu.find('.ui-menu-trigger');
      var $panel = $menu.find('.ui-menu-panel');
      if (!$btn.length || !$panel.length) return;

      var dd = UI.Dropdown.create({
        anchor:    $btn[0],
        content:   $panel[0],
        placement: 'bottom-end',
        offset:    4,
      });

      $btn.on('click', function (e) {
        e.stopPropagation();
        dd.toggle();
      });

      $panel.find('[data-confirm-delete]').on('click', function () {
        dd.close();
        confirmDelete($(this).data('confirm-delete'), $(this).data('confirm-label'));
      });

      $panel.find('[data-row-action]').on('click', function () {
        dd.close();
        var url   = $(this).data('row-action');
        var label = $(this).data('row-action-label');
        UI.Confirm.show({
          title:   label,
          message: 'Run <strong>' + label + '</strong> on this record?',
          confirm: label,
        }).then(function (ok) {
          if (!ok) return;
          var csrf  = $('meta[name="csrf-token"]').attr('content') || '';
          var $form = $('<form method="POST">').attr('action', url);
          $form.append('<input name="_csrf" value="' + csrf + '">');
          $form.appendTo('body').submit();
        });
      });

      // ── Right-click context menu ──────────────────────────────────────────
      (function ($menuPanel) {
        var $row = $menuPanel.closest('tr');

        $row.on('contextmenu', function (e) {
          e.preventDefault();
          e.stopPropagation();

          $('.context-menu-portal').remove();

          var $p = $('<div class="ui-menu-panel context-menu-portal"></div>');
          $p.html($menuPanel.html());
          $p.css({
            position: 'fixed',
            top:      Math.min(e.clientY, window.innerHeight - 240) + 'px',
            left:     Math.min(e.clientX, window.innerWidth  - 190) + 'px',
            zIndex:   9999,
          });
          $('body').append($p);

          $p.find('[data-confirm-delete]').on('click', function () {
            $p.remove();
            confirmDelete($(this).data('confirm-delete'), $(this).data('confirm-label'));
          });

          $p.find('[data-row-action]').on('click', function () {
            $p.remove();
            var _url   = $(this).data('row-action');
            var _label = $(this).data('row-action-label');
            UI.Confirm.show({
              title:   _label,
              message: 'Run <strong>' + _label + '</strong> on this record?',
              confirm: _label,
            }).then(function (ok) {
              if (!ok) return;
              var csrf  = $('meta[name="csrf-token"]').attr('content') || '';
              var $form = $('<form method="POST">').attr('action', _url);
              $form.append('<input name="_csrf" value="' + csrf + '">');
              $form.appendTo('body').submit();
            });
          });

          $p.find('a.ui-menu-item').on('click', function () { $p.remove(); });

          setTimeout(function () {
            $(document).one('click.ctxmenu', function () { $p.remove(); });
          }, 0);
          $(document).one('keydown.ctxmenu', function (ev) {
            if (ev.key === 'Escape') { $p.remove(); }
          });
        });
      }($panel));
    });

  });

}(jQuery));