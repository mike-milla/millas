'use strict';

const HasOne        = require('./HasOne');
const HasMany       = require('./HasMany');
const BelongsTo     = require('./BelongsTo');
const BelongsToMany = require('./BelongsToMany');

module.exports = { HasOne, HasMany, BelongsTo, BelongsToMany };
