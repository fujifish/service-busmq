
function noop() {}

module.exports = function(config) {
    return (config && config.logger) || { trace: noop, debug: noop, info: noop, error: noop, warn: noop };
};
