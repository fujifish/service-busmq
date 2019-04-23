global.cpuMeasureForServiceBus = 0;

let secNSec2ms = secNSec => {
  return secNSec[0] * 1000 + secNSec[1] / 1000000;
};

let cpuAverage = (startTime, startUsage) => {
  var elapTime = process.hrtime(startTime);
  var elapUsage = process.cpuUsage(startUsage);

  var elapTimeMS = secNSec2ms(elapTime);
  var elapUserMS = elapUsage.user / 1000;
  var elapSystMS = elapUsage.system / 1000;

  return Math.round(100 * (elapUserMS + elapSystMS) / elapTimeMS);
};

let initCpuMeasure = (startTime, startUsage) => {
  const percent = cpuAverage(startTime, startUsage);
  global.cpuMeasureForServiceBus = percent;
  var elapTime = process.hrtime();
  var elapUsage = process.cpuUsage();
  setTimeout(() => {
    initCpuMeasure(elapTime, elapUsage);
  }, 10 * 1000);
};

module.exports = {
  initCpuMeasure,
  get cpuPercent() {
    return global.cpuMeasureForServiceBus;
  }
};
