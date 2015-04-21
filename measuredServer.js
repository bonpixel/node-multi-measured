var debug = require('debug')('metricsServer');
var config = require('../config/config');
var http  = require('http');
var Measured = require('measured');

var MS = module.exports = (function(){

  var metricFacade = new MetricFacade();

  function MetricsServer(){
    this.isMaster = false;
    this.proc = null;
    this.defaultCollections = ['gauges','counters','histograms','meters','timers'];
  }

  MetricsServer.prototype.init = function(proc, isMaster){
    var _this = this;
    this.proc = proc;

    // Check to see if master
    if(isMaster){
      debug('this is the master node %s', this.proc.pid);

      this.isMaster = true;

      // Create master collection
      this.collections = {
        // Helper method to get back json from this collection
        toJSON: function(){
          var res = {};
          for (var prop in this){
            if(this.hasOwnProperty(prop) && typeof(this[prop]) !== 'function'){
              res[prop] = this[prop].toJSON()[prop];
            }
          }
          return res;
        }
      };

      // Create default collection of collections
      for (var i = 0; i < this.defaultCollections.length; i++) {
        this.collections[this.defaultCollections[i]] = new Measured.createCollection(this.defaultCollections[i]);
      }

      // Create a server with endpoint for metrics
      this.server = http.createServer(function(req, res) {
        res.writeHead(200, {"Content-Type": "application/json"});
        res.end(JSON.stringify(_this.collections.toJSON()));
      });
    }
    return this;
  };

  MetricsServer.prototype.bindEvents = function(proc){
    var _this = this;
    this.proc = proc;
    this.proc.on('message', function(msg){
      _this.handleRequests.call(this, _this, msg);
    });
    return this;
  };

  MetricsServer.prototype.addToCollection = function(data){
    if(this.isMaster){
      if(this.collections) {
        if(!this.collections[data.collection]){
          throw new Error('No Collection Regestered to that name');
        }
        var type = data.type.charAt(0).toUpperCase() + data.type.slice(1);
        var tmp = new metricFacade[type](this.proc, data);
        this.collections[data.collection].register(data.name, tmp.Metric);

        return tmp;
      }
    } else {
      this.proc.send({
        method: 'addToCollection',
        collection: data.collection,
        name: data.name,
        type: data.type,
        processPid: this.proc.pid
      });

      var type = data.type.charAt(0).toUpperCase() + data.type.slice(1);
      return new metricFacade[type](this.proc, data);
    }
  };

  MetricsServer.prototype.createCollection = function(name){
    if(this.isMaster){
      if(this.collections) {
        if(this.collections[name]){
          throw new Error('Collection already Regestered to that name');
        }
        this.collections[name] = new Measured.createCollection(name);
        return this.collections[name];
      }
    } else {
      this.proc.send({
        method: 'createCollection',
        collection: data.collection,
        name: data.name,
        processPid: this.proc.pid
      });
    }
    return this;
  };

  MetricsServer.prototype.handleRequests = function(_this, msg){
    debug('Master ' + process.pid + ' received message from worker ' + this.process.pid + '.');
    if(msg.method in _this){
      _this[msg.method].call(_this, msg);
    }
  };


  MetricsServer.prototype.updateMetric = function(msg) {
    if(this.isMaster){
      if(msg.metricMethod === 'start'){
        this.collections[msg.collection]._metrics[msg.metricName].stopwatch = this.collections[msg.collection]._metrics[msg.metricName][msg.metricMethod](msg.metricParams);
      } if(msg.metricMethod === 'stop'){
        this.collections[msg.collection]._metrics[msg.metricName].stopwatch.end();
      } else {
        this.collections[msg.collection]._metrics[msg.metricName][msg.metricMethod](msg.metricParams);
      }
    }
  };




  ////////////////////
  // METRICS FACADE //
  ////////////////////

  function MetricFacade(){}
  MetricFacade.prototype.Gauge = Gauge;
  MetricFacade.prototype.Counter = Counter;
  MetricFacade.prototype.Meter = Meter;
  MetricFacade.prototype.Histogram = Histogram;
  MetricFacade.prototype.Timer = Timer;


  forwardMessage = function(method, params) {
    this.proc.send({
      method: 'updateMetric',
      metricMethod: method,
      metricParams: params,
      metricName: this.name,
      collection: this.collection,
      eventType: this.eventType
    });
  };



  ///////////
  // Gauge //
  ///////////
  // No Methods
  function Gauge(proc, properties){
    this.proc = proc;
    this.properties = properties;
    this.name = properties.name;
    this.collection = properties.collection;
    this.Metric = new Measured.Gauge(this.properties);
  };
  Gauge.prototype.toJSON = function() { return this.Metric.toJSON(); };


  /////////////
  // Counter //
  /////////////
  // inc(n) Increment the counter by n. Defaults to 1.
  // dec(n) Decrement the counter by n. Defaults to 1.
  // reset(count) Resets the counter back to count Defaults to 0.
  function Counter(proc, properties){
    this.proc = proc;
    this.properties = properties;
    this.name = properties.name;
    this.collection = properties.collection;
    this.Metric = new Measured.Counter(this.properties);
  };
  Counter.prototype.inc = function(n) { return forwardMessage.call(this, 'inc', n); };
  Counter.prototype.dec = function(n) { return forwardMessage.call(this, 'dec', n); };
  Counter.prototype.reset = function(count) { return forwardMessage.call(this, 'reset', count); };
  Counter.prototype.toJSON = function() { return this.Metric.toJSON(); };


  ///////////
  // Meter //
  ///////////
  // mark(n) Register n events as having just occured. Defaults to `1.
  // reset() Resets all values. Meters initialized with custom options will be reset to the default settings (patch welcome).
  // unref() Unrefs the backing timer. The meter will not keep the event loop alive. Idempotent.
  // ref() Refs the backing timer again. Idempotent.
  function Meter(proc, properties){
    this.proc = proc;
    this.properties = properties;
    this.name = properties.name;
    this.collection = properties.collection;
    this.Metric = new Measured.Meter(this.properties);
  };
  Meter.prototype.mark = function(n) { return forwardMessage.call(this, 'mark', n); };
  Meter.prototype.reset = function(n) { return forwardMessage.call(this, 'reset'); };
  Meter.prototype.unref = function() { return forwardMessage.call(this, 'unref'); };
  Meter.prototype.ref = function() { return forwardMessage.call(this, 'ref'); };
  Meter.prototype.toJSON = function() { return this.Metric.toJSON(); };

  ///////////////
  // Histogram //
  ///////////////
  // update(value, timestamp) Pushes value into the sample. timestamp defaults to Date.now().
  // reset() Resets all values. Histograms initialized with custom options will be reset to the default settings (patch welcome).
  function Histogram(proc, properties){
    this.proc = proc;
    this.properties = properties;
    this.name = properties.name;
    this.collection = properties.collection;
    this.Metric = new Measured.Histogram(this.properties);
  };
  Histogram.prototype.update = function(val, timestamp) { return forwardMessage.call(this, 'update', val, timestamp); };
  Histogram.prototype.reset = function() { return forwardMessage.call(this, 'reset'); };
  Histogram.prototype.toJSON = function() { return this.Metric.toJSON(); };


  ///////////
  // Timer //
  ///////////
  // start() Returns a Stopwatch.
  // update(value) Updates the internal histogram with value and marks one event on the internal meter.
  // reset() Resets all values. Timers initialized with custom options will be reset to the default settings (patch welcome).
  // unref() Unrefs the backing timer. The internal meter will not keep the event loop alive. Idempotent.
  // ref() Refs the backing timer again. Idempotent.
  function Timer(proc, properties){
    this.proc = proc;
    this.properties = properties;
    this.name = properties.name;
    this.collection = properties.collection;
    this.Metric = new Measured.Timer(this.properties);
  };
  Timer.prototype.start = function(val) { return forwardMessage.call(this, 'start'); };
  Timer.prototype.start = function(val) { return forwardMessage.call(this, 'stop'); };
  Timer.prototype.update = function() { return forwardMessage.call(this, 'update'); };
  Timer.prototype.reset = function() { return forwardMessage.call(this, 'reset'); };
  Timer.prototype.unref = function() { return forwardMessage.call(this, 'unref'); };
  Timer.prototype.ref = function() { return forwardMessage.call(this, 'ref'); };
  Timer.prototype.toJSON = function() { return this.Metric.toJSON(); };



  return new MetricsServer();
})();
