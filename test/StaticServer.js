/**
 * Copyright 2017 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

let http = require('http');
let url = require('url');
let fs = require('fs');
let path = require('path');
let mime = require('mime');
let WebSocketServer = require('ws').Server;

const fulfillSymbol = Symbol('fullfill callback');
const rejectSymbol = Symbol('reject callback');

class StaticServer {
  /**
   * @param {string} dirPath
   * @param {number} port
   * @return {!StaticServer}
   */
  static async create(dirPath, port) {
    let server = new StaticServer(dirPath, port);
    await new Promise(x => server._server.once('listening', x));
    return server;
  }

  /**
   * @param {string} dirPath
   * @param {number} port
   */
  constructor(dirPath, port) {
    this._server = http.createServer(this._onRequest.bind(this));
    this._wsServer = new WebSocketServer({server: this._server});
    this._wsServer.on('connection', this._onWebSocketConnection.bind(this));
    this._server.listen(port);
    this._dirPath = dirPath;

    /** @type {!Map<string, function(!IncomingMessage, !ServerResponse)>} */
    this._routes = new Map();
    /** @type {!Map<string, !Promise>} */
    this._requestSubscribers = new Map();
  }

  stop() {
    this._server.close();
  }

  /**
   * @param {string} path
   * @param {function(!IncomingMessage, !ServerResponse)} handler
   */
  setRoute(path, handler) {
    this._routes.set(path, handler);
  }

  /**
   * @param {string} fromPath
   * @param {string} toPath
   */
  setRedirect(from, to) {
    this.setRoute(from, (req, res) => {
      res.writeHead(302, { location: to });
      res.end();
    });
  }

  /**
   * @param {string} path
   * @return {!Promise<!IncomingMessage>}
   */
  waitForRequest(path) {
    let promise = this._requestSubscribers.get(path);
    if (promise)
      return promise;
    let fulfill, reject;
    promise = new Promise((f, r) => {
      fulfill = f;
      reject = r;
    });
    promise[fulfillSymbol] = fulfill;
    promise[rejectSymbol] = reject;
    this._requestSubscribers.set(path, promise);
    return promise;
  }

  reset() {
    this._routes.clear();
    let error = new Error('Static Server has been reset');
    for (let subscriber of this._requestSubscribers.values())
      subscriber[rejectSymbol].call(null, error);
    this._requestSubscribers.clear();
  }

  _onRequest(request, response) {
    let pathName = url.parse(request.url).path;
    // Notify request subscriber.
    if (this._requestSubscribers.has(pathName))
      this._requestSubscribers.get(pathName)[fulfillSymbol].call(null, request);
    let handler = this._routes.get(pathName);
    if (handler)
      handler.call(null, request, response);
    else
      this.defaultHandler(request, response);
  }

  /**
   * @param {!IncomingMessage} request
   * @param {!ServerResponse} response
   */
  defaultHandler(request, response) {
    let pathName = url.parse(request.url).path;
    if (pathName === '/')
      pathName = '/index.html';
    pathName = path.join(this._dirPath, pathName.substring(1));

    fs.readFile(pathName, function(err, data) {
      if (err) {
        response.statusCode = 404;
        response.end(`File not found: ${pathName}`);
        return;
      }
      response.setHeader('Content-Type', mime.lookup(pathName));
      response.end(data);
    });
  }

  _onWebSocketConnection(connection) {
    connection.send('opened');
  }
}

module.exports = StaticServer;
