/**
 * SelectFilter2.js — Millas Admin M2M Dual-List Widget
 *
 * Moves options between "available" and "chosen" select lists.
 * Also ensures all chosen options are selected before form submit
 * so their values are included in the POST body.
 *
 * Requires: jQuery
 */
(function ($) {
  'use strict';

  // ── Move options between lists ───────────────────────────────────────────────
  window.m2mMove = function (fieldName, fromId, toId) {
    $('#m2m-' + fromId + '-' + fieldName + ' option:selected')
      .appendTo('#m2m-' + toId + '-' + fieldName);
  };

  // ── Wire move buttons via data attributes ────────────────────────────────────
  $(document).on('click', '[data-m2m-move]', function () {
    var fieldName = $(this).data('m2m-field');
    var from      = $(this).data('m2m-from');
    var to        = $(this).data('m2m-to');
    if (fieldName && from && to) {
      m2mMove(fieldName, from, to);
    }
  });

  // ── Select all chosen before form submit ─────────────────────────────────────
  $(document).on('submit', 'form', function () {
    $('[id^="m2m-chosen-"] option').prop('selected', true);
  });

}(jQuery));