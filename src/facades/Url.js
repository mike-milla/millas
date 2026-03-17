'use strict';

const {createFacade} = require('./Facade');

/**
 * URL facade — Laravel-like URL generation.
 *
 * @class
 *
 * — Base
 * @property {function(): string}                                                  base
 *
 * — URL generation
 * @property {function(string, object=): string}                                   to
 * @property {function(string, object=): string}                                   secure
 * @property {function(string, object=): string}                                   relative
 *
 * — Named routes
 * @property {function(string, object=, object=): string}                          route
 *
 * — Assets
 * @property {function(string): string}                                            asset
 * @property {function(string): string}                                            secureAsset
 *
 * — Current / previous request
 * @property {function(): string|null}                                             current
 * @property {function(): string|null}                                             currentPath
 * @property {function(string=): string}                                           previous
 *
 * — Signed URLs
 * @property {function(string, object=, number=): string}                          signedRoute
 * @property {function(string, number=): string}                                   signedUrl
 * @property {function(object): boolean}                                           hasValidSignature
 *
 * — Scheme control
 * @property {function(boolean=): UrlGenerator}                                    forceHttps
 * @property {function(string): UrlGenerator}                                      forceScheme
 * @property {function(string): UrlGenerator}                                      useAssetOrigin
 *
 * — Introspection
 * @property {function(string): boolean}                                           isValid
 * @property {function(...string): boolean}                                        is
 *
 * — Testing
 * @property {function(object): void}                                              swap
 * @property {function(): void}                                                    restore
 *
 * @see src/http/UrlGenerator.js
 */
class URL extends createFacade('url') {
}

module.exports = URL;