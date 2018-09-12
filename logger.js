function noop() {}
function logger(config) {
  return (
    (config && config.logger) || {
      trace: noop,
      debug: noop,
      info: noop,
      error: noop,
      warn: noop,
      child: logger,
      isLevelEnabled() {
        return true;
      }
    }
  );
}

module.exports = logger;
