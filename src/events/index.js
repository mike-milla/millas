'use strict';

const emitterModule = require('./EventEmitter');
const EventEmitter  = emitterModule.EventEmitter
  ? emitterModule                      // if default export is singleton
  : emitterModule;
const Event    = require('./Event');
const Listener = require('./Listener');

module.exports = {
  EventEmitter: emitterModule,
  Event,
  Listener,
  emit: emitterModule.emit,
};
