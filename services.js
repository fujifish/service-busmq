const logger = require("./logger");
const Emitter = require("events").EventEmitter;
const Bus = require("busmq");
const BusService = require("./service");
const ServiceHandler = require("./handler");
const fs = require("fs");

var file = __dirname + "/lua/acquireRunLock.lua";
var acquireRunLockScript = null;
fs.readFile(file, function(err, content) {
  if (err) return;
  acquireRunLockScript = content.toString().trim();
});

class BusServices extends Emitter {
  constructor(config) {
    super();
    this._bus = Bus.create(config);
    this._connectCalls = [];
    this._services = {};
    this._logger = logger(config);
    if (this._logger.isLevelEnabled("trace")) {
      this._bus.debug(true);
      this._bus.withLog(this._logger);
    }
    this._instrumentLogger(this._logger);
  }

  get bus() {
    return this._bus;
  }

  async connect() {
    if (this._disconnecting)
      throw new Error(`[busServices] failed to connect while disconnecting`);
    if (this._connected) return;

    this._connecting = true;
    return new Promise((resolve, reject) => {
      this._connectCalls.push({ resolve, reject });
      this._setBusListeners();
      this._bus.connect();
    });
  }

  async disconnect() {
    if (this._connecting)
      throw new Error(`[busServices] failed to disconnect while connecting`);
    if (!this._connected) return;

    delete this._connections;
    this._acquireLockScriptSha = null;
    this._connected = false;
    this._disconnecting = true;
    this._bus.disconnect();
  }

  async consume(serviceName, serviceMethod, max, handler) {
    if (!this._connected)
      throw new Error(
        `[busServices] bus need to be connected before subscribing a service`
      );

    if (typeof max === "function") {
      handler = max;
      max = undefined;
    }

    const name = this._getServiceFQN(serviceName, serviceMethod);
    const msLogObj = {
      msFQN: name,
      msName: serviceName,
      msMethod: serviceMethod
    };

    return new Promise((resolve, reject) => {
      var onRequest = async (request, reply) => {
        this._logger.debug(msLogObj, `request arrived for service '${name}'`);
        var res = null,
          error = null;
        try {
          res = await handler(request);
          this._logger.debug(
            msLogObj,
            `request completed for service '${name}'`
          );
        } catch (ex) {
          error = ex;
          this._logger.error(
            Object.assign({ exception: ex && ex.stack }, msLogObj),
            `RequestException: exception while handling request by service '${name}':\n'${ex}'`
          );
        }

        reply(error, res);
      };

      var onError = err => {
        this._logger.debug(`error on service '${name}': ${err}`);
      };

      var onServiceDisconnected = $ => {
        if (s) {
          s.removeListener("request", onRequest);
          this._logger.debug(`service '${name}' disconnected`);
        }
        onRequest = undefined;
        s = undefined;
      };

      var s = this._bus.service(name);

      s.once("disconnect", onServiceDisconnected);

      s.once("serving", $ => {
        this._logger.info(msLogObj, `service '${name}' registered`);
        resolve(s);
      });

      s.on("error", onError);

      s.on("request", onRequest);

      s.serve({ max });
    });
  }

  async service(name) {
    if (!this._connected)
      throw new Error(
        `[busServices] bus need to be connected before requesting a service`
      );
    if (this._services[name]) return this._services[name];

    return new Promise((resolve, reject) => {
      var s = this._bus.service(name);
      s.on("disconnect", $ => {
        if (this._services[name] === s) delete this._services[name];
      });
      s.connect($ => {
        this._logger.info(
          { msFQN: name },
          `client service '${name}' connected`
        );

        if (this._services[name]) {
          setTimeout($ => s.disconnect(), 0);
          resolve(this._services[name]);
          return;
        }

        this._services[name] = s;
        resolve(s);
      });
    });
  }

  async request(serviceName, serviceMethod, request, options) {
    if (!this._connected)
      throw new Error(
        `[busServices] bus need to be connected before requesting a service`
      );

    const name = this._getServiceFQN(serviceName, serviceMethod);
    const msLogObj = {
      msFQN: name,
      msName: serviceName,
      msMethod: serviceMethod
    };

    this._logger.debug(msLogObj, `sending request for service '${name}'`);
    //this._logger.trace(request, `extra request details`);

    const service = await this.service(name);

    return new Promise((resolve, reject) => {
      service.request(
        Object.assign(
          { serviceFQN: name, service: serviceName, method: serviceMethod },
          request
        ),
        Object.assign({ reqTimeout: 5000 }, options),
        (err, reply) => {
          let logMessage =
            options && typeof options.logReply === "function"
              ? options.logReply(err, reply)
              : `got response from service '${name}', error: ${err &&
                  (err.stack || err)}`;
          this._logger.debug(msLogObj, logMessage);
          //this._logger.trace(reply || {}, `extra reply details, error was ${err}`);
          if (err) reject(err);
          else resolve(reply);
        }
      );
    });
  }

  async connection(key) {
    if (!this._connected || this._disconnecting)
      throw new Error(
        `[busServices] failed to get bus connection - bus is not connected`
      );

    this._connections = this._connections || {};
    if (this._connections[key] && this._connections[key].isReady())
      return this._connections[key];

    return new Promise((resolve, reject) => {
      this._bus.connection(key, connection => {
        if (!connection)
          reject(
            new Error(
              `[busServices] failed to get bus connection - unknown reason`
            )
          );
        else {
          this._connections[key] = connection;
          this._loadScript(key).then((res) => {
            this._acquireLockScriptSha[key] = res;
            resolve(connection);
          }).catch(() => {
            resolve(connection);
          })
        }
      });
    });
  }

  async acquireRunLock(connectionKey, runLockKey, lockExpiration) {
    const conn = await this.connection(connectionKey);
   
    if (!this._acquireLockScriptSha || !this._acquireLockScriptSha[connectionKey]) 
      throw new Error(
        `[busServices] failed to get sha for acquire run lock script`
      );
      
    return new Promise((resolve, reject) => {
      conn.evalsha(
        this._acquireLockScriptSha[connectionKey],
        1,
        runLockKey,
        lockExpiration,
        (err, resp) => {
          if (err) {
            reject(err);
            return;
          }
          this._logger.info(
            `lock acquired ${resp}`
          );
          resolve(resp);
        }
      );
    });
  }

  async releaseRunLock(connectionKey, runLockKey) {
    const conn = await this.connection(connectionKey);

    return new Promise((resolve, reject) => {
      conn.del(runLockKey, (error, reply) => {
        if (error)
        this._logger.debug(
            `failed to delete key '${runLockKey}', error: ${error}`
          );
        else this._logger.info(`key '${runLockKey}' was deleted`);
        resolve(reply);
      });
    });
  }

  async _loadScript(key) {
    this._acquireLockScriptSha = this._acquireLockScriptSha || {};
    return new Promise((resolve, reject) => {
      this._connections[key].script("load", acquireRunLockScript, (err, resp) => {
        if (err) {
          this._logger.debug(`error loading acquireRunLockScript ${err}`);
          resolve();
          return;
        }
        this._logger.info(`acquireRunLockScript ${resp}`);
        resolve(resp);
      });
    });
  }

  _setBusListeners() {
    if (this._listeningToBus) return;

    this._bus.on("offline", err => {
      this._logger.info(`bus disconnected`);
      this.emit("offline");
      this._disconnecting = false;
      if (this._connecting) this._connectCompleted(err ? err : "offline");
    });

    this._bus.on("online", async () => {
      this._logger.info(`bus ${this._connected ? "reconnected" : "connected"}`);
      this._connecting = false;

      if (this._connected) {
        this.emit("online");
        return;
      }

      this._connected = true;

      this.emit("online");

      this._connectCompleted();
    });

    this._bus.on("error", err => {
      this._logger.info(`bus error: ${err}`);
      if (this._connecting) this._connectCompleted(err ? err : "error");
    });

    this._listeningToBus = true;
  }

  _connectCompleted(err) {
    this._connectCalls
      .splice(0, this._connectCalls.length)
      .forEach(c => (err ? c.reject(err) : c.resolve()));
  }

  _getServiceFQN(serviceName, method) {
    return `${serviceName}/${method}`;
  }

  _instrumentLogger() {}
}

module.exports = { BusServices, BusService, ServiceHandler };
