'use strict';

const HttpError  = require('../errors/HttpError');
const { jsonify, redirect, view, text, empty } = require('../http/helpers');

/**
 * Controller
 *
 * Base class for all Millas controllers.
 *
 * Controller methods receive a RequestContext destructured as named keys.
 * Express req/res are never exposed. Return a response helper or plain value.
 *
 * Usage:
 *   class UserController extends Controller {
 *     async index({ query }) {
 *       const users = await User.paginate(query.page, query.per_page);
 *       return this.ok(users);
 *     }
 *
 *     async store({ body }) {
 *       // body is already validated when .shape() is used on the route
 *       const user = await User.create(body);
 *       return this.created(user);
 *     }
 *
 *     async show({ params }) {
 *       const user = await User.findOrFail(params.id);
 *       return this.ok(user);
 *     }
 *   }
 */
class Controller {

  // ─── Response helpers ────────────────────────────────────────────────────────

  /** 200 OK */
  ok(data = null) {
    return jsonify(this._envelope(200, data), { status: 200 });
  }

  /** 201 Created */
  created(data = null) {
    return jsonify(this._envelope(201, data), { status: 201 });
  }

  /** 204 No Content */
  noContent() {
    return empty(204);
  }

  /** 200 with a custom JSON payload (no envelope) */
  json(data, status = 200) {
    return jsonify(data, { status });
  }

  /** 400 Bad Request */
  badRequest(message = 'Bad Request', errors = null) {
    return jsonify({
      error: 'Bad Request', message, status: 400,
      ...(errors && { errors }),
    }, { status: 400 });
  }

  /** 401 Unauthorized */
  unauthorized(message = 'Unauthorized') {
    return jsonify({ error: 'Unauthorized', message, status: 401 }, { status: 401 });
  }

  /** 403 Forbidden */
  forbidden(message = 'Forbidden') {
    return jsonify({ error: 'Forbidden', message, status: 403 }, { status: 403 });
  }

  /** 404 Not Found */
  notFound(message = 'Not Found') {
    return jsonify({ error: 'Not Found', message, status: 404 }, { status: 404 });
  }

  /** 422 Unprocessable Entity */
  unprocessable(errors) {
    return jsonify({
      error: 'Unprocessable Entity',
      message: 'Validation failed',
      status: 422,
      errors,
    }, { status: 422 });
  }

  /** 500 Internal Server Error */
  serverError(message = 'Internal Server Error') {
    return jsonify({ error: 'Internal Server Error', message, status: 500 }, { status: 500 });
  }

  /** Render a view */
  render(template, data = {}, status = 200) {
    return view(template, data, { status });
  }

  /** Redirect */
  redirectTo(url, status = 302) {
    return redirect(url, { status });
  }

  /**
   * Paginated list response.
   *
   *   return this.paginate({ data: users, total: 100, page: 2, perPage: 15 });
   */
  paginate({ data, total, page = 1, perPage = 15 }) {
    const lastPage = Math.ceil(total / perPage);
    return jsonify({
      data,
      meta: {
        total,
        per_page:     perPage,
        current_page: Number(page),
        last_page:    lastPage,
        from:         (page - 1) * perPage + 1,
        to:           Math.min(page * perPage, total),
      },
    });
  }

  // ─── Abort ───────────────────────────────────────────────────────────────────

  /**
   * Throw an HTTP error.
   *   this.abort(404, 'User not found')
   *   this.abort(403)
   */
  abort(status, message) {
    throw new HttpError(status, message);
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  _envelope(status, data) {
    if (data === null) return { status };
    if (typeof data === 'object' && !Array.isArray(data) &&
        ('data' in data || 'message' in data)) {
      return { status, ...data };
    }
    return { status, data };
  }
}

module.exports = Controller;