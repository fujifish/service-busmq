
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
        this._logger.debug(`start handling '%s' request`, methodName);
        if (!methodName) throw new Error(`[ServiceHandler] failed to handle request - missing type`);

        const method = this[`handle/${methodName}`];
        if (!method) throw new Error(`[ServiceHandler] failed to handle request '${methodName}' - missing handler method`);

        const validateMethod = this[`validate/${methodName}`];
        if (validateMethod) validateMethod.call(this, request);

        return await method.call(this, request);
    }

    _buildMethods(obj) {
        if (!obj) return;
        
        Object.getOwnPropertyNames(obj).forEach(prop => {
            var res = /^handle\/(.*)$/.exec(prop);
            if (res) this._methods.push(res[1]);
        });
        this._buildMethods(Object.getPrototypeOf(obj));
    }
}

module.exports = ServiceHandler;