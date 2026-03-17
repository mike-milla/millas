'use strict';

const { createFacade } = require('./Facade');
const { AuthUser, Hasher, JwtDriver, AuthMiddleware, RoleMiddleware, AuthController, AuthServiceProvider } = require('../core');

/**
 * Auth facade.
 *
 * @class
 * @property {function(object): Promise<object>}                             register
 * @property {function(string, string): Promise<{user, token, refreshToken}>} login
 * @property {function(string): object}                                      verify
 * @property {function(object): Promise<object|null>}                        user
 * @property {function(object): Promise<object>}                             userOrFail
 * @property {function(string, string): Promise<boolean>}                    checkPassword
 * @property {function(string): Promise<string>}                             hashPassword
 * @property {function(object, object=): string}                             issueToken
 * @property {function(string): object}                                      decode
 * @property {function(object): string}                                      generateResetToken
 * @property {function(string): object}                                      verifyResetToken
 * @property {function(function): void}                                      setUserModel
 * @property {function(object): void}                                        swap
 * @property {function(): void}                                              restore
 *
 * @see src/auth/Auth.js
 */
class Auth extends createFacade('auth') {}

module.exports = { Auth, AuthUser, Hasher, JwtDriver, AuthMiddleware, RoleMiddleware, AuthController, AuthServiceProvider };