
const logger = require('./logger');

class BusService {
    constructor(config) {
        this._name = config.name;
        this._busServices = config.busServices;
        this._logger = logger(config);
        this._buildMethodsTable(config.handlers);
    }

    async start() {
        await this._busServices.connect();
    }

    async handleRequest(request) {
        this._logger.debug(`'${this._name}' start handling request for method '${request.method}'`);
        
        this.validateRequest(request);

        const handler = this._methodsToHandler[request.method];
        if (!handler) throw new Error(`[${this._name}] unknown request handler for method '${request.method}'`);

        return await handler.handle(request);
    }

    validateRequest(request) {}

    _buildMethodsTable(handlers) {
        this._methodsToHandler = {};
        handlers.forEach(handler => handler.methods.forEach(method => this._methodsToHandler[method] = handler));
    }
}

module.exports = BusService;
