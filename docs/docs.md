Full Feature List

   1.  Temperature Regulation – Fans + vents auto

   2.  Light Control (optional) – Shades adjust                   ----optional  X

   3.  Soil Moisture Sensing – Triggers watering

   4.  Smart Watering – Weather‑aware + dry‑run protection         

   5.  Rainwater Recovery – Passive collection (non‑IoT)          ----optional

   6.  Water Empty Alert – Float switch + admin notification      ----optional

   7.  Solar Power – Panel + battery + charge controller

   8.  Admin Dashboard – Live data, controls, alerts, battery status

Components:

1. ESP32 (main controller)
   https://www.cestore-mm.com/product/esp32-development-board-type-c/

2. DHT11                                                                                            -----fixed                                                       
   https://www.cestore-mm.com/product/dht11-temperature-and-humidity-sensor/

3. DC Exhaust Fans (12V)
   https://www.cestore-mm.com/product/brushless-dc-fan/
   
4. Relay Module 2 channel (or MOSFET module) – to control fans + to control water pump
   https://www.cestore-mm.com/product/2-channel-relay-module-5v10a/
      
5. Servo Motor – for opening vents automatically
   https://www.cestore-mm.com/product/mg90s-micro-servo-motor/

6. Power supply (12V/5V regulators)
   
7. LDR sensor (light intensity)
   https://www.cestore-mm.com/product/light-sensor-module/

8. Servo motor / DC motor + driver (L298N)  ---for shade mechanism

9. Soil moisture sensor
   https://www.cestore-mm.com/product/soil-moisture-sensor-module/

10. Shade cover

11. Submersible Water Pump (12V)
    https://www.cestore-mm.com/product/mini-water-pump-5v-black/
 
12. Tubing + drip irrigation kit

13. Water Level Float Switch Sensor (Small) --optional

14. Storage tank

15. Solar panel

16. 12volts batteries = 3.7v li ion x3
    
17. DC-DC Buck Converter (12V → 5V for ESP32)
    https://www.cestore-mm.com/product/xl4016-step-down-converter-module-440vin-300w-10a/
    
18. 3s bms for battery
    https://www.cestore-mm.com/product/hx-3s-03-bms-lithium-battery-charger-protection-board-8a/
19. Charge controller 

20. Greenhouse body:
      Wooden sticks
      Clear plastic sheet / food wrap / acrylic sheet
      Base
      
Design:
1. Water system design
   Water Tank → Pump → Tube → Soil
   
2. Airflow design
   
3. Solar+power design
   	Solar Panel
   	   ↓
	Charge Controller
 	   ↓
	3S Battery + BMS
	   ↓
	Fuse
 	   ↓
	12V Line → Pump + Fan
  	   ↓
	XL4016 → 5V → ESP32  →  other sensors
