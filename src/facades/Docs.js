'use strict';

/**
 * millas/facades/Docs
 *
 *   const { Docs, ApiResource, ApiEndpoint, ApiField } = require('millas/facades/Docs');
 *
 *   class UserApiResource extends ApiResource {
 *     static controller = UserController;
 *     static label      = 'Users';
 *     static group      = 'Auth & Users';
 *     static prefix     = '/api/v1';
 *
 *     static endpoints() {
 *       return [
 *         ApiEndpoint.post('/auth/register')
 *           .label('Register')
 *           .body({
 *             name:  ApiField.text().required().example('Jane Doe'),
 *             email: ApiField.email().required().example('jane@example.com'),
 *           })
 *           .response(201, { id: 1, token: 'eyJ...' }),
 *
 *         ApiEndpoint.get('/users/me').label('Get current user').auth(),
 *       ];
 *     }
 *   }
 *
 *   // In AppServiceProvider.boot():
 *   Docs.register(UserApiResource);
 */

const Docs                = require('../docs/Docs');
const { ApiResource, ApiEndpoint, ApiField } = require('../docs/resources/ApiResource');
const DocsServiceProvider = require('../docs/DocsServiceProvider');

module.exports = {
  Docs,
  ApiResource,
  ApiEndpoint,
  ApiField,
  DocsServiceProvider,
};