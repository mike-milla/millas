'use strict';

const MillasResponse                 = require('./MillasResponse');
const { containsUnsafeHtmlPatterns } = require('./HtmlEscape');

/**
 * ResponseDispatcher
 *
 * Auto-wraps plain route handler return values into MillasResponse objects.
 * In development, warns when returned HTML strings contain patterns that
 * suggest unescaped user input. Use safeHtml`` or escapeHtml() to fix.
 */
class ResponseDispatcher {

  static autoWrap(value) {
    if (MillasResponse.isResponse(value)) return value;
    if (value instanceof Error) throw value;

    if (typeof value === 'string') {
      const isHtml = value.trimStart().startsWith('<');

      if (isHtml && process.env.NODE_ENV !== 'production') {
        if (containsUnsafeHtmlPatterns(value)) {
          console.warn(
            '[Millas] ⚠ Potentially unsafe HTML returned from route handler.\n' +
            '  The response contains unescaped patterns (<script>, onerror=, javascript:).\n' +
            '  Use safeHtml`` or escapeHtml() to escape user input:\n' +
            '    const { safeHtml } = require(\'millas/src/http/HtmlEscape\');\n' +
            '    return safeHtml`<p>${userInput}</p>`;\n'
          );
        }
      }

      return isHtml ? MillasResponse.html(value) : MillasResponse.text(value);
    }

    if (typeof value === 'object' || typeof value === 'number' || typeof value === 'boolean') {
      return MillasResponse.json(value);
    }

    return MillasResponse.text(String(value));
  }
}

module.exports = ResponseDispatcher;