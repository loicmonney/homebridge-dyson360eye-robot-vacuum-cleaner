'use strict';

// Possible improvements:
// https://github.com/KhaosT/HAP-NodeJS/blob/master/lib/gen/HomeKitTypes.js
// - Characteristic.StatusActive
// - Characteristic.StatusFault
// - Characteristic.StatusJammed = Bloqué
// - Characteristic.StatusLowBattery
// - Characteristic.InUse?
// - Characteristic.ObstructionDetected

const mqtt = require('mqtt');
const EventEmitter = require('events');

let Service;
let Characteristic;

module.exports = function (homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;

    homebridge.registerAccessory("homebridge-dyson360eye-robot-vacuum-cleaner", "Dyson360EyeRobotVacuumCleaner", Dyson360EyeRobotVacuumCleaner);
};

function Dyson360EyeRobotVacuumCleaner(log, config) {
    this.log = log;

    // Name of the robot
    this.name = config['name'];

    // Host/IP
    this.host = config['host'];

    // Port (default 1883)
    this.port = config['port'];

    // Username (SSID)
    this.username = config['username'];

    // Password
    this.password = config['password'];

    // State of the robot
    // Allowed are: INACTIVE_CHARGED, INACTIVE_CHARGING, FULL_CLEAN_RUNNING, FULL_CLEAN_PAUSED
    this.state = "INACTIVE_CHARGED";

    // Power mode
    // Allowed are fullPower, halfPower
    this.currentVacuumPowerMode = "fullPower";

    // Battery charge of the robot
    // Allowed are between 0 and 100
    this.batteryChargeLevel = 0;

    // Indicate if the state is refreshing
    // Used to avoid concurrent/multiple refreshes
    this.gettingState = false;

    // Accessory information
    this.informationService = new Service.AccessoryInformation();
    this.informationService
        .setCharacteristic(Characteristic.Name, this.name)
        .setCharacteristic(Characteristic.Manufacturer, "Dyson")
        .setCharacteristic(Characteristic.Model, "Dyson 360 Eye")
        .setCharacteristic(Characteristic.SerialNumber, "1-9-2-8")
    ;

    // start cleaning switch
    this.vacuumRobotCleanService = new Service.Switch(this.name + " Clean", "clean");
    this.vacuumRobotCleanService
        .getCharacteristic(Characteristic.On)
        .on('set', this._setCleaning.bind(this))
        .on('get', this._isCleaning.bind(this))
    ;

    // Go to dock switch
    this.vacuumRobotGoToDockService = new Service.Switch(this.name + " Go to Dock", "goToDock");
    this.vacuumRobotGoToDockService
        .getCharacteristic(Characteristic.On)
        .on('set', this._setGoToDock.bind(this))
        .on('get', this._isCleaningAborted.bind(this))
    ;

    // Quiet/max power switch
    this.vacuumRobotQuietPowerService = new Service.Switch(this.name + " Quiet", "quietPower");
    this.vacuumRobotQuietPowerService
        .getCharacteristic(Characteristic.On)
        .on('set', this._setQuietPower.bind(this))
        .on('get', this._isQuietPower.bind(this))
    ;

    // Robot on dock
    this.vacuumRobotDockStateService = new Service.OccupancySensor(this.name + " Dock", "dockState");
    this.vacuumRobotDockStateService
        .getCharacteristic(Characteristic.OccupancyDetected)
        .on('get', this._isOnDock.bind(this))
    ;

    // Battery status
    this.vacuumRobotBatteryService = new Service.BatteryService("Battery", "battery");
    this.vacuumRobotBatteryService
        .getCharacteristic(Characteristic.BatteryLevel)
        .on('get', this._getBatteryLevel.bind(this))
    ;
    this.vacuumRobotBatteryService
        .getCharacteristic(Characteristic.ChargingState)
        .on('get', this._getBatteryChargingState.bind(this))
    ;

    // Initialise connection with robot
    // Refresh the state of the robot
    this._initConnection();
}

/**
 * List the services and information exposed by this accessory.
 *
 * @returns {*[]}
 */
Dyson360EyeRobotVacuumCleaner.prototype.getServices = function () {
    return [
        this.informationService,
        this.vacuumRobotCleanService,
        this.vacuumRobotGoToDockService,
        this.vacuumRobotDockStateService,
        this.vacuumRobotQuietPowerService,
        this.vacuumRobotBatteryService,
    ];
};

Dyson360EyeRobotVacuumCleaner.prototype.identify = function (callback) {
    this.log("Identify requested");
    callback();
};

/*
 * Initialise the connection with the Robot
 */
Dyson360EyeRobotVacuumCleaner.prototype._initConnection = function () {
    let that = this;
    let url = 'mqtt://' + this.host + ':' + this.port;
    let options = {
        keepalive: 10,
        clientId: 'homebridge-dyson_' + Math.random().toString(16),
        protocolId: 'MQIsdp',
        protocolVersion: 3,
        clean: true,
        reconnectPeriod: 1000,
        connectTimeout: 30 * 1000,
        username: this.username,
        password: this.password,
        rejectUnauthorized: false
    };
    this.log('init connection with robot: ' + url);

    // Used to broadcast events
    this.json_emitter = new EventEmitter();

    // Connect to the robot
    this.mqtt_client = mqtt.connect(url, options);

    // Callback, when connection is establish we refresh the state
    this.mqtt_client.on('connect', function () {
        that.log('Connected with robot');
        that.mqtt_client.subscribe("N223/" + that.username + "/status");
        that.log('Subscribed to ' + "N223/" + that.username + "/status");
        that._refreshStateAsync();
    });

    // Callback, when we receive the current state of the robot
    this.mqtt_client.on('message', function (topic, message) {
        let json = JSON.parse(message);
        that.log(JSON.stringify(json));
        if (json !== null) {
            if (json.msg === "CURRENT-STATE") {
                // Example of message:
                // {
                //   "msg":"CURRENT-STATE",
                //   "state":"INACTIVE_CHARGED",
                //   "fullCleanType":"",
                //   "cleanId":"12000000-4a47-3845-554a-484130313839",
                //   "currentVacuumPowerMode":"fullPower",
                //   "defaultVacuumPowerMode":"fullPower",
                //   "globalPosition":[-2,13],
                //   "batteryChargeLevel":100,
                //   "time":"2018-04-01T19:21:18Z"
                // }

                // Update the state
                that.state = json.state;
                that.currentVacuumPowerMode = json.currentVacuumPowerMode;
                that.batteryChargeLevel = json.batteryChargeLevel;
                that.gettingState = false;
                that.log('state is ' + that.state);

                // Refresh the values in the services (push)
                that.vacuumRobotCleanService
                    .getCharacteristic(Characteristic.On)
                    .updateValue(that.state === 'FULL_CLEAN_RUNNING', null);

                that.vacuumRobotGoToDockService
                    .getCharacteristic(Characteristic.On)
                    .updateValue(that.state === 'FULL_CLEAN_ABORTED', null);

                that.vacuumRobotQuietPowerService
                    .getCharacteristic(Characteristic.On)
                    .updateValue(that.currentVacuumPowerMode === 'halfPower', null);

                let charging = that.state === 'INACTIVE_CHARGING' || that.state === 'INACTIVE_CHARGED';
                that.vacuumRobotDockStateService
                    .getCharacteristic(Characteristic.ContactSensorState)
                    .updateValue(charging);

                that.vacuumRobotBatteryService
                    .getCharacteristic(Characteristic.BatteryLevel)
                    .updateValue(that.batteryChargeLevel);

                that.vacuumRobotBatteryService
                    .getCharacteristic(Characteristic.ChargingState)
                    .updateValue(charging);

                // Broadcast that the state has been changed
                that.json_emitter.emit('state');
            } else {
                that.log('NOT PROCESSED: ' + json);
            }
        }
    });
};

/**
 * Asynchronously refresh the state of the robot.
 *
 * @private
 */
Dyson360EyeRobotVacuumCleaner.prototype._refreshStateAsync = function () {
    if (this.gettingState) {
        this.log('Already getting state, skip to avoid repetitive requests');
        return;
    }
    this.log("_refreshStateAsync");
    this.gettingState = true;
    let that = this;
    this.mqtt_client.publish('N223/' + that.username + '/command', '{"msg":"REQUEST-CURRENT-STATE"}');
};

/**
 * Retrieves the state of the robot and returns if it is cleaning or not.
 *
 * @param callback
 * @private
 */
Dyson360EyeRobotVacuumCleaner.prototype._isCleaning = function (callback) {
    this.log('_isCleaning');
    callback(null, this.state === 'FULL_CLEAN_RUNNING');
};

/**
 * Starts, pauses or resumes the cleaning.
 *
 * @param on TRUE for starting/resuming the cleaning, FALSE to pause the cleaning
 * @param callback
 * @private
 */
Dyson360EyeRobotVacuumCleaner.prototype._setCleaning = function (on, callback) {
    this.log('_setCleaning, on=' + on + ', state=' + this.state);

    // Send command
    let message;
    if (on && (this.state === 'INACTIVE_CHARGING' || this.state === 'INACTIVE_CHARGED')) {
        message = '{"msg":"START","time":"' + new Date().toISOString() + '", "fullCleanType":"immediate"}';
    } else if (!on && this.state === 'FULL_CLEAN_RUNNING') {
        message = '{"msg":"PAUSE","time":"' + new Date().toISOString() + '"}';
    } else if (on && this.state === 'FULL_CLEAN_PAUSED') {
        message = '{"msg":"RESUME","time":"' + new Date().toISOString() + '"}';
    } else {
        this.log('Invalid state');
        return;
    }
    this.log(message);
    this.mqtt_client.publish("N223/" + this.username + "/command", message);

    // Callback
    let that = this;
    this.json_emitter.once('state', function () {
        callback(null, that.state === 'FULL_CLEAN_RUNNING');
    });

    // Refresh the state
    this._refreshStateAsync();
};

/**
 * Indicates if the robot is on its dock.
 *
 * @param callback
 * @private
 */
Dyson360EyeRobotVacuumCleaner.prototype._isOnDock = function (callback) {
    let val = this.state === 'INACTIVE_CHARGING' || this.state === 'INACTIVE_CHARGED';
    this.log('_isOnDock ' + val);
    callback(null, val);
};

/**
 * Stops the cleaning and asks the robot to go to its docking station.
 *
 * @param on must be TRUE
 * @param callback
 * @private
 */
Dyson360EyeRobotVacuumCleaner.prototype._setGoToDock = function (on, callback) {
    this.log('_setGoToDock, on=' + on);
    if (!on) {
        callback(null, this.state === 'FULL_CLEAN_ABORTED');
        return;
    }

    // Send command
    let message = '{"msg":"ABORT","time":"' + new Date().toISOString() + '", "fullCleanType":"immediate"}';
    this.mqtt_client.publish("N223/" + this.username + "/command", message);

    // Callback
    let that = this;
    this.json_emitter.once('state', function () {
        callback(null, that.state === 'FULL_CLEAN_ABORTED');
    });

    // Refresh the state
    // TODO useful?
    this._refreshStateAsync();
};

Dyson360EyeRobotVacuumCleaner.prototype._isCleaningAborted = function (callback) {
    let val = this.state === 'FULL_CLEAN_ABORTED';
    this.log('_isCleaningAborted ' + val);
    callback(null, val);
};

Dyson360EyeRobotVacuumCleaner.prototype._setQuietPower = function (on, callback) {
    this.log('_setQuietPower: on=' + on);

    // Send command
    let now = new Date();
    let powerMode = on ? 'halfPower' : 'fullPower';
    let message = '{"msg":"STATE-SET","time":"' + now.toISOString() + '","data":{"currentVacuumPowerMode":"' + powerMode + '","defaultVacuumPowerMode":"' + powerMode + '"}}';
    this.mqtt_client.publish("N223/" + this.username + "/command", message);

    // Callback
    let that = this;
    this.json_emitter.once('state', function () {
        callback(null, that.state.currentVacuumPowerMode === 'halfPower');
    });
};

Dyson360EyeRobotVacuumCleaner.prototype._isQuietPower = function (callback) {
    let val = this.currentVacuumPowerMode === 'halfPower';
    this.log('_isQuietPower ' + val);
    callback(null, val);
};

Dyson360EyeRobotVacuumCleaner.prototype._getBatteryLevel = function (callback) {
    this.log('_getBatteryLevel ' + this.batteryChargeLevel);
    callback(false, this.batteryChargeLevel);
};

Dyson360EyeRobotVacuumCleaner.prototype._getBatteryChargingState = function (callback) {
    callback(false, this.state.state === 'INACTIVE_CHARGING');
};
