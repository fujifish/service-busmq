
const logger = require('./logger');

class ServiceHandler {
    constructor(config) {
        this._methods = [];
        this._name = config.name;
        this._logger = logger(config);
        this._buildMethods(this);
    }

    get methods() {
        return this._methods;
    }

    async handle(request) {
        const methodName = request.method;
        this._logger.debug(`start handling ${methodName} request`);
        if (!methodName) throw new Error(`[ServiceHandler] failed to handle request - missing type`);

        const method = this[methodName];
        if (!method) throw new Error(`[ServiceHandler] failed to handle request '${methodName}' - missing handler method`);

        return await method.call(this, request);
    }

    _buildMethods(obj) {
        if (Object.getPrototypeOf(obj) === Object.prototype) return;

        Object.getOwnPropertyNames(obj).forEach(prop => {
            if (prop === 'constructor') return;

            var res = /^([^_].+)$/.exec(prop);
            if (res) this._methods.push(res[1]);
        });
        this._buildMethods(Object.getPrototypeOf(obj));
    }
}

module.exports = ServiceHandler;