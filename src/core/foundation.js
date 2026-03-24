'use strict';

// ── HTTP Layer ────────────────────────────────────────────────────
const {
  MillasRequest,
  MillasResponse,
  ResponseDispatcher,
  jsonify,
  view,
  redirect,
  text,
  file,
  empty,
  abort,
  notFound,
  unauthorized,
  forbidden,
} = require('../http/index');
const RequestContext = require('../http/RequestContext');

// ── DI Container ─────────────────────────────────────────────────
const Container          = require('../container/Container');
const Application        = require('../container/Application');
const ServiceProvider    = require('../providers/ServiceProvider');
const ProviderRegistry   = require('../providers/ProviderRegistry');

// ── Events ────────────────────────────────────────────────────────
const EventEmitter         = require('../events/EventEmitter');
const Event                = require('../events/Event');
const Listener             = require('../events/Listener');
const { emit }             = require('../events/EventEmitter');
const EventServiceProvider = require('../providers/EventServiceProvider');

// ── Cache ─────────────────────────────────────────────────────────
const Cache        = require('../cache/Cache');
const MemoryDriver = require('../cache/drivers/MemoryDriver');
const FileDriver   = require('../cache/drivers/FileDriver');
const NullDriver   = require('../cache/drivers/NullDriver');
const { CacheServiceProvider, StorageServiceProvider } = require('../providers/CacheStorageServiceProvider');

// ── Storage ───────────────────────────────────────────────────────
const Storage     = require('../storage/Storage');
const LocalDriver = require('../storage/drivers/LocalDriver');
// ── Serializer ────────────────────────────────────────────────────
const { Serializer } = require('../serializer/Serializer');
const {Str, FluentString} = require("../support/Str");

module.exports = {
  // ── Millas HTTP layer ──────────────────────────────────────────
  MillasRequest, MillasResponse, ResponseDispatcher, RequestContext,
  jsonify, view, redirect, text, send_file:file, empty,
  abort, notFound, unauthorized, forbidden,

  // DI
  Container, Application, ServiceProvider, ProviderRegistry,
  // Events
  EventEmitter, Event, Listener, emit, EventServiceProvider,
  // Cache
  Cache, MemoryDriver, FileDriver, NullDriver, CacheServiceProvider,
  // Storage
  Storage, LocalDriver, StorageServiceProvider,
  // Serializer
  Serializer,
  // Support
  Str, FluentString,
  Log: require('../logger').Log,
};