var EventEmitter = require('events').EventEmitter
  , inherits = require('util').inherits;

/**
 * Internal class for callback storage
 * @ignore
 */
var CallbackStore = function() {
  // Make class an event emitter
  EventEmitter.call(this);
  // Add a info about call variable
  this._notReplied = {};
}

/**
 * Internal class for authentication storage
 * @ignore
 */
var AuthStore = function() {
  this._auths = [];
}

AuthStore.prototype.add = function(authMechanism, dbName, username, password, authdbName) {
  // Check for duplicates
  if(!this.contains(dbName)) {
    // Base config
    var config = {
        'username':username
      , 'password':password
      , 'db': dbName
      , 'authMechanism': authMechanism
    };

    // Add auth source if passed in
    if(typeof authdbName == 'string') {
      config['authdb'] = authdbName;
    }

    // Push the config
    this._auths.push(config);
  }
}

AuthStore.prototype.contains = function(dbName) {
  for(var i = 0; i < this._auths.length; i++) {
    if(this._auths[i].db == dbName) return true;
  }

  return false;
}

AuthStore.prototype.remove = function(dbName) {
  var newAuths = [];

  // Filter out all the login details
  for(var i = 0; i < this._auths.length; i++) {
    if(this._auths[i].db != dbName) newAuths.push(this._auths[i]);
  }

  //  Set the filtered list
  this._auths = newAuths;
}

AuthStore.prototype.get = function(index) {
  return this._auths[index];
}

AuthStore.prototype.length = function() {
  return this._auths.length;
}

/**
 * @ignore
 */
inherits(CallbackStore, EventEmitter);

var Base = function Base() {  
  EventEmitter.call(this);

  // Callback store is part of connection specification
  if(Base._callBackStore == null) {
    Base._callBackStore = new CallbackStore();
  }

  // Create a new callback store  
  this._callBackStore = new CallbackStore();
  // Create a new auth store
  this.auth = new AuthStore();
}

/**
 * @ignore
 */
inherits(Base, EventEmitter);

/**
 * Fire all the errors
 * @ignore
 */
Base.prototype.__executeAllCallbacksWithError = function(err) {
  // Check all callbacks
  var keys = Object.keys(this._callBackStore._notReplied);
  // For each key check if it's a callback that needs to be returned
  for(var j = 0; j < keys.length; j++) {
    var info = this._callBackStore._notReplied[keys[j]];
    // Check if we have a chained command (findAndModify)
    if(info && info['chained'] && Array.isArray(info['chained']) && info['chained'].length > 0) {
      var chained = info['chained'];
      // Only callback once and the last one is the right one
      var finalCallback = chained.pop();
      // Emit only the last event
      this._callBackStore.emit(finalCallback, err, null);

      // Put back the final callback to ensure we don't call all commands in the chain
      chained.push(finalCallback);

      // Remove all chained callbacks
      for(var i = 0; i < chained.length; i++) {
        delete this._callBackStore._notReplied[chained[i]];
      }
    } else {
      this._callBackStore.emit(keys[j], err, null);
    }
  }
}

/**
 * Register a handler
 * @ignore
 * @api private
 */
Base.prototype._registerHandler = function(db_command, raw, connection, exhaust, callback) {
  // If we have an array of commands, chain them
  var chained = Array.isArray(db_command);

  // Check if we have exhausted
  if(typeof exhaust == 'function') {
    callback = exhaust;
    exhaust = false;
  }

  // If they are chained we need to add a special handler situation
  if(chained) {
    // List off chained id's
    var chainedIds = [];
    // Add all id's
    for(var i = 0; i < db_command.length; i++) chainedIds.push(db_command[i].getRequestId().toString());
    // Register all the commands together
    for(var i = 0; i < db_command.length; i++) {
      var command = db_command[i];
      // Add the callback to the store
      this._callBackStore.once(command.getRequestId(), callback);
      // Add the information about the reply
      this._callBackStore._notReplied[command.getRequestId().toString()] = {start: new Date().getTime(), 'raw': raw, chained:chainedIds, connection:connection, exhaust:false};
    }
  } else {
    // Add the callback to the list of handlers
    this._callBackStore.once(db_command.getRequestId(), callback);
    // Add the information about the reply
    this._callBackStore._notReplied[db_command.getRequestId().toString()] = {start: new Date().getTime(), 'raw': raw, connection:connection, exhaust:exhaust};
  }
}

/**
 * Re-Register a handler, on the cursor id f.ex
 * @ignore
 * @api private
 */
Base.prototype._reRegisterHandler = function(newId, object, callback) {
  // Add the callback to the list of handlers
  this._callBackStore.once(newId, object.callback.listener);
  // Add the information about the reply
  this._callBackStore._notReplied[newId] = object.info;
}

/**
 *
 * @ignore
 * @api private
 */
Base.prototype._callHandler = function(id, document, err) {
  // If there is a callback peform it
  if(this._callBackStore.listeners(id).length >= 1) {
    // Get info object
    var info = this._callBackStore._notReplied[id];
    // Delete the current object
    delete this._callBackStore._notReplied[id];
    // Emit to the callback of the object
    this._callBackStore.emit(id, err, document, info.connection);
  }
}

/**
 *
 * @ignore
 * @api private
 */
Base.prototype._hasHandler = function(id) {
  // If there is a callback peform it
  return this._callBackStore.listeners(id).length >= 1;
}

/**
 *
 * @ignore
 * @api private
 */
Base.prototype._removeHandler = function(id) {
  // Remove the information
  if(this._callBackStore._notReplied[id] != null) delete this._callBackStore._notReplied[id];
  // Remove the callback if it's registered
  this._callBackStore.removeAllListeners(id);
  // Force cleanup _events, node.js seems to set it as a null value
  if(this._callBackStore._events != null) delete this._callBackStore._events[id];
}

/**
 *
 * @ignore
 * @api private
 */
Base.prototype._findHandler = function(id) {
  var info = this._callBackStore._notReplied[id];
  // Return the callback
  return {info:info, callback:(this._callBackStore.listeners(id).length >= 1) ? this._callBackStore.listeners(id)[0] : null}
}

exports.Base = Base;