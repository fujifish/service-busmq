const logger = require("./logger");

class BusService {
  constructor(config) {
    this._name = config.name;
    this._consumeCount = config.consumeCount;
    this._busServices = config.busServices;
    this._logger = logger(config).child({ msName: this._name });
    this._services = [];
    this._buildMethodsTable(config.handlers);
  }

  async start() {
    this._logger.debug(`Starting '${this._name}' service`);
    if (this._services.length > 0)
      throw new Error(
        `Failed to start '${this._name}' service - ${
          this._services.length
        } services are still registered`
      );

    await this._busServices.connect();
    const handlerMethods = this.methods;
    for (var method of handlerMethods) {
      this._services.push(
        await this._busServices.consume(
          this._name,
          method,
          this._consumeCount,
          this.handleRequest.bind(this)
        )
      );
    }
    return this._services; // todo: api-ms expects single bus service
  }

  async stop(gracePeriod) {
    this._logger.debug(`Stopping '${this._name}' service`);
    const services = this._services.slice();
    await Promise.all(
      services.map(service => {
        return new Promise((resolve, reject) => {
          const _resolve = $ => {
            const index = this._services.findIndex(
              service2 => service === service2
            );
            if (index > -1) this._services.splice(index, 1);
            resolve();
          };

          var onDisconnect = $ => {
            service.removeListener("disconnect", onDisconnect);
            onDisconnect = undefined;
            _resolve();
          };

          if (!service.isServing()) {
            return _resolve();
          }

          service.on("disconnect", onDisconnect);
          service.disconnect(gracePeriod);
        });
      })
    );

    if (this._services.length > 0)
      this._logger.warn(
        `'${this._name}' service stop completed with ${
          this._services.length
        } services still registered`
      );
    else this._logger.debug(`'${this._name}' service stopped`);
  }

  async handleRequest(request) {
    this._logger.debug(
      `'${this._name}' start handling request for '${request.serviceFQN}'`
    );

    const handler = this.getHandler(request);
    try {
      this.validateRequest(request, handler);
      return await handler.handle(request);
    } catch (ex) {
      this._logger.error(
        { exception: ex.stack },
        `'${this._name}' failed during handling request for method '${
          request.serviceFQN
        }' - exception:\n'${ex}'`
      );
      throw ex;
    }
  }

  getHandler(request) {
    return this._methodsToHandler[request.method];
  }

  validateRequest(request, handler) {
    if (!handler)
      throw new Error(
        `[${this._name}] unknown request handler for '${request.serviceFQN}'`
      );
  }

  get methods() {
    return this._methodsToHandler ? Object.keys(this._methodsToHandler) : [];
  }

  _buildMethodsTable(handlers) {
    this._methodsToHandler = {};
    handlers.forEach(handler =>
      handler.methods.forEach(
        method => (this._methodsToHandler[method] = handler)
      )
    );
  }
}

module.exports = BusService;
