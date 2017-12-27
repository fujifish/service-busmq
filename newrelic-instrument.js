

const newrelic = process.env.USE_NEWRELIC && require('newrelic');

newrelic && newrelic.instrumentMessages('busmq', function(shim, messageBrokerModule, moduleName) {
    shim.setLibrary('busmq');

    const service = messageBrokerModule.create({}).service('bla');
    const serviceProto = Object.getPrototypeOf(service);

    shim.recordProduce(serviceProto, 'request', function(shim, fn, name, args) {
        const request = args[0],
            options = args[1],
            transName = `${request.service || 'service'}/${request.method || 'method'}`;
        
        newrelic.setTransactionName(transName);
        
        request.headers = {};

        return {
            callback: shim.LAST,
            destinationName: transName,
            destinationType: 'service',
            headers: request.headers
        }
    });
});

newrelic && newrelic.instrumentMessages('./services', function(shim, messageBrokerModule, moduleName) {
    messageBrokerModule.BusServices.prototype._instrumentLogger = instrumentLogger;
    
    shim.setLibrary('busmq');

    shim.recordSubscribedConsume(messageBrokerModule.BusServices.prototype, 'consume', {
        consumer: shim.LAST,
        messageHandler: function(shim, consumer, name, args) {
            const request = args[0];
            //shim.insertCATReplyHeader(request.headers, true);
            return {
                destinationName: `${request.service || 'service'}/${request.method || 'method'}`,
                destinationType: 'service',
                headers: request.headers
            };
        }
    });
});

function instrumentLogger(logger) {
    function setLoggerProtoHook(l) {
        var lp = Object.getPrototypeOf(l);
        var lpp = Object.getPrototypeOf(lp);
        if (!lp || !lpp) return;

        if (lpp.info && lpp.trace) return setLoggerProtoHook(lp);
        else {
            const write = lp.write;
            const hookProto = {
                write: function(obj) {
                    const trans = newrelic.getTransaction(), transId = trans && trans._transaction && trans._transaction.id;
                    if (transId) arguments[0] = typeof obj === 'object' ? Object.assign({ transaction: transId }, obj) : { transaction: transId };
                    return write.apply(this, arguments);
                },

                __hooked__: true
            };
            hookProto.__proto__ = lp;
            l.__proto__ = hookProto;
        }
    }

    setLoggerProtoHook(logger);
};
