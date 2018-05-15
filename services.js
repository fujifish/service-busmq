const logger = require("./logger");
const Emitter = require("events").EventEmitter;
const Bus = require("busmq");
const BusService = require("./service");
const ServiceHandler = require("./handler");

class BusServices extends Emitter {
  constructor(config) {
    super();
    this._bus = Bus.create(config);
    this._connectCalls = [];
    this._services = {};
    this._logger = logger(config);
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

    this._connected = false;
    this._disconnecting = true;
    this._bus.disconnect();
  }

  async consume(name, max, handler) {
    if (!this._connected)
      throw new Error(
        `[busServices] bus need to be connected before subscribing a service`
      );

    if (typeof max === "function") {
      handler = max;
      max = undefined;
    }

    return new Promise((resolve, reject) => {
      var onRequest = async (request, reply) => {
        this._logger.debug(
          { msName: name },
          `request arrived for service '${name}'`
        );
        var res = null,
          error = null;
        try {
          res = await handler(request);
          this._logger.debug(
            { msName: name },
            `request completed for service '${name}'`
          );
        } catch (ex) {
          error = ex;
          this._logger.error(
            { msName: name, exception: ex && ex.stack },
            `RequestException: exception while handling request by service '${name}':\n'${ex}'`
          );
        }

        reply(error, res);
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
        this._logger.info({ msName: name }, `service '${name}' registered`);
        resolve(s);
      });

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
          { msName: name },
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

  async request(serviceName, method, request, options) {
    if (!this._connected)
      throw new Error(
        `[busServices] bus need to be connected before requesting a service`
      );

    this._logger.debug(
      { msName: serviceName, msMethod: method },
      `sending request for service '${serviceName}' with method '${method}'`
    );
    //this._logger.trace(request, `extra request details`);

    const service = await this.service(serviceName);

    return new Promise((resolve, reject) => {
      service.request(
        Object.assign({ service: serviceName, method }, request),
        options,
        (err, reply) => {
          let logMessage =
            options && typeof options.logReply === "function"
              ? options.logReply(err, reply)
              : `got response for request method '${method}', error: ${err &&
                  (err.stack || err)}`;
          this._logger.debug(
            { msName: serviceName, msMethod: method },
            logMessage
          );
          //this._logger.trace(reply || {}, `extra reply details, error was ${err}`);
          if (err) reject(err);
          else resolve(reply);
        }
      );
    });
  }

  async connection(key) {
    if (!this._bus)
      throw new Error(
        `[busServices] failed to get bus connection - bus was not set`
      );

    this._connections = this._connections || {};
    if (this._connections[key]) return this._connections[key];

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
          resolve(connection);
        }
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

  _instrumentLogger() {}
}

module.exports = { BusServices, BusService, ServiceHandler };
