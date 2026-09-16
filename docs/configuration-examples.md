# Configuration Examples

These examples are designed to teach the structure of `HttpAdvancedAccessory` configurations rather than document a particular device. Real HTTP APIs differ, so adapt the URLs, response paths, values, and polling intervals to match your device.

The examples progress from a single read-only value to multi-characteristic and multi-step mappings. In every case, `mappers` must be an array, even when it contains only one mapper.

> **Polling:** set `forceRefreshDelay` to a value greater than `0` to refresh getter actions at that interval in seconds. A value of `0` performs the HTTP request when HomeKit asks for the characteristic instead of creating a polling emitter.

## 1. Read a value from JSON

A temperature sensor is a useful minimal example because it needs only one getter and one mapper.

Suppose the device returns:

```json
{
    "temperature": 22.4
}
```

Configuration:

```json
{
    "accessory": "HttpAdvancedAccessory",
    "service": "TemperatureSensor",
    "name": "Patio Temperature",
    "forceRefreshDelay": 30,
    "debug": false,
    "urls": {
        "getCurrentTemperature": {
            "url": "http://sensor.local/status",
            "mappers": [
                {
                    "type": "jpath",
                    "parameters": {
                        "jpath": "$.temperature"
                    }
                }
            ]
        }
    }
}
```

The `jpath` mapper extracts `temperature` from the JSON response and passes the resulting value to HomeKit as `CurrentTemperature`.

## 2. Map device values to HomeKit values

Many APIs return strings that do not match the values expected by HomeKit. Mapper chains let one mapper extract a value and the next mapper translate it.

Suppose a switch returns:

```json
{
    "power": "on"
}
```

Configuration:

```json
{
    "accessory": "HttpAdvancedAccessory",
    "service": "Switch",
    "name": "Desk Fan",
    "forceRefreshDelay": 10,
    "debug": false,
    "urls": {
        "getOn": {
            "url": "http://fan.local/status",
            "mappers": [
                {
                    "type": "jpath",
                    "parameters": {
                        "jpath": "$.power"
                    }
                },
                {
                    "type": "static",
                    "parameters": {
                        "mapping": {
                            "on": "1",
                            "off": "0"
                        }
                    }
                }
            ]
        },
        "setOn": {
            "url": "http://fan.local/power?state=${value==1?\"on\":\"off\"}"
        }
    }
}
```

For the getter, the JSONPath mapper extracts `power`, then the static mapper converts the device's `on`/`off` strings to HomeKit values. The setter demonstrates a URL template that translates the HomeKit value back into the device's command format.

## 3. Periodically refresh a sensor

A presence sensor is a good example of state that can change outside HomeKit. Setting `forceRefreshDelay` causes the plugin to poll the getter and update HomeKit when the value changes.

Suppose the sensor returns:

```json
{
    "presenceDetected": true
}
```

Configuration:

```json
{
    "accessory": "HttpAdvancedAccessory",
    "service": "OccupancySensor",
    "name": "Office Presence",
    "forceRefreshDelay": 5,
    "debug": false,
    "urls": {
        "getOccupancyDetected": {
            "url": "http://presence-sensor.local/readings",
            "mappers": [
                {
                    "type": "jpath",
                    "parameters": {
                        "jpath": "$.presenceDetected"
                    }
                },
                {
                    "type": "static",
                    "parameters": {
                        "mapping": {
                            "true": "1",
                            "false": "0"
                        }
                    }
                }
            ]
        }
    }
}
```

This pattern is also useful for contact, motion, leak, and other sensors whose state may change without a HomeKit command.

## 4. Add optional characteristics and POST requests

Some HomeKit services expose optional characteristics. Add the ones you want with `optionCharacteristic`, then define getter and setter actions for them just like mandatory characteristics.

The following example models a light with on/off state and brightness. The example API accepts raw values in POST bodies and returns both values from `/status`:

```json
{
    "on": true,
    "brightness": 65
}
```

Configuration:

```json
{
    "accessory": "HttpAdvancedAccessory",
    "service": "Lightbulb",
    "name": "Desk Light",
    "forceRefreshDelay": 10,
    "debug": false,
    "optionCharacteristic": [
        "Brightness"
    ],
    "urls": {
        "getOn": {
            "url": "http://light.local/status",
            "mappers": [
                {
                    "type": "jpath",
                    "parameters": {
                        "jpath": "$.on"
                    }
                }
            ]
        },
        "setOn": {
            "url": "http://light.local/power",
            "httpMethod": "POST",
            "body": "{value}"
        },
        "getBrightness": {
            "url": "http://light.local/status",
            "mappers": [
                {
                    "type": "jpath",
                    "parameters": {
                        "jpath": "$.brightness"
                    }
                }
            ]
        },
        "setBrightness": {
            "url": "http://light.local/brightness",
            "httpMethod": "POST",
            "body": "{value}"
        }
    }
}
```

The exact POST body format is device-specific. It can be a simple value, form data, JSON text, or another string format expected by the target HTTP endpoint.

## 5. Coordinate multiple characteristics

More complex HomeKit services often require several related characteristics. A garage door, for example, has both current and target state.

Suppose the controller returns:

```json
{
    "currentState": 1,
    "targetState": 1
}
```

Configuration:

```json
{
    "accessory": "HttpAdvancedAccessory",
    "service": "GarageDoorOpener",
    "name": "Garage Door",
    "forceRefreshDelay": 5,
    "debug": false,
    "urls": {
        "getCurrentDoorState": {
            "url": "http://garage.local/status",
            "mappers": [
                {
                    "type": "jpath",
                    "parameters": {
                        "jpath": "$.currentState"
                    }
                }
            ]
        },
        "getTargetDoorState": {
            "url": "http://garage.local/status",
            "mappers": [
                {
                    "type": "jpath",
                    "parameters": {
                        "jpath": "$.targetState"
                    }
                }
            ]
        },
        "setTargetDoorState": {
            "url": "http://garage.local/door?command=${value==0?\"open\":\"close\"}"
        }
    }
}
```

The two getters can use the same endpoint and extract different values. The setter turns the HomeKit target state into the command expected by the controller.

## 6. Chain mappers and use an inconclusive fallback

Mapper chains can normalize complex device responses. An action may also define an `inconclusive` action when the first response does not contain enough information to determine the HomeKit value.

Suppose an alarm API returns one of these values from `/status.xml`:

```xml
<status>
    <state>DISARMED</state>
</status>
```

or:

```xml
<status>
    <state>ARMED</state>
</status>
```

When the state is simply `ARMED`, a second endpoint `/mode.xml` identifies the mode as `STAY`, `AWAY`, or `NIGHT`.

Configuration:

```json
{
    "accessory": "HttpAdvancedAccessory",
    "service": "SecuritySystem",
    "name": "Alarm System",
    "forceRefreshDelay": 10,
    "debug": false,
    "urls": {
        "getSecuritySystemCurrentState": {
            "url": "http://alarm.local/status.xml",
            "mappers": [
                {
                    "type": "xpath",
                    "parameters": {
                        "xpath": "//state/text()"
                    }
                },
                {
                    "type": "static",
                    "parameters": {
                        "mapping": {
                            "DISARMED": "3",
                            "ALARM": "4",
                            "ARMED": "inconclusive"
                        }
                    }
                }
            ],
            "inconclusive": {
                "url": "http://alarm.local/mode.xml",
                "mappers": [
                    {
                        "type": "xpath",
                        "parameters": {
                            "xpath": "//mode/text()"
                        }
                    },
                    {
                        "type": "static",
                        "parameters": {
                            "mapping": {
                                "STAY": "0",
                                "AWAY": "1",
                                "NIGHT": "2"
                            }
                        }
                    }
                ]
            }
        },
        "getSecuritySystemTargetState": {
            "url": "http://alarm.local/mode.xml",
            "mappers": [
                {
                    "type": "xpath",
                    "parameters": {
                        "xpath": "//mode/text()"
                    }
                },
                {
                    "type": "static",
                    "parameters": {
                        "mapping": {
                            "STAY": "0",
                            "AWAY": "1",
                            "NIGHT": "2",
                            "DISARMED": "3"
                        }
                    }
                }
            ]
        },
        "setSecuritySystemTargetState": {
            "url": "http://alarm.local/set-mode?mode={value}",
            "mappers": [
                {
                    "type": "static",
                    "parameters": {
                        "mapping": {
                            "0": "STAY",
                            "1": "AWAY",
                            "2": "NIGHT",
                            "3": "DISARMED"
                        }
                    }
                }
            ]
        }
    }
}
```

This example demonstrates three important behaviors at once: mapper chaining, a fallback request when a result is inconclusive, and reverse mapping of HomeKit values before sending a setter request.

## Patterns from real-world configurations

Public configurations using `HttpAdvancedAccessory` show these same structures in practice: JSONPath extraction for temperature and presence sensors, multi-characteristic garage-door state, optional characteristics for controls such as brightness or volume, and chained mappings for devices whose native values differ from HomeKit values.

Those configurations are useful inspiration, but the examples above intentionally use generic endpoints and simplified response shapes so that the important part is the plugin structure rather than the quirks of a particular device.
