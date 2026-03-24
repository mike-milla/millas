const Controller      = require('../controller/Controller');
const Middleware      = require('../middleware/Middleware');
const MiddlewarePipeline = require('../middleware/MiddlewarePipeline');
const CorsMiddleware  = require('../middleware/CorsMiddleware');
const ThrottleMiddleware = require('../middleware/ThrottleMiddleware');
const LogMiddleware   = require('../middleware/LogMiddleware');
const HttpError       = require('../errors/HttpError');
const { shape, isShape } = require('../http/Shape');

module.exports = {
  Controller,
  Middleware,
  MiddlewarePipeline,
  CorsMiddleware,
  ThrottleMiddleware,
  LogMiddleware,
  HttpError,
  // Shape factory — define route input/output contracts
  shape,
  isShape,
};