# homebridge-dyson360eye

### Description

Homebridge plugin for the Dyson 360 Eye Robot Vacuum Cleaner. This integration let you control your vacuum cleaner
using Apple HomeKit.

Please refer to https://github.com/nfarina/homebridge to install Homebridge.

### Configuration

Example of configuration:

```
"accessories": [
    {
        "accessory": "Dyson360EyeRobotVacuumCleaner",
        "name": "Eddy", # Name you want to give to the robot
        "host": "192.168.1.111", # IP address of the robot (must be static)
        "port": 1883,
        "username": "ASC-EU-AAA1232O", # SSID (found behing the manual)
        "password": "Jqjsuwm...kUUwjasdju==", # password
        "refresh": 0
    }
]​
```

* Username and password can be found on the last page of the manual or behind the robot.

* The password has to be SHA-512 encrypted and then base64 encoded before inserting into the config.
  This can be done via a tool at https://caligatio.github.io/jsSHA/ (client side javascript only).
  Put password into 'Input text', input type 'TEXT', SHA Variant 'SHA-512', Number of Rounds "1", Output Type "Base64".
  The output hash should be copied and placed into the config.  The example below is 'password' encoded correctly.

### Thanks

This plugin is based on the one created by peteakalad (https://github.com/peteakalad/homebridge-dyson360eye)
