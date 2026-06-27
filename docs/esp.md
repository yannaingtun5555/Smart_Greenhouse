## esp32 code instruction for smart gh---
1. esp32 boot and look for a token file
    if token file -> open that file and get the token inside
    if not token file -> make an http request to server api /api/v1/greenhouses/(the server address is configured in code) with the serial number of the esp 
    and get the token and save it to token file for further usage.

2. esp subcribe the mqtt broker that the address is hardcoded in the code
   open a schedule file and get the schedules from the broker and set them in the file.
   send sensor data to the broker to the related topic every x time (4 or 10)
   if a control enter with esp's token take action to the control

3. look the schedule file and if schedule must action ->take the action

4. if server and broker cant access take the default action to all components

## Components
-- sensors:
    temp & humni sensor x2
    soil sensor
    light intensity sensor

-- components:
    2 fan sets(each set -> 2 fans for air intake and outlet)
    water pump
    led lights

## Note
each mqtt publishes contain esp's unique token
esp must check the token before recevie the schedule,controls 
esp musr send the sensors with own token 

