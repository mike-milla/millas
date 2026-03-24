/**
 * core.js — Millas Admin Core
 *
 * Global helpers available on every admin page.
 * Requires: ui.js (loaded before this in base.njk)
 * Requires: jQuery
 */
(function ($) {
  'use strict';

  // ── Toast shorthand ──────────────────────────────────────────────────────────
  window.toast = function (msg, type) {
    UI.Toast.show(msg, type || 'success');
  };

  // ── Delete confirmation ──────────────────────────────────────────────────────
  window.confirmDelete = function (url, label) {
    UI.Confirm.show({
      title:   'Delete ' + label,
      message: 'Are you sure you want to delete <strong>' + label + '</strong>? This cannot be undone.',
      confirm: 'Delete',
      danger:  true,
    }).then(function (ok) {
      if (ok) submitDelete(url);
    });
  };

  window.submitDelete = function (url) {
    var csrf  = $('meta[name="csrf-token"]').attr('content') || '';
    $('<form method="POST">')
      .attr('action', url)
      .append('<input name="_method" value="DELETE">')
      .append('<input name="_csrf"   value="' + csrf + '">')
      .appendTo('body')
      .submit();
  };

  // ── M2M dual-list helpers ────────────────────────────────────────────────────
  window.m2mMove = function (fieldName, fromId, toId) {
    $('#m2m-' + fromId + '-' + fieldName + ' option:selected')
      .appendTo('#m2m-' + toId + '-' + fieldName);
  };

  // ── Alert close buttons ──────────────────────────────────────────────────────
  $(document).on('click', '.alert-close', function () {
    $(this).closest('.alert').remove();
  });

  // ── DOM ready ────────────────────────────────────────────────────────────────
  $(function () {

    // M2M: select all chosen options before form submit so values are posted
    $('form').on('submit', function () {
      $('[id^="m2m-chosen-"] option').prop('selected', true);
    });

    // Flash auto-dismiss after 5 seconds
    var $flash = $('#flash-alert');
    if ($flash.length) {
      setTimeout(function () {
        $flash.fadeTo(400, 0, function () { $flash.remove(); });
      }, 5000);
    }

    // Global search placeholder hint
    $('#global-search-input')
      .on('focus', function () { $(this).attr('placeholder', 'Search everything…'); })
      .on('blur',  function () { $(this).attr('placeholder', 'Search everything… (/)'); });

    // ── Keyboard shortcuts ─────────────────────────────────────────────────────
    // /        → focus search
    // n / N    → new record (first primary action button)
    // Escape   → close modals, blur inputs
    // g then d → go to dashboard
    // g then 1-9 → go to resource by index
    var prefix    = window.MILLAS_ADMIN_PREFIX || '/admin';
    var resources = window.MILLAS_ADMIN_RESOURCES || [];
    var gPressed  = false;
    var gTimer;

    $(document).on('keydown', function (e) {
      var tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        if (e.key === 'Escape') $(document.activeElement).blur();
        return;
      }

      if (e.key === '/') {
        e.preventDefault();
        $('#global-search-input').focus();
        return;
      }

      if (e.key === 'n' || e.key === 'N') {
        var $btn = $('a[href*="/create"].btn-primary').first();
        if ($btn.length) { e.preventDefault(); location.href = $btn.attr('href'); }
        return;
      }

      if (e.key === 'Escape') {
        $('.modal-overlay').removeClass('open');
        return;
      }

      if (e.key === 'g' || e.key === 'G') {
        if (gPressed) return;
        gPressed = true;
        clearTimeout(gTimer);
        gTimer = setTimeout(function () { gPressed = false; }, 800);
        return;
      }

      if (gPressed && (e.key === 'd' || e.key === 'D')) {
        gPressed = false;
        location.href = prefix + '/';
        return;
      }

      if (gPressed && e.key >= '1' && e.key <= '9') {
        gPressed = false;
        var idx = parseInt(e.key, 10);
        var r   = $.grep(resources, function (x) { return x.index === idx; })[0];
        if (r) location.href = prefix + '/' + r.slug;
      }
    });
  });

}(jQuery));