module.exports = Object.assign(
  { newrelic: require("./newrelic-instrument") },
  require("./services")
);
