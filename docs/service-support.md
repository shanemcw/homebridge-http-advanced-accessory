# Historical service inventory

Generated against installed Homebridge 1.11.4 and 2.4.0. Unavailable historical services are not silently substituted. They also cannot be constructed by the old plugin on the same runtime. Service availability alone does not prove full support for complex services such as camera streaming.

| Legacy service | Homebridge 1.11.4 | Homebridge 2.4.0 |
|---|---|---|
| AccessoryInformation | Available | Available |
| AirQualitySensor | Available | Available |
| BatteryService | Alias: Battery | Alias: Battery |
| BridgeConfiguration | Available | Unavailable in this HAP runtime |
| BridgingState | Available | Unavailable in this HAP runtime |
| CameraControl | Available | Unavailable in this HAP runtime |
| CameraRTPStreamManagement | Available | Available |
| CarbonDioxideSensor | Available | Available |
| CarbonMonoxideSensor | Available | Available |
| ContactSensor | Available | Available |
| Door | Available | Available |
| Doorbell | Available | Available |
| Fan | Available | Available |
| GarageDoorOpener | Available | Available |
| HumiditySensor | Available | Available |
| LeakSensor | Available | Available |
| LightSensor | Available | Available |
| Lightbulb | Available | Available |
| LockManagement | Available | Available |
| LockMechanism | Available | Available |
| Microphone | Available | Available |
| MotionSensor | Available | Available |
| OccupancySensor | Available | Available |
| Outlet | Available | Available |
| Pairing | Available | Available |
| ProtocolInformation | Available | Available |
| Relay | Available | Unavailable in this HAP runtime |
| SecuritySystem | Available | Available |
| SmokeSensor | Available | Available |
| Speaker | Available | Available |
| StatefulProgrammableSwitch | Available | Available |
| StatelessProgrammableSwitch | Available | Available |
| Switch | Available | Available |
| TemperatureSensor | Available | Available |
| Thermostat | Available | Available |
| TimeInformation | Available | Unavailable in this HAP runtime |
| TunneledBTLEAccessoryService | Available | Unavailable in this HAP runtime |
| Window | Available | Available |
| WindowCovering | Available | Available |

BatteryService is explicitly mapped to Battery with the same HAP UUID. The dormant legacy extension file was not imported by the original entry point; FanIR/TVIR were not an exposed working plugin feature.
