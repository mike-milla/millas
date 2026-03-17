'use strict';

const { createFacade } = require('./Facade');
// const {PendingRequest,HttpResponse} = require('../http/HttpClient');

/**
 * Fluent outbound HTTP client facade.
 * Resolved from the DI container — every method creates a fresh PendingRequest.
 *
 * @class
 *
 * — Verbs
 * @property {function(string, object=): Promise<HttpResponse>} get
 * @property {function(string, object=): Promise<HttpResponse>} post
 * @property {function(string, object=): Promise<HttpResponse>} put
 * @property {function(string, object=): Promise<HttpResponse>} patch
 * @property {function(string, object=): Promise<HttpResponse>} delete
 * @property {function(string, object=): Promise<HttpResponse>} head
 * @property {function(string): Promise<HttpResponse>}          options
 *
 * — Builder (each returns PendingRequest for chaining)
 * @property {function(string): PendingRequest}             baseUrl
 * @property {function(object): PendingRequest}             withHeaders
 * @property {function(string, string=): PendingRequest}    withToken
 * @property {function(string, string): PendingRequest}     withBasicAuth
 * @property {function(object): PendingRequest}             withCookies
 * @property {function(string): PendingRequest}             withUserAgent
 * @property {function(string, string=): PendingRequest}    withBody
 * @property {function(string): PendingRequest}             accept
 * @property {function(): PendingRequest}                   acceptJson
 * @property {function(): PendingRequest}                   asJson
 * @property {function(): PendingRequest}                   asForm
 * @property {function(): PendingRequest}                   asMultipart
 * @property {function(number): PendingRequest}             timeout
 * @property {function(number, number=): PendingRequest}    retry
 * @property {function(): PendingRequest}                   throwOnFailure
 * @property {function(function): PendingRequest}           beforeSending
 * @property {function(function): PendingRequest}           afterReceiving
 *
 * — Concurrent
 * @property {function(function): Promise<HttpResponse[]>}  pool
 *
 * — Testing
 * @property {function(object): void} swap
 * @property {function(): void}       restore
 *
 * @see src/http/HttpClient.js
 */
class Http extends createFacade('http') {}

module.exports = Http;