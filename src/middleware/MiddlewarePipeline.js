'use strict';

const MillasRequest      = require('../http/MillasRequest');
const RequestContext     = require('../http/RequestContext');
const MillasResponse     = require('../http/MillasResponse');
const ResponseDispatcher = require('../http/ResponseDispatcher');

/**
 * MiddlewarePipeline
 *
 * Runs an ordered list of middleware instances against a request.
 * Used for programmatic pipelines outside of the router (e.g. queue webhooks).
 *
 * Each middleware receives a RequestContext and a next() function.
 */
class MiddlewarePipeline {
  constructor(middlewares = []) {
    this._middlewares = middlewares;
  }

  add(middleware) {
    this._middlewares.push(middleware);
    return this;
  }

  /**
   * Run the pipeline against an Express req/res.
   * @param {object} expressReq
   * @param {object} expressRes
   * @param {object|null} container
   */
  async run(expressReq, expressRes, container = null) {
    const millaReq = new MillasRequest(expressReq);
    const ctx      = new RequestContext(millaReq, container);

    const dispatch = async (index) => {
      if (index >= this._middlewares.length) return null;

      const mw   = this._middlewares[index];
      const next = () => dispatch(index + 1);

      const instance = typeof mw === 'function' && mw.prototype?.handle
        ? new mw()
        : mw;

      return instance.handle(ctx, next);
    };

    const response = await dispatch(0);

    if (response && MillasResponse.isResponse(response) && !expressRes.headersSent) {
      ResponseDispatcher.dispatch(response, expressRes);
    }
  }
}

module.exports = MiddlewarePipeline;
