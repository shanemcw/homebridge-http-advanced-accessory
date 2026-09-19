> Historical 1.3.0 feature reference and examples, with example syntax corrections. For Alpha installation, runtime requirements and cache behavior, use the root README. Examples are retained as compatibility reference; this document does not override Alpha guidance.

# homebridge http advanced accessory

Homebridge plugin that can turn virtually any device which exposes HTTP APIs into an HomeKit-compatible Service.
Its purpose is to connect any device that can be controlled via HTTP command to Homekit. It creates a Homebridge accessory which uses HTTP calls to *change* and *check* its state via [Actions](#actions).

This plugin is a fork of HttpAccessory and has merged many features (mainly mappers) from the [homebridge-http-securitysystem](<https://www.npmjs.com/package/homebridge-http-securitysystem>).

## Installation

1. Install homebridge using: npm install -g homebridge
2. Install this plugin using: npm install -g homebridge-http-advanced-accessory
3. Update your configuration file. See sample-config.json in this repository for a sample.

## Features

The main function of the module is to proxy HomeKit queries to an arbitrary web API to retrieve and set the status of the accessory. Main features include:

- Configurable HTTP endpoints to use for getting/setting the state, including passing parameters in for of GET or in POST body
- Support for basic HTTP authentication
- Configurable mapping of API response data to HomeKit Accessory status to allow custom responses
- Configurable mapping of url and body request data to HomeKit Accessory status to allow custom requests
- Interval polling of the current state to enable real-time notifications even if the Accessory has been enabled without the use of HomeKit

## Configuration

Configuration sample:

 ```json
 {
    "bridge": {
        "name": "Homebridge",
        "username": "C1:38:5A:AC:39:30",
        "port": 51826,
        "pin": "123-45-678"
    },
    "description": "This is an example configuration for the Everything Homebridge plugin",
    "accessories": [
        {
            "accessory": "HttpAdvancedAccessory",
            "service": "ContactSensor",
            "name": "Terrace Sensor",
            "forceRefreshDelay": 5,
            "username": "admin",
            "password": "admin",
            "debug" : false,
            "optionCharacteristic" :[],
            "urls":{
               "getContactSensorState": {
                  "url" : "http://remoteserver/xml/zones/zonesStatus48IP.xml",
                  "mappers" : [
                      {
                          "type": "xpath",
                          "parameters": {
                              "xpath": "//status[1]/text()"
                          }
                      },
                      {
                          "type": "static",
                          "parameters": {
                              "mapping": {
                                  "ALARM": "1",
                                  "NORMAL":"0"
                              }
                          }
                     }
                  ]
               }
            }
         },
         {
         "accessory": "HttpAdvancedAccessory",
         "service": "SecuritySystem",
         "name": "Btcino Security",
         "forceRefreshDelay": 5,
         "username": "admin",
         "password": "admin",
         "debug" : false,
         "setterDelay" : 1000,
         "urls":{
            "getSecuritySystemTargetState": {
               "url" : "http://remoteserver/xml/state/virtualKeypad.xml",
               "mappers" : [
                   { "type": "xpath",  "parameters": { "xpath": "//generic/text()" } },
                   { "type": "static", "parameters": { "mapping": { "0": "3", "1": "1", "2": "2", "3": "0" } } }
               ]
            },
            "getSecuritySystemCurrentState": {
               "url" : "http://remoteserver/xml/partitions/partitionsStatus48IP.xml",
               "mappers" : [
                  { "type": "regex",  "parameters": { "regexp" : "(ALARM)",    "capture": "1" } },
                  { "type": "regex",  "parameters": { "regexp" : ">(ARMED)",   "capture": "1" } },
                  { "type": "regex",  "parameters": { "regexp" : "(DISARMED)", "capture": "1" } },
                  { "type": "static", "parameters": { "mapping": { "ALARM": "4", "ARMED":"inconclusive", "DISARMED": "3"} } }
               ],
               "inconclusive" : {
                  "url" : "http://remoteserver/xml/state/virtualKeypad.xml",
                  "mappers" : [
                      { "type": "xpath",  "parameters": { "xpath": "//generic/text()" } },
                      { "type": "static", "parameters": { "mapping": { "0": "3", "1": "1", "2": "2", "3": "0" } } }
                  ]
               }
            },
            "setSecuritySystemTargetState": {
               "url" : "http://remoteserver/xml/cmd/cmdOk.xml?cmd=setMacro&macroId={value}&redirectPage=/xml/cmd/cmdError.xml",
               "mappers" : [
                   { "type": "static", "parameters": { "mapping": { "0": "3", "1": "1", "2": "2", "3": "0" } } }
               ]
            }
         }
         }
    ],

    "platforms": []
}
```

- The **name** parameter determines the name of the accessory you will see in HomeKit.
- The **service** parameter determines the kind of Service\Accessory you will see in HomeKit.
- The **username/password** configuration can be used to specify the username and password if the remote webserver requires HTTP authentication.
- A **debug** turns on debug messages. The important bit is that it reports the mapping process so that it's easier to debug.
- The **optionCharacteristic** is an array of optional Characteristics of the service that you want to expose to HomeKit. The full list of mandatory and optional Characteristics types that HomeKit supports are exposed as a separate subclass in [HomeKitTypes](https://github.com/homebridge/HAP-NodeJS/blob/master/src/lib/gen/HomeKit.ts).
- The **urls section** configures the URLs that are to be called on certain events. It contains a key-value map of actions that can be executed. The key is name of the action and the value is a configuration JSON object for that action. See the [Actions](#actions) section below.
- The **polling** is a boolean that specifies if the current state should be pulled on regular intervals or not. Defaults to false.
- **forceRefreshDelay** is a number which defines the poll interval in seconds. Defaults to 0.
- **setterDelay** is a number which defines the number of milliseconds to wait before executing a "set" action request. If more than one request is received during this interval, only the last one is executed. Defaults to 0 - disabled.
- **uriCallsDelay** number of milliseconds to add a short delay between URI calls for devices that can't handle many URI calls at the same time. Defaults to 0 - disabled.

## Actions

The action is a key-value map that configures the URLs to be called to perform a read or a write on a particular Characteristic. In fact, there are two kind of actions, getters and setters: actions for getter keys begin with word "get", actions for the setters begin with "set".
So the key name is composed of two parts:

- The kind of action: "get" or "set"
- The name of the HomeKit Characteristics for that Service. All known built-in Service and Characteristic types that HomeKit supports are exposed as a separate subclass in [HomeKitTypes](https://github.com/homebridge/HAP-NodeJS/blob/master/src/lib/gen/HomeKit.ts).

For example, to get the value of the SecuritySystemTargetState Characteristic, the key value would be "getSecuritySystemTargetState"—while to set it, "setSecuritySystemTargetState"

### Getter Action

The following example belongs inside the accessory's `urls` object and defines a **getter** action:

```json
{
    "getTargetTemperature": {
        "url": "http://device.example/temperature",
        "httpMethod": "GET",
        "mappers": [],
        "inconclusive": {
            "url": "http://device.example/temperature/fallback",
            "httpMethod": "GET",
            "mappers": []
        }
    }
}
```

Where:

- The **url** parameter is the url to be called for that action.
- The **httpMethod** (OPTIONAL) parameter is one of "GET" or "POST". Defaults to "GET".
- The **body** (OPTIONAL) parameter is the body of the HTTP POST call.
- The **mappers** (OPTIONAL) are a chain of blocks that have the purpose to parse the response received, see [Mapping](#mapping)
- The **inconclusive** (OPTIONAL) parameter is another action that will be invoked if the result of the previous mapping chain is the word "inconclusive"
- The **resultOnError** (OPTIONAL) parameter, if specified, will be result if the HTTP request encounters an error. This is helpful for HTTP health checks, where failure to connect can be mapped to a (valid) failing value rather than passed through as an error.

### Setter Action

The following example belongs inside the accessory's `urls` object and defines a **setter** action:

```json
{
    "setTargetTemperature": {
        "url": "http://device.example/setTemperature?stemp={value}",
        "httpMethod": "POST",
        "body": "{value}",
        "mappers": []
    }
}
```

Where:

- The **url** parameter is the URL to be called for that action. If the string contains the "{value}" placeholder, it will be replaced by the value that HomeKit wants to set, after being changed parsed by mappers. The url can also be a string template, see [URL Template](#url-template)
- The **httpMethod** (OPTIONAL) parameter is one of "GET" or "POST". Defaults to "GET".
- The **body** (OPTIONAL) parameter is the body of the HTTP POST call.
- The **mappers** (OPTIONAL) are a chain of blocks that have the purpose of changing the value that HomeKit wants to set to something that is valid for your device, see [Mapping](#mapping)

### URL Template

The URL can be a [string template](<http://exploringjs.com/es6/ch_template-literals.html>) so you can use expressions like `${state.getCurrentTemperature}` that will be replaced by the current value of the Characteristic CurrentTemperature.
The *state* variable contains all the values of the Characteristics of the Service, plus the *value* variable contains the value HK wants to set for the Characteristic being set.
For example, suppose that when setting the Active state of a HeatingCooling system it also needs to set the TargetTemperature in Fahrenheit—you may have something like this:

```json
{
    "setActive": {
        "url": "http://device.example/setActive?${value}&stemp=${state.getTargetTemperature * 9/5 +32}"
    }
}
```



### Mapping

The mappings block of the configuration may contain any number of mapper definitions. The mappers are chained after each other—the result of a mapper is fed into the input of the next mapper. The purpose of this whole chain is to somehow boil down the response received from the API to a single value which is expected by HomeKit.

Each mapper has a `type` and a `parameters` object. For example:

```json
{
    "type": "static",
    "parameters": {
        "mapping": { "ON": "1", "OFF": "0" }
    }
}
```

There are five mapper types: static, regex, XPath, JSONPath and eval.

#### Static mapper

The static mapper can be used to define a key => value dictionary. It will simply look up the input in the dictionary and if it is found, it returns the corresponding value. It's great for mapping string responses like "ARMED" to their actual number.

Configuration is as follows:

```json
{
    "type": "static",
    "parameters": {
        "mapping": {
            "STAY": "0",
            "AWAY": "1",
            "whataever you don't like": "whatever you like more"
        }
    }
}
```

This configuration would map STAY to 0, AWAY to 1 and "whatever you don't like" to "whatever you like more". If the mapping does not have an entry which corresponds to input, it returns the full input.

#### Regexp mapper

The regexp mapper can be used to define a regular expression to run on the input, capture some substring of it and return it. It's great for mapping string responses which may change around but have a certain part that's always there and which is the part you are interested in.

Configuration is as follows:

```json
{
    "type": "regex",
    "parameters": {
        "regexp": "^The system is currently (ARMED|DISARMED), yo!$",
        "capture": "1"
    }
}
```

This configuration will run the regular expression defined by the ***regexp*** parameter against the input and return the first capture group (as defined by ***capture***). So, in this case, if the input is "The system is currenty ARMED, yo!", the mapper will map this to "ARMED".

If the regexp does not match the input, the mapper returns the full input.

#### XPath mapper

The XPath mapper can be used to extract data from an XML document. It allows the definition of an XPath which will then be applied to the input and returns whatever the query selects.

When using this mapper, make sure that you select text elements and not entire nodes or node lists, otherwise it will fail horribly.

Configuration is as follows:

```json
{
    "type": "xpath",
    "parameters": {
        "xpath": "//partition[3]/text()",
        "index": 0
    }
}
```

Let's assume this mapper gets the following input:

```xml
<?xml version="1.0" encoding="ISO-8859-1"?>
<partitionsStatus>
    <partition>ARMED</partition>
    <partition>ARMED</partition>
    <partition>ARMED_IMMEDIATE</partition>
</partitionsStatus>
```

In this case this mapper will return "ARMED_IMMEDIATE". The ***index*** parameter can be used to specify which element to return if the xpath selects multiple elements. In the example above it is completely redundant as partition[3] already makes sure that a single partition is selected.

#### JSONPath mapper

The JSONPath mapper can be used to extract data from a JSON object. See https://www.npmjs.com/package/JSONPath#syntax-through-examples for syntax and more examples.

When using this mapper, make sure that you select text elements or arrays and not entire objects.

Configuration is as follows:

```json
{
    "type": "jpath",
    "parameters": {
        "jpath": "$.partitionsStatus.partition[2]",
        "index": 0
    }
}
```

Let's assume this mapper gets the following input:

```json
{
    "partitionsStatus": {
        "partition": [
            "ARMED",
            "ARMED",
            "ARMED_IMMEDIATE"
        ]
    }
}
```

In this case this mapper will return "ARMED_IMMEDIATE". The ***index*** parameter can be used to specify which element to return if the JSONPath selects multiple elements. In the example above it is completely redundant as partition[2] already makes sure that a single partition is selected.

#### Eval mapper

The eval mapper can be used to run any JavaScript code, which will be interpreted when the event is called. Use `value` to use the set/read value in your code.

Configuration is as follows:

```json
{
    "type": "eval",
    "parameters": {
        "expression": "value === \"OK\" ? 1 : 0"
    }
}
```

In this example, if the mapper receives the string `OK` it will return `1`, for anything else it will return `0`.
Be careful with the code you write, this mapper can be very flexible but it can also blow up quite easily.

## Supported services

AccessoryInformation
AirQualitySensor
BatteryService
BridgeConfiguration
BridgingState
CameraControl
CameraRTPStreamManagement
CarbonDioxideSensor
CarbonMonoxideSensor
ContactSensor
Door
Doorbell
Fan
GarageDoorOpener
HumiditySensor
LeakSensor
LightSensor
Lightbulb
LockManagement
LockMechanism
Microphone
MotionSensor
OccupancySensor
Outlet
Pairing
ProtocolInformation
Relay
SecuritySystem
SmokeSensor
Speaker
StatefulProgrammableSwitch
StatelessProgrammableSwitch
Switch
TemperatureSensor
Thermostat
TimeInformation
TunneledBTLEAccessoryService
Window
WindowCovering

## Configuration Examples

The purpose of this section is collect as many configuration examples as possible.

### Bticino "Nuovo antifurto filare"

This first example is to configure a Bticino (BT-4200, 4201, 4202) as a HomeKit SecuritySystem

```json
    {
        "accessory": "HttpAdvancedAccessory",
        "service": "SecuritySystem",
        "name": "Btcino Security",
        "forceRefreshDelay": 5,
        "username": "admin",
        "password": "admin",
        "debug" : false,
        "urls":{
            "getSecuritySystemTargetState": {
                "url" : "http://remoteserver/xml/state/virtualKeypad.xml",
                "mappers" : [
                    { "type": "xpath",  "parameters": { "xpath": "//generic/text()" } },
                    { "type": "static", "parameters": { "mapping": { "0": "3", "1": "1", "2": "2", "3": "0" } } }
                ]
            },
            "getSecuritySystemCurrentState": {
                "url" : "http://remoteserver/xml/partitions/partitionsStatus48IP.xml",
                "mappers" : [
                    { "type": "regex",  "parameters": { "regexp" : "(ALARM)",    "capture": "1" } },
                    { "type": "regex",  "parameters": { "regexp" : ">(ARMED)",   "capture": "1" } },
                    { "type": "regex",  "parameters": { "regexp" : "(DISARMED)", "capture": "1" } },
                    { "type": "static", "parameters": { "mapping": { "ALARM": "4", "ARMED":"inconclusive", "DISARMED": "3"} } }
                ],
                "inconclusive" : {
                    "url" : "http://remoteserver/xml/state/virtualKeypad.xml",
                    "mappers" : [
                        { "type": "xpath",  "parameters": { "xpath": "//generic/text()" } },
                        { "type": "static", "parameters": { "mapping": { "0": "3", "1": "1", "2": "2", "3": "0" } } }
                    ]
                }
            },
            "setSecuritySystemTargetState": {
                "url" : "http://remoteserver/xml/cmd/cmdOk.xml?cmd=setMacro&macroId={value}&redirectPage=/xml/cmd/cmdError.xml",
                "mappers" : [
                    { "type": "static", "parameters": { "mapping": { "0": "3", "1": "1", "2": "2", "3": "0" } } }
                ]
            }
        }
    }
```

### Bticino "Nuovo antifurto filare" Zones as ContactSensor

```json
{
    "accessory": "HttpAdvancedAccessory",
    "service": "ContactSensor",
    "name": "Terrace Sensor",
    "forceRefreshDelay": 5,
    "username": "admin",
    "password": "admin",
    "debug" : false,
    "urls":{
        "getContactSensorState": {
            "url" : "http://remoteserver/xml/zones/zonesStatus48IP.xml",
            "mappers" : [
                {
                    "type": "xpath",
                    "parameters": {
                        "xpath": "//status[1]/text()"
                    }
                },
                {
                    "type": "static",
                    "parameters": {
                        "mapping": {
                            "ALARM": "1",
                            "NORMAL":"0"
                        }
                    }
                }
            ]
        }
    }
}
```

### Daikin as HeaterCooler

This is still incomplete but the unofficial [Daikin documentation](https://github.com/ael-code/daikin-control) can help you to complete it.

```json
{
    "accessory": "HttpAdvancedAccessory",
    "service": "HeaterCooler",
    "name": "Condizionatore Soggiorno",
    "forceRefreshDelay": 5,
    "debug" : false,
    "urls":{
        "getCurrentHeaterCoolerState": {
            "url" : "http://192.168.x.x/aircon/get_control_info",
            "mappers" : [
                {"type": "regex", "parameters": {"regexp": "(pow=0)","capture": "1"} },
                {"type": "regex", "parameters": { "regexp": "mode=(\\d)", "capture": "1"} },
                {"type": "static", "parameters": { "mapping": { "pow=0": "0", "3":"3", "4":"2"} } }
            ]
        },
        "getTargetHeaterCoolerState":{
            "url" : "http://192.168.x.x/aircon/get_control_info",
            "mappers" : [
                {"type": "regex", "parameters": {"regexp": "(pow=0)","capture": "1"} },
                {"type": "regex", "parameters": { "regexp": "mode=(\\d)", "capture": "1"} },
                {"type": "static", "parameters": { "mapping": { "pow=0": "0", "3":"3", "4":"2", "0":"3", "1":"3", "7":"3", "2":"3"} } }
            ]
        },
        "setTargetHeaterCoolerState":{
            "url" : "http://192.168.x.x/aircon/set_control_info/{value}",
            "mappers" : [
                {"type": "static", "parameters": { "mapping": { "0": "?mode=0", "1":"?mode=4", "2":"?mode=3"} } }
            ]
        },
        "getActive":{
            "url" : "http://192.168.x.x/aircon/get_control_info",
            "mappers" : [
                {"type": "regex", "parameters": {"regexp": "pow=(\\d)","capture": "1"} }
            ]
        },
        "setActive":{
            "url" : "http://192.168.x.x/aircon/set_control_info/{value}",
            "mappers" : [
                {"type": "static", "parameters": { "mapping": { "0": "?pow=0", "1":"?pow=1"} } }
            ]
        }

    }
}

```

### Yamaha Musiccast WX-010 as Switch

```json
{
    "accessory": "HttpAdvancedAccessory",
    "service": "Switch",
    "name": "Bedroom speaker",
    "forceRefreshDelay": 5,
    "debug" : false,
    "urls":{
        "getOn":{
            "url" : "http://192.168.x.x/YamahaExtendedControl/v1/main/getStatus",
            "mappers" : [
                {
                    "type": "jpath",
                    "parameters": {
                        "jpath": "$..power",
                        "index": "0"
                    }
                },
                {
                    "type": "static",
                    "parameters": {
                        "mapping": {
                            "on": "1",
                            "standby": "0"
                        }
                    }
                }
            ]
        },
        "setOn":{
            "url" : "http://192.168.x.x/YamahaExtendedControl/v1/main/setPower?power=${value==1?\"on\":\"standby\"}"
        }

    }
}

```

### Generic Web API as Lightbulb

```json
{
    "accessory": "HttpAdvancedAccessory",
    "service": "Lightbulb",
    "name": "Pool Light",
    "manufacturer": "Custom",
    "model": "Virtual Device",
    "debug": false,
    "optionCharacteristic": [
        "Hue",
        "Saturation",
        "Brightness"
    ],
    "urls": {
        "setOn": {
            "httpMethod": "POST",
            "body": "%7B%22c%22%3A%22pool%20i%20{value}%22%7D",
            "url": "http://127.0.0.1/control.php",
            "mappers": [
                {
                    "type": "static",
                    "parameters": {
                        "mapping": {
                            "true": "on",
                            "false": "off"
                        }
                    }
                }
            ]
        },
        "getOn": {
            "httpMethod": "POST",
            "body": "%7B%22c%22%3A%22update%20pool-on%22%7D",
            "url": "http://127.0.0.1/control.php",
            "mappers": [
                {
                    "type": "jpath",
                    "parameters": {
                        "jpath": "$.u",
                        "index": 0
                    }
                }
            ]
        },
        "setHue": {
            "httpMethod": "POST",
            "url": "http://127.0.0.1/control.php",
            "body": "%7B%22c%22%3A%22pool%20hue%20{value}%22%7D",
            "mappers": []
        },
        "getHue": {
            "httpMethod": "POST",
            "url": "http://127.0.0.1/control.php",
            "body": "%7B%22c%22%3A%22value%20pool-h%22%7D",
            "mappers": [
                {
                    "type": "jpath",
                    "parameters": {
                        "jpath": "$.u",
                        "index": 0
                    }
                }
            ]
        },
        "setSaturation": {
            "httpMethod": "POST",
            "url": "http://127.0.0.1/control.php",
            "body": "%7B%22c%22%3A%22pool%20saturation%20{value}%22%7D",
            "mappers": []
        },
        "getSaturation": {
            "httpMethod": "POST",
            "url": "http://127.0.0.1/control.php",
            "body": "%7B%22c%22%3A%22value%20pool-s%22%7D",
            "mappers": [
                {
                    "type": "jpath",
                    "parameters": {
                        "jpath": "$.u",
                        "index": 0
                    }
                }
            ]
        },
        "setBrightness": {
            "httpMethod": "POST",
            "url": "http://127.0.0.1/control.php",
            "body": "%7B%22c%22%3A%22pool%20brightness%20{value}%22%7D",
            "mappers": []
        },
        "getBrightness": {
            "httpMethod": "POST",
            "url": "http://127.0.0.1/control.php",
            "body": "%7B%22c%22%3A%22value%20pool-b%22%7D",
            "mappers": [
                {
                    "type": "jpath",
                    "parameters": {
                        "jpath": "$.u",
                        "index": 0
                    }
                }
            ]
        }
    }
}
```

## Plugin Development

To aid in testing and developing this plugin further I have provided a sample homebridge config. This will allow you to spin a homebridge instance for development that has this plugin already installed.
Install homebridge, checkout this repo and run:
```sh
$ homebridge --debug --user-storage-path .homebridge-dev --plugin-path ./
```
