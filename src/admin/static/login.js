/**
 * login.js — Millas Admin Login Page
 *
 * Password visibility toggle and client-side form validation.
 * No dependencies — runs before ui.js is available.
 */
(function () {
  'use strict';

  // ── Password visibility toggle ───────────────────────────────────────────────
  var EYE_OPEN   = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
  var EYE_CLOSED = '<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>'
                 + '<path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>'
                 + '<line x1="1" y1="1" x2="23" y2="23"/>';

  function togglePw() {
    var input   = document.getElementById('password');
    var icon    = document.getElementById('pw-icon');
    var hidden  = input.type === 'password';
    input.type  = hidden ? 'text' : 'password';
    icon.innerHTML = hidden ? EYE_CLOSED : EYE_OPEN;
  }

  // ── Form validation + submit loading state ───────────────────────────────────
  function onSubmit(e) {
    var email    = document.getElementById('email').value.trim();
    var password = document.getElementById('password').value;

    if (!email || !password) {
      e.preventDefault();
      var msg      = !email ? 'Email is required.' : 'Password is required.';
      var existing = document.getElementById('login-error');

      if (existing) {
        existing.lastChild.textContent = msg;
      } else {
        var el       = document.createElement('div');
        el.className = 'alert alert-error';
        el.id        = 'login-error';
        el.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15">'
                     + '<circle cx="12" cy="12" r="10"/>'
                     + '<line x1="12" y1="8" x2="12" y2="12"/>'
                     + '<line x1="12" y1="16" x2="12.01" y2="16"/>'
                     + '</svg> ' + msg;
        this.insertBefore(el, this.firstChild);
      }
      return;
    }

    var btn  = document.getElementById('login-btn');
    var icon = document.getElementById('login-icon');
    btn.disabled   = true;
    icon.innerHTML = '<circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="32" class="spin"/>';
    btn.lastChild.textContent = ' Signing in\u2026';
  }

  // ── Wire up on DOMContentLoaded ──────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    var pwToggle = document.querySelector('.pw-toggle');
    if (pwToggle) {
      pwToggle.addEventListener('click', togglePw);
    }

    var form = document.getElementById('login-form');
    if (form) {
      form.addEventListener('submit', onSubmit);
    }

    // Auto-focus password if email is pre-filled
    var emailInput = document.getElementById('email');
    if (emailInput && emailInput.value) {
      document.getElementById('password').focus();
    }
  });

}());