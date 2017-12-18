
const logger = require('./logger');

class BusService {
    constructor(config) {
        this._name = config.name;
        this._handlers = config.handlers;
        this._busServices = config.busServices;
        this._logger = logger(config);
        this._buildMethodsTable();
    }

    async start() {
        await this._busServices.connect();
        await this._busServices.subscribeService('approvals', this._handleRequest.bind(this));
    }

    async _handleRequest(request) {
        this._logger.debug(`'%s' start handling request for method '%s'`, this._name, request.method);
        
        this._validateRequest(request);

        const handler = this._methodsToHandler[request.method];
        if (!handler) throw new Error(`[${this._name}] unknown request handler for method '${request.method}'`);

        return await handler.handle(request);
    }

    _validateRequest(request) {}

    _buildMethodsTable() {
        this._methodsToHandler = {};
        this._handlers.forEach(handler => handler.methods.forEach(method => this._methodsToHandler[method] = handler));
    }
}

module.exports = BusService;
