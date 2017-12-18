

try { var newrelic = require('newrelic');
} catch(ex) {}

newrelic && newrelic.instrumentMessages('busmq', function(shim, messageBrokerModule, moduleName) {
    shim.setLibrary('busmq');

    const service = messageBrokerModule.create({}).service('bla');
    const serviceProto = Object.getPrototypeOf(service);

    shim.recordProduce(serviceProto, 'request', function(shim, fn, name, args) {
        const request = args[0],
            options = args[1],
            transName = `${request.service || 'service'}:${request.method || 'method'} (${process.env.NODE_ENV || ''})`;
        
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
    shim.setLibrary('busmq');

    shim.recordSubscribedConsume(messageBrokerModule.BusServices.prototype, 'consume', {
        consumer: shim.LAST,
        messageHandler: function(shim, consumer, name, args) {
            const request = args[0];
            //shim.insertCATReplyHeader(request.headers, true);
            return {
                destinationName: `${request.service || 'service'}:${request.method || 'method'} (${process.env.NODE_ENV || ''})`,
                destinationType: 'service',
                headers: request.headers
            };
        }
    });
});
