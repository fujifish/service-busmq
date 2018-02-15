const logger = require("./logger");
const Emitter = require("events").EventEmitter;
const Bus = require("busmq");
const BusService = require("./service");
const ServiceHandler = require("./handler");

class BusServices extends Emitter {
  constructor(config) {
    super();
    this._bus = Bus.create(config);
    this._services = {};
    this._logger = logger(config);
    this._instrumentLogger(this._logger);
  }

  get bus() {
    return this._bus;
  }

  async connect() {
    if (this._connected) return;

    return new Promise((resolve, reject) => {
      this._bus.on("offline", $ => {
        this._logger.info(`bus disconnected`);
        this.emit("offline");
      });

      this._bus.on("online", async () => {
        this._logger.info(
          `bus ${this._connected ? "reconnected" : "connected"}`
        );
        if (this._connected) {
          this.emit("online");
          return;
        }

        this._connected = true;

        this.emit("online");
        resolve();
      });

      this._bus.on("error", err => {
        this._logger.info(`bus error: ${err}`);
      });

      this._bus.connect();
    });
  }

  async disconnect() {
    if (this._connected) {
      this._bus.disconnect();
      this._connected = false;
    }
  }

  async consume(name, count, handler) {
    if (!this._connected)
      throw new Error(
        `[busServices] bus need to be connected before subscribing a service`
      );

    if (typeof count === "function") {
      handler = count;
      count = undefined;
    }

    return new Promise((resolve, reject) => {
      var onRequest = async (request, reply) => {
        if (count && --count === 0) {
          s.disconnect();
        }

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
            { msName: name, exception: ex.stack },
            `RequestException: exception while handling request by service '${name}':\n'${ex}'`
          );
        }
        reply(error, res);
      };

      var s = this._bus.service(name);

      s.once("disconnect", $ => {
        s.removeListener("request", onRequest);
        onRequest = undefined;
        s = undefined;
      });

      s.once("serving", $ => {
        this._logger.info({ msName: name }, `service '${name}' registered`);
        resolve(s);
      });

      s.on("request", onRequest);

      s.serve();
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
      s.on("disconnect", $ => delete this._services[name]);
      s.connect($ => {
        this._logger.info(
          { msName: name },
          `client service '${name}' connected`
        );
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
          this._logger.debug(
            { msName: serviceName, msMethod: method },
            `got response for request method '${method}', error: ${err &&
              (err.stack || err)}`
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

  _instrumentLogger() {}
}

module.exports = { BusServices, BusService, ServiceHandler };
