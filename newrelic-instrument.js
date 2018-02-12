const newrelic = process.env.USE_NEWRELIC && require("newrelic");

newrelic &&
  newrelic.instrumentMessages("busmq", function(
    shim,
    messageBrokerModule,
    moduleName
  ) {
    shim.setLibrary("busmq");

    const service = messageBrokerModule.create({}).service("bla");
    const serviceProto = Object.getPrototypeOf(service);
    shim.recordProduce(serviceProto, "request", function(shim, fn, name, args) {
      const request = args[0],
        options = args[1],
        transName = `${request.serviceName ||
          request.service ||
          "service"}/${request.method || "method"}`;

      //newrelic.setTransactionName(transName);

      request.headers = {};

      return {
        callback: shim.LAST,
        destinationName: transName,
        destinationType: "service",
        headers: request.headers
      };
    });

    const request = serviceProto.request;
    serviceProto.request = function() {
      const activeSegment = shim.getActiveSegment();
      if (activeSegment) return request.apply(this, arguments);

      var msg = arguments[0] || {},
        res;
      newrelic.startBackgroundTransaction(
        `${msg.serviceName || msg.service || "service"}/${msg.method ||
          "method"}`,
        null,
        $ => {
          const transaction = newrelic.getTransaction(),
            cb = arguments[arguments.length - 1];
          arguments[arguments.length - 1] = function() {
            try {
              return cb.apply(this, arguments);
            } finally {
              transaction.end();
            }
          };
          res = request.apply(this, arguments);
        }
      );

      return res;
    };
  });

newrelic &&
  newrelic.instrumentMessages("./services", function(
    shim,
    messageBrokerModule,
    moduleName
  ) {
    messageBrokerModule.BusServices.prototype._instrumentLogger = instrumentLogger;

    shim.setLibrary("busmq");

    shim.recordSubscribedConsume(
      messageBrokerModule.BusServices.prototype,
      "consume",
      {
        consumer: shim.LAST,
        messageHandler: function(shim, consumer, name, args) {
          const request = args[0];
          //shim.insertCATReplyHeader(request.headers, true);
          return {
            destinationName: `${request.serviceName ||
              request.service ||
              "service"}/${request.method || "method"}`,
            destinationType: "service",
            headers: request.headers
          };
        }
      }
    );
  });

function instrumentLogger(logger) {
  function setLoggerProtoHook(l) {
    var lp = Object.getPrototypeOf(l);
    var lpp = Object.getPrototypeOf(lp);
    if (!lp || !lp.write || !lpp) return;
    if (lpp.info && lpp.trace) return setLoggerProtoHook(lp);

    const write = lp.write;
    const hookProto = {
      write: function(obj) {
        const transHandle = newrelic.getTransaction(),
          trans = transHandle && transHandle._transaction;
        if (trans) {
          const transObj = {
            transaction: trans.id,
            refTransaction: trans.referringTransactionGuid
          };
          arguments[0] =
            obj instanceof Error
              ? Object.assign(obj, transObj)
              : typeof obj === "object"
                ? Object.assign(transObj, obj)
                : transObj;
        }

        return write.apply(this, arguments);
      },

      __hooked__: true
    };
    hookProto.__proto__ = lp;
    l.__proto__ = hookProto;
  }

  setLoggerProtoHook(logger);
}

module.exports = newrelic;
