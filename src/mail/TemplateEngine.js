'use strict';

const fs   = require('fs-extra');
const path = require('path');

/**
 * TemplateEngine
 *
 * Renders email templates from the resources/mail/ directory.
 *
 * Supports:
 *   - Plain HTML files  (.html)
 *   - Simple template syntax: {{ variable }}, {{ if condition }}, {{ each items }}
 *
 * Usage:
 *   const engine = new TemplateEngine('./resources/mail');
 *   const html   = await engine.render('welcome', { name: 'Alice' });
 *
 * Template file: resources/mail/welcome.html
 *   <h1>Welcome, {{ name }}!</h1>
 */
class TemplateEngine {
  constructor(templatesPath) {
    this._path = templatesPath || path.join(process.cwd(), 'resources/mail');
  }

  /**
   * Render a named template with data.
   * @param {string} name — template name without extension
   * @param {object} data — variables to interpolate
   * @returns {Promise<{html: string, text: string}>}
   */
  async render(name, data = {}) {
    const htmlPath = path.join(this._path, `${name}.html`);
    const textPath = path.join(this._path, `${name}.txt`);

    let html = null;
    let text = null;

    if (await fs.pathExists(htmlPath)) {
      const raw = await fs.readFile(htmlPath, 'utf8');
      html = this._interpolate(raw, data);
    }

    if (await fs.pathExists(textPath)) {
      const raw = await fs.readFile(textPath, 'utf8');
      text = this._interpolate(raw, data);
    }

    // Auto-generate plain text from HTML if no .txt file
    if (html && !text) {
      text = this._htmlToText(html);
    }

    if (!html && !text) {
      throw new Error(
        `Mail template "${name}" not found in ${this._path}. ` +
        `Create ${name}.html or ${name}.txt.`
      );
    }

    return { html, text };
  }

  /**
   * Render an inline HTML string with data.
   */
  renderInline(htmlString, data = {}) {
    return {
      html: this._interpolate(htmlString, data),
      text: this._htmlToText(this._interpolate(htmlString, data)),
    };
  }

  // ─── Template syntax ───────────────────────────────────────────────────────

  /**
   * Simple template interpolation.
   *
   * Supports:
   *   {{ name }}                — variable substitution
   *   {{ user.email }}          — dot notation
   *   {{# if condition }}...{{/ if }}  — conditionals
   *   {{# each items }}...{{/ each }}  — loops (item available as {{ this }})
   */
  _interpolate(template, data) {
    let result = template;

    // {{# each array }}...{{/ each }}
    result = result.replace(
      /\{\{#\s*each\s+(\w+)\s*\}\}([\s\S]*?)\{\{\/\s*each\s*\}\}/g,
      (_, key, body) => {
        const list = this._resolve(key, data);
        if (!Array.isArray(list)) return '';
        return list.map(item => {
          return body
            .replace(/\{\{\s*this\s*\}\}/g, String(item))
            .replace(/\{\{\s*this\.([\w.]+)\s*\}\}/g, (__, prop) =>
              String(this._resolve(prop, item) ?? '')
            );
        }).join('');
      }
    );

    // {{# if condition }}...{{/ if }}
    result = result.replace(
      /\{\{#\s*if\s+(\w+)\s*\}\}([\s\S]*?)\{\{\/\s*if\s*\}\}/g,
      (_, key, body) => this._resolve(key, data) ? body : ''
    );

    // {{ variable }} and {{ dot.notation }}
    result = result.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
      const val = this._resolve(key, data);
      return val !== undefined && val !== null ? String(val) : '';
    });

    return result;
  }

  _resolve(key, data) {
    return key.split('.').reduce((obj, k) =>
      obj && typeof obj === 'object' ? obj[k] : undefined, data
    );
  }

  /**
   * Strip HTML tags to produce a basic plain-text version.
   */
  _htmlToText(html) {
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/h[1-6]>/gi, '\n\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '$2 ($1)')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}

module.exports = TemplateEngine;
