
const logger = require('./logger');

class BusService {
    constructor(config) {
        this._name = config.name;
        this._consumeCount = config.consumeCount;
        this._busServices = config.busServices;
        this._logger = logger(config);
        this._buildMethodsTable(config.handlers);
    }

    async start() {
        await this._busServices.connect();
        this._service = await this._busServices.consume(this._name, this._consumeCount, this.handleRequest.bind(this));
        return this._service;
    }

    async stop(gracePeriod) {
        if (!this._service || !this._service.isConnected()) return;

        return new Promise((resolve, reject) => {
            const onDisconnect = $ => {
                this._service.removeListener('disconnect', onDisconnect);
                onDisconnect = undefined;
                resolve();
            };

            this._service.on('disconnect', onDisconnect);
            this._service.disconnect(gracePeriod);
        });
    }

    async handleRequest(request) {
        this._logger.debug(`'${this._name}' start handling request for method '${request.method}'`);
        
        this.validateRequest(request);

        const handler = this._methodsToHandler[request.method];
        if (!handler) throw new Error(`[${this._name}] unknown request handler for method '${request.method}'`);

        return handler.handle(request);
    }

    validateRequest(request) {}

    _buildMethodsTable(handlers) {
        this._methodsToHandler = {};
        handlers.forEach(handler => handler.methods.forEach(method => this._methodsToHandler[method] = handler));
    }
}

module.exports = BusService;
