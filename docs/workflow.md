Architecture Components
1. Unique Device Identification

    Each ESP32 generates a unique serial number from its MAC address

    Format: GH-XXXXXXXXXXXX (e.g., GH-A1B2C3D4E5F6)

    Serial number persists across reboots (stored in LittleFS)

2. Server Registration Flow
text

ESP32 Boot → Check for token → If no token → HTTP POST /api/v1/devices/register/
                    ↓
         Server generates api_token
                    ↓
         ESP32 stores token in LittleFS
                    ↓
         Use token for all future MQTT communication

3. MQTT Communication

    Broker: External MQTT broker (HiveMQ, EMQX, Coreflux, etc.)

    Authentication: Username + Password (configured in code)

    Topics Structure:

        gh/{serial_number}/sensors → Publish sensor data

        gh/{serial_number}/cmd → Subscribe for control commands

        gh/{serial_number}/schedules → Subscribe for schedule updates

    Payload Format: All messages include "token": "<api_token>" for validation

    Keepalive: 60 seconds

4. Data Storage (LittleFS)

    Token File: /token.json - Stores api_token with serial_number

    Schedule File: /schedule.json - Stores all schedules as JSON array

    Serial File: /serial.txt - Stores unique serial number

    Strategy: All schedules in ONE file (JSON array) to minimize flash wear

5. Sensor Reading

    DHT22: Temperature & Humidity (every 30 seconds)

    LDR/Photoresistor: Light intensity (analog read)

    Capacitive Soil Sensor: Soil moisture (analog read)

    Publish Interval: Every 60 seconds to MQTT

6. Actuator Control

    Fan Set 1 & Fan Set 2: Digital output (HIGH = ON)

    Light: Digital output (HIGH = ON)

    Water Pump: Digital output (HIGH = ON)

    Control: Via MQTT commands or scheduled automation

    Fan schedules select a target: all / set1 / set2.
    The MQTT cmd payload for a fan schedule carries a "fan_target" field.

esp32-greenhouse/
├── src/
│   ├── main.cpp              # Core logic and initialization
│   ├── config.h              # Configuration (WiFi, MQTT, pins, intervals)
│   ├── credentials.h         # WiFi/MQTT credentials (DO NOT COMMIT)
│   ├── schedule_manager.h    # Schedule loading/saving/checking
│   ├── sensor_manager.h      # Sensor reading logic
│   └── actuator_manager.h    # Actuator control logic
├── lib/
│   ├── ArduinoJson           # JSON parsing library
│   ├── PubSubClient          # MQTT client
│   └── DHT sensor library    # DHT22 driver
├── data/                     # Initial LittleFS files
│   └── (optional initial files)
└── platformio.ini            # PlatformIO configuration

Detailed Implementation Instructions
PHASE 1: Setup and Configuration
1.1 Create config.h
cpp

// config.h
#ifndef CONFIG_H
#define CONFIG_H

// ===== WiFi Configuration =====
#define WIFI_SSID "your_wifi_ssid"        // Your WiFi network name
#define WIFI_PASSWORD "your_wifi_password" // Your WiFi password

// ===== Server Configuration =====
#define API_BASE_URL "https://your-backend.onrender.com"  // Backend API URL
#define API_REGISTER_ENDPOINT "/api/v1/devices/register/" // Registration endpoint
#define API_GREENHOUSE_ENDPOINT "/api/v1/greenhouses/"   // Greenhouse info endpoint

// ===== MQTT Configuration =====
#define MQTT_BROKER "broker.emqx.io"      // MQTT broker address
#define MQTT_PORT 1883                    // MQTT port (1883 for non-TLS)
#define MQTT_USERNAME "your_mqtt_username" // MQTT broker username
#define MQTT_PASSWORD "your_mqtt_password" // MQTT broker password
#define MQTT_KEEPALIVE 60                 // Keepalive in seconds

// ===== Sensor & Actuator Pins =====
#define DHT_PIN 4           // DHT22 data pin
#define LIGHT_SENSOR_PIN 34 // LDR/Photoresistor analog pin
#define SOIL_SENSOR_PIN 35  // Capacitive soil sensor analog pin
#define FAN_PIN 13          // Fan relay control pin
#define LIGHT_PIN 12        // Light relay control pin
#define WATER_PUMP_PIN 14   // Water pump relay control pin

// ===== System Constants =====
#define SENSOR_READ_INTERVAL 30000   // Read sensors every 30 seconds
#define MQTT_PUBLISH_INTERVAL 60000  // Publish to MQTT every 60 seconds
#define SCHEDULE_CHECK_INTERVAL 10000 // Check schedules every 10 seconds
#define MQTT_RECONNECT_DELAY 5000    // Delay between MQTT reconnect attempts

// ===== File Paths =====
#define TOKEN_FILE "/token.json"      // Token storage file
#define SCHEDULE_FILE "/schedule.json" // Schedule storage file
#define SERIAL_FILE "/serial.txt"     // Serial number file

// ===== Buffer Sizes =====
#define JSON_BUFFER_SIZE 2048         // JSON document buffer size
#define MQTT_MAX_PACKET_SIZE 2048     // MQTT max packet size

#endif

 Create credentials.h (Add to .gitignore)
cpp

// credentials.h - DO NOT COMMIT TO GIT!
#ifndef CREDENTIALS_H
#define CREDENTIALS_H

#define WIFI_SSID "your_actual_wifi_ssid"
#define WIFI_PASSWORD "your_actual_wifi_password"
#define MQTT_USERNAME "your_actual_mqtt_username"
#define MQTT_PASSWORD "your_actual_mqtt_password"

#endif

PHASE 2: Schedule Management
2.1 Create schedule_manager.h
cpp

// schedule_manager.h
#ifndef SCHEDULE_MANAGER_H
#define SCHEDULE_MANAGER_H

#include <Arduino.h>
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <vector>

// Schedule structure - matches backend model
struct Schedule {
    String id;              // Unique schedule ID
    int hour;               // Hour (0-23)
    int minute;             // Minute (0-59)
    bool fanOn;            // Fan state for this schedule
    bool lightOn;          // Light state for this schedule
    bool waterPumpOn;      // Water pump state for this schedule
    int repeatDays[7];     // Array of 7: 1=active, 0=inactive (0=Sunday)
    bool isActive;         // Whether schedule is currently active
    
    Schedule() : hour(0), minute(0), fanOn(false), lightOn(false), 
                 waterPumpOn(false), isActive(false) {
        memset(repeatDays, 0, sizeof(repeatDays));
    }
};

class ScheduleManager {
private:
    std::vector<Schedule> schedules;  // In-memory schedule cache
    String filePath;                  // Path to schedule file
    
public:
    ScheduleManager() : filePath(SCHEDULE_FILE) {}
    
    // Load schedules from LittleFS file
    bool loadFromFile(String path = SCHEDULE_FILE) {
        filePath = path;
        schedules.clear();
        
        File file = LittleFS.open(path, "r");
        if (!file) {
            Serial.println("⚠️ No schedule file found - starting fresh");
            return false;
        }
        
        DynamicJsonDocument doc(4096);
        DeserializationError error = deserializeJson(doc, file);
        file.close();
        
        if (error) {
            Serial.println("❌ Failed to parse schedule file - corrupt?");
            return false;
        }
        
        JsonArray arr = doc.as<JsonArray>();
        for (JsonObject obj : arr) {
            Schedule s;
            s.id = obj["id"] | "";
            s.hour = obj["hour"] | 0;
            s.minute = obj["minute"] | 0;
            s.fanOn = obj["fanOn"] | false;
            s.lightOn = obj["lightOn"] | false;
            s.waterPumpOn = obj["waterPumpOn"] | false;
            s.isActive = true;
            
            // Parse repeat days
            JsonArray days = obj["repeatDays"].as<JsonArray>();
            for (int i = 0; i < 7 && i < days.size(); i++) {
                s.repeatDays[i] = days[i] | 0;
            }
            
            schedules.push_back(s);
        }
        
        Serial.printf("✅ Loaded %d schedules from file\n", schedules.size());
        return true;
    }
    
    // Save schedules to file (receives JSON from MQTT)
    bool saveToFile(String path, String jsonData) {
        File file = LittleFS.open(path, "w");
        if (!file) {
            Serial.println("❌ Failed to open schedule file for writing");
            return false;
        }
        
        size_t bytesWritten = file.print(jsonData);
        file.close();
        
        if (bytesWritten > 0) {
            Serial.printf("✅ Schedule saved (%d bytes)\n", bytesWritten);
            return true;
        } else {
            Serial.println("❌ Failed to write schedule");
            return false;
        }
    }
    
    // Get schedule that matches current time
    Schedule getCurrentSchedule(int dayOfWeek, int hour, int minute, int second) {
        Schedule defaultSchedule;
        defaultSchedule.isActive = false;
        
        // Iterate through schedules
        for (Schedule& s : schedules) {
            if (!s.isActive) continue;
            
            // Check if schedule runs on this day
            if (s.repeatDays[dayOfWeek] != 1) continue;
            
            // Calculate time in seconds from midnight
            int scheduleTime = s.hour * 3600 + s.minute * 60;
            int currentTime = hour * 3600 + minute * 60 + second;
            
            // Check if within 30-second window
            if (abs(currentTime - scheduleTime) < 30) {
                // Check if this schedule has already been applied today
                // (Optional: Track last applied time to prevent multiple triggers)
                return s;
            }
        }
        
        return defaultSchedule;
    }
    
    // Print all schedules (for debugging)
    void printSchedules() {
        Serial.printf("📅 Active Schedules (%d):\n", schedules.size());
        for (Schedule& s : schedules) {
            Serial.printf("  %02d:%02d - Fan:%s Light:%s Pump:%s Days:",
                         s.hour, s.minute,
                         s.fanOn ? "ON" : "OFF",
                         s.lightOn ? "ON" : "OFF",
                         s.waterPumpOn ? "ON" : "OFF");
            for (int i = 0; i < 7; i++) {
                if (s.repeatDays[i]) Serial.printf(" %d", i);
            }
            Serial.println();
        }
    }
};

#endif

PHASE 3: Sensor Management
3.1 Create sensor_manager.h
cpp

// sensor_manager.h
#ifndef SENSOR_MANAGER_H
#define SENSOR_MANAGER_H

#include <Arduino.h>
#include <DHT.h>

// Sensor data structure
struct SensorData {
    float temperature;      // Temperature in Celsius
    float humidity;        // Relative humidity in %
    float lightIntensity;  // Light intensity (0-4095 analog value)
    float soilMoisture;    // Soil moisture (0-4095 analog value)
    unsigned long timestamp; // Unix timestamp when read
    
    SensorData() : temperature(0), humidity(0), lightIntensity(0), 
                   soilMoisture(0), timestamp(0) {}
};

class SensorManager {
private:
    DHT dht;
    int lightPin;
    int soilPin;
    SensorData lastReading;
    bool hasValidReading;
    
public:
    SensorManager(int dhtPin = DHT_PIN, int lightPin = LIGHT_SENSOR_PIN, 
                  int soilPin = SOIL_SENSOR_PIN) 
        : dht(dhtPin, DHT22), lightPin(lightPin), soilPin(soilPin) {
        hasValidReading = false;
    }
    
    // Initialize sensor pins
    void begin() {
        dht.begin();
        pinMode(lightPin, INPUT);
        pinMode(soilPin, INPUT);
        Serial.println("🌡️ Sensors initialized");
    }
    
    // Read all sensors and update lastReading
    SensorData readAllSensors() {
        SensorData data;
        
        // Read DHT22
        data.temperature = dht.readTemperature();
        data.humidity = dht.readHumidity();
        
        // Read analog sensors (0-4095 on ESP32)
        data.lightIntensity = analogRead(lightPin);
        data.soilMoisture = analogRead(soilPin);
        data.timestamp = millis() / 1000; // Approximate timestamp
        
        // Validate DHT readings
        if (isnan(data.temperature) || isnan(data.humidity)) {
            Serial.println("⚠️ Failed to read DHT sensor, using previous values");
            data.temperature = lastReading.temperature;
            data.humidity = lastReading.humidity;
        }
        
        lastReading = data;
        hasValidReading = true;
        return data;
    }
    
    // Get last reading without re-reading sensors
    SensorData getLastReading() {
        if (!hasValidReading) {
            // Return empty if no reading yet
            return SensorData();
        }
        return lastReading;
    }
    
    // Get temperature reading
    float getTemperature() {
        if (hasValidReading) {
            return lastReading.temperature;
        }
        return 0.0;
    }
    
    // Get humidity reading
    float getHumidity() {
        if (hasValidReading) {
            return lastReading.humidity;
        }
        return 0.0;
    }
};

#endif

PHASE 4: Actuator Management
4.1 Create actuator_manager.h
cpp

// actuator_manager.h
#ifndef ACTUATOR_MANAGER_H
#define ACTUATOR_MANAGER_H

#include <Arduino.h>

class ActuatorManager {
private:
    int fanPin;
    int lightPin;
    int waterPumpPin;
    
    bool fanState;
    bool lightState;
    bool waterPumpState;
    
public:
    ActuatorManager(int fanPin = FAN_PIN, int lightPin = LIGHT_PIN, 
                    int waterPumpPin = WATER_PUMP_PIN)
        : fanPin(fanPin), lightPin(lightPin), waterPumpPin(waterPumpPin),
          fanState(false), lightState(false), waterPumpState(false) {}
    
    // Initialize actuator pins (all off initially)
    void begin() {
        pinMode(fanPin, OUTPUT);
        pinMode(lightPin, OUTPUT);
        pinMode(waterPumpPin, OUTPUT);
        
        // Start with everything off
        digitalWrite(fanPin, LOW);
        digitalWrite(lightPin, LOW);
        digitalWrite(waterPumpPin, LOW);
        
        Serial.println("🔌 Actuators initialized (all OFF)");
    }
    
    // Control fan (true = ON, false = OFF)
    void controlFan(bool on) {
        fanState = on;
        digitalWrite(fanPin, on ? HIGH : LOW);
        Serial.printf("💨 Fan: %s\n", on ? "ON" : "OFF");
    }
    
    // Control light (true = ON, false = OFF)
    void controlLight(bool on) {
        lightState = on;
        digitalWrite(lightPin, on ? HIGH : LOW);
        Serial.printf("💡 Light: %s\n", on ? "ON" : "OFF");
    }
    
    // Control water pump (true = ON, false = OFF)
    void controlWaterPump(bool on) {
        waterPumpState = on;
        digitalWrite(waterPumpPin, on ? HIGH : LOW);
        Serial.printf("💧 Water Pump: %s\n", on ? "ON" : "OFF");
    }
    
    // Turn all actuators on/off
    void controlAll(bool on) {
        controlFan(on);
        controlLight(on);
        controlWaterPump(on);
    }
    
    // Getters
    bool getFanState() { return fanState; }
    bool getLightState() { return lightState; }
    bool getWaterPumpState() { return waterPumpState; }
};

#endif

PHASE 5: Main Application Logic
5.1 Create main.cpp
cpp

// main.cpp
#include "config.h"
#include "schedule_manager.h"
#include "sensor_manager.h"
#include "actuator_manager.h"

#include <WiFi.h>
#include <LittleFS.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <time.h>

// ===== Global Objects =====
WiFiClient espClient;
PubSubClient mqttClient(espClient);
ScheduleManager scheduleManager;
SensorManager sensorManager;
ActuatorManager actuatorManager;

// ===== Global Variables =====
String serialNumber;
String apiToken;
unsigned long lastSensorRead = 0;
unsigned long lastMqttPublish = 0;
unsigned long lastScheduleCheck = 0;
bool timeSynced = false;

// ===== Function Prototypes =====
void setupWiFi();
void setupMQTT();
void mqttCallback(char* topic, byte* payload, unsigned int length);
void reconnectMQTT();
void publishSensorData();
void checkSchedules();
void processControlCommand(String command, String value);
void processSchedule(String scheduleJson);
String getOrGenerateSerialNumber();
bool loadTokenFromFile();
void saveTokenToFile(String token);
String registerDevice(String serial);
void getGreenhouseData(String token);

// ===== Setup =====
void setup() {
    Serial.begin(115200);
    Serial.println("\n🌿 Greenhouse Controller Starting...");
    Serial.println("========================================");
    
    // 1. Initialize LittleFS
    if (!LittleFS.begin(true)) {
        Serial.println("❌ LittleFS Mount Failed!");
        return;
    }
    Serial.println("✅ LittleFS Mounted");
    
    // 2. Get or Generate Serial Number
    serialNumber = getOrGenerateSerialNumber();
    Serial.printf("🔑 Serial Number: %s\n", serialNumber.c_str());
    
    // 3. Connect to WiFi
    setupWiFi();
    
    // 4. Get or Load API Token
    if (!loadTokenFromFile()) {
        Serial.println("🔄 No token found. Registering with server...");
        apiToken = registerDevice(serialNumber);
        if (apiToken.length() > 0) {
            saveTokenToFile(apiToken);
            Serial.println("✅ Token saved successfully");
        } else {
            Serial.println("❌ Failed to get token!");
            return;
        }
    } else {
        Serial.printf("✅ Token loaded: %s\n", apiToken.c_str());
    }
    
    // 5. Setup MQTT
    setupMQTT();
    
    // 6. Get Greenhouse Data
    getGreenhouseData(apiToken);
    
    // 7. Initialize Sensors and Actuators
    sensorManager.begin();
    actuatorManager.begin();
    
    // 8. Subscribe to MQTT Topics
    String cmdTopic = "gh/" + serialNumber + "/cmd";
    String scheduleTopic = "gh/" + serialNumber + "/schedules";
    mqttClient.subscribe(cmdTopic.c_str());
    mqttClient.subscribe(scheduleTopic.c_str());
    Serial.printf("✅ Subscribed to: %s, %s\n", cmdTopic.c_str(), scheduleTopic.c_str());
    
    // 9. Load Schedules from File
    scheduleManager.loadFromFile(SCHEDULE_FILE);
    scheduleManager.printSchedules();
    
    // 10. Setup NTP for time-based schedules
    configTime(0, 0, "pool.ntp.org", "time.nist.gov");
    Serial.println("⏰ NTP Time Sync Started");
    
    Serial.println("========================================");
    Serial.println("✅ System Ready!");
    Serial.println("========================================");
}

// ===== Main Loop =====
void loop() {
    // Maintain MQTT connection
    if (!mqttClient.connected()) {
        reconnectMQTT();
    }
    mqttClient.loop();
    
    unsigned long currentMillis = millis();
    
    // Read sensors and publish data
    if (currentMillis - lastSensorRead >= SENSOR_READ_INTERVAL) {
        lastSensorRead = currentMillis;
        sensorManager.readAllSensors();
        publishSensorData();
    }
    
    // Check schedules
    if (currentMillis - lastScheduleCheck >= SCHEDULE_CHECK_INTERVAL) {
        lastScheduleCheck = currentMillis;
        checkSchedules();
    }
    
    // Small delay to prevent watchdog issues
    delay(10);
}

// ===== WiFi Setup =====
void setupWiFi() {
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    Serial.print("📶 Connecting to WiFi");
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 30) {
        delay(500);
        Serial.print(".");
        attempts++;
    }
    
    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("✅ Connected!");
        Serial.printf("🌐 IP Address: %s\n", WiFi.localIP().toString().c_str());
        Serial.printf("📶 Signal Strength: %d dBm\n", WiFi.RSSI());
    } else {
        Serial.println("❌ WiFi Connection Failed! Rebooting in 5 seconds...");
        delay(5000);
        ESP.restart();
    }
}

// ===== MQTT Setup =====
void setupMQTT() {
    mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
    mqttClient.setCallback(mqttCallback);
    mqttClient.setKeepAlive(MQTT_KEEPALIVE);
    mqttClient.setBufferSize(MQTT_MAX_PACKET_SIZE);
    reconnectMQTT();
}

// ===== MQTT Reconnect =====
void reconnectMQTT() {
    while (!mqttClient.connected()) {
        Serial.print("📡 Connecting to MQTT...");
        String clientId = "ESP32_" + serialNumber;
        
        if (mqttClient.connect(clientId.c_str(), MQTT_USERNAME, MQTT_PASSWORD)) {
            Serial.println("✅ Connected!");
            
            // Resubscribe to topics
            String cmdTopic = "gh/" + serialNumber + "/cmd";
            String scheduleTopic = "gh/" + serialNumber + "/schedules";
            mqttClient.subscribe(cmdTopic.c_str());
            mqttClient.subscribe(scheduleTopic.c_str());
            Serial.printf("📨 Resubscribed to: %s, %s\n", cmdTopic.c_str(), scheduleTopic.c_str());
        } else {
            Serial.printf("❌ Failed, rc=%d\n", mqttClient.state());
            Serial.printf("Retrying in %d seconds...\n", MQTT_RECONNECT_DELAY / 1000);
            delay(MQTT_RECONNECT_DELAY);
        }
    }
}

// ===== MQTT Callback =====
void mqttCallback(char* topic, byte* payload, unsigned int length) {
    String topicStr = String(topic);
    String message = String((char*)payload).substring(0, length);
    
    Serial.printf("\n📨 MQTT Message - Topic: %s\n", topic);
    Serial.printf("   Payload: %s\n", message.c_str());
    
    // Extract serial number from topic
    int firstSlash = topicStr.indexOf('/');
    int secondSlash = topicStr.indexOf('/', firstSlash + 1);
    String msgSerial = topicStr.substring(firstSlash + 1, secondSlash);
    
    if (msgSerial != serialNumber) {
        Serial.println("⚠️ Message for another greenhouse, ignoring");
        return;
    }
    
    // Parse JSON
    DynamicJsonDocument doc(JSON_BUFFER_SIZE);
    DeserializationError error = deserializeJson(doc, message);
    
    if (error) {
        Serial.println("❌ JSON Parse Error!");
        return;
    }
    
    // Validate token
    String msgToken = doc["token"] | "";
    if (msgToken != apiToken) {
        Serial.println("❌ Invalid token, rejecting message");
        return;
    }
    
    // Process by topic type
    if (topicStr.endsWith("/cmd")) {
        String command = doc["command"] | "";
        String value = doc["value"] | "";
        processControlCommand(command, value);
    } 
    else if (topicStr.endsWith("/schedules")) {
        String scheduleData;
        serializeJson(doc, scheduleData);
        processSchedule(scheduleData);
    }
}

// ===== Process Control Command =====
void processControlCommand(String command, String value) {
    Serial.printf("🎮 Control Command: %s = %s\n", command.c_str(), value.c_str());
    
    if (command == "FAN") {
        actuatorManager.controlFan(value == "ON");
    } 
    else if (command == "LIGHT") {
        actuatorManager.controlLight(value == "ON");
    } 
    else if (command == "WATER_PUMP") {
        actuatorManager.controlWaterPump(value == "ON");
    } 
    else if (command == "ALL") {
        if (value == "ON") {
            actuatorManager.controlAll(true);
        } else if (value == "OFF") {
            actuatorManager.controlAll(false);
        }
    } else {
        Serial.println("⚠️ Unknown command: " + command);
    }
}

// ===== Process Schedule Update =====
void processSchedule(String scheduleJson) {
    Serial.println("📅 Processing new schedule...");
    
    // Save to file
    if (scheduleManager.saveToFile(SCHEDULE_FILE, scheduleJson)) {
        // Reload schedules from file
        scheduleManager.loadFromFile(SCHEDULE_FILE);
        scheduleManager.printSchedules();
    } else {
        Serial.println("❌ Failed to save schedule!");
    }
}

// ===== Publish Sensor Data =====
void publishSensorData() {
    if (!mqttClient.connected()) {
        Serial.println("⚠️ MQTT not connected, skipping publish");
        return;
    }
    
    // Get sensor data
    SensorData data = sensorManager.getLastReading();
    
    // Create JSON payload
    DynamicJsonDocument doc(JSON_BUFFER_SIZE);
    doc["token"] = apiToken;
    doc["temperature"] = data.temperature;
    doc["humidity"] = data.humidity;
    doc["light"] = data.lightIntensity;
    doc["soil_moisture"] = data.soilMoisture;
    doc["timestamp"] = time(nullptr);
    
    // Serialize and publish
    String payload;
    serializeJson(doc, payload);
    
    String topic = "gh/" + serialNumber + "/sensors";
    if (mqttClient.publish(topic.c_str(), payload.c_str())) {
        Serial.printf("📤 Published sensor data: T=%.1f°C, H=%.1f%%, L=%.0f, S=%.0f\n", 
                     data.temperature, data.humidity, 
                     data.lightIntensity, data.soilMoisture);
    } else {
        Serial.println("❌ Failed to publish sensor data");
    }
}

// ===== Check Schedules =====
void checkSchedules() {
    // Check if time is synced
    if (!timeSynced) {
        time_t now = time(nullptr);
        if (now > 100000) {  // Time is valid if > 1970-01-01
            timeSynced = true;
            Serial.println("⏰ Time synced successfully");
        } else {
            return;  // Wait for time sync
        }
    }
    
    time_t now = time(nullptr);
    struct tm* timeinfo = localtime(&now);
    
    if (timeinfo == nullptr) {
        return;
    }
    
    int currentHour = timeinfo->tm_hour;
    int currentMinute = timeinfo->tm_min;
    int currentSecond = timeinfo->tm_sec;
    int currentDayOfWeek = timeinfo->tm_wday;  // 0=Sunday, 6=Saturday
    
    // Check schedules
    Schedule activeSchedule = scheduleManager.getCurrentSchedule(
        currentDayOfWeek, currentHour, currentMinute, currentSecond
    );
    
    if (activeSchedule.isActive) {
        // Apply schedule actions
        actuatorManager.controlFan(activeSchedule.fanOn);
        actuatorManager.controlLight(activeSchedule.lightOn);
        actuatorManager.controlWaterPump(activeSchedule.waterPumpOn);
        
        Serial.printf("⏰ Applied schedule: %02d:%02d - Fan:%s Light:%s Pump:%s\n",
                     currentHour, currentMinute,
                     activeSchedule.fanOn ? "ON" : "OFF",
                     activeSchedule.lightOn ? "ON" : "OFF",
                     activeSchedule.waterPumpOn ? "ON" : "OFF");
    }
}

// ===== Serial Number Management =====
String getOrGenerateSerialNumber() {
    // Check if serial exists in LittleFS
    File file = LittleFS.open(SERIAL_FILE, "r");
    if (file) {
        String serial = file.readString();
        serial.trim();
        file.close();
        Serial.println("📋 Serial number loaded from file");
        return serial;
    }
    
    // Generate from MAC address
    uint64_t mac = ESP.getEfuseMac();
    String serial = "GH-" + String((uint32_t)(mac >> 32), HEX) + String((uint32_t)mac, HEX);
    serial.toUpperCase();
    
    // Save for next boot
    file = LittleFS.open(SERIAL_FILE, "w");
    if (file) {
        file.println(serial);
        file.close();
        Serial.println("💾 Serial number generated and saved");
    }
    return serial;
}

// ===== Token Management =====
bool loadTokenFromFile() {
    File file = LittleFS.open(TOKEN_FILE, "r");
    if (!file) {
        return false;
    }
    
    DynamicJsonDocument doc(512);
    DeserializationError error = deserializeJson(doc, file);
    file.close();
    
    if (error) {
        Serial.println("❌ Failed to parse token file");
        return false;
    }
    
    apiToken = doc["token"] | "";
    return apiToken.length() > 0;
}

void saveTokenToFile(String token) {
    DynamicJsonDocument doc(512);
    doc["token"] = token;
    doc["serial_number"] = serialNumber;
    doc["saved_at"] = time(nullptr);
    
    File file = LittleFS.open(TOKEN_FILE, "w");
    if (file) {
        serializeJson(doc, file);
        file.close();
        Serial.println("✅ Token saved to file");
    } else {
        Serial.println("❌ Failed to save token");
    }
}

// ===== Device Registration =====
String registerDevice(String serial) {
    String url = String(API_BASE_URL) + API_REGISTER_ENDPOINT;
    
    DynamicJsonDocument doc(512);
    doc["serial_number"] = serial;
    
    String jsonPayload;
    serializeJson(doc, jsonPayload);
    
    HTTPClient http;
    http.begin(url);
    http.addHeader("Content-Type", "application/json");
    
    Serial.printf("📡 Registering device at: %s\n", url.c_str());
    int httpCode = http.POST(jsonPayload);
    String response = http.getString();
    http.end();
    
    if (httpCode == 200 || httpCode == 201) {
        DynamicJsonDocument respDoc(1024);
        deserializeJson(respDoc, response);
        String token = respDoc["api_token"] | "";
        if (token.length() > 0) {
            Serial.println("✅ Device registered successfully");
            return token;
        }
    }
    
    Serial.printf("❌ Registration failed: HTTP %d\n", httpCode);
    return "";
}

// ===== Get Greenhouse Data =====
void getGreenhouseData(String token) {
    String url = String(API_BASE_URL) + API_GREENHOUSE_ENDPOINT;
    
    HTTPClient http;
    http.begin(url);
    http.addHeader("Authorization", "Bearer " + token);
    
    int httpCode = http.GET();
    if (httpCode == 200) {
        String response = http.getString();
        Serial.println("📋 Greenhouse data received");
        
        DynamicJsonDocument doc(1024);
        deserializeJson(doc, response);
        
        String name = doc["name"] | "Unknown";
        String status = doc["status"] | "Unknown";
        Serial.printf("🏠 Greenhouse: %s (Status: %s)\n", name.c_str(), status.c_str());
    } else {
        Serial.printf("❌ Failed to get greenhouse data: HTTP %d\n", httpCode);
    }
    http.end();
}

PHASE 6: PlatformIO Configuration
6.1 Create platformio.ini
ini

[env:esp32dev]
platform = espressif32
board = esp32dev
framework = arduino
monitor_speed = 115200
monitor_filters = esp32_exception_decoder

lib_deps =
    bblanchon/ArduinoJson@^6.19.4
    knolleary/PubSubClient@^2.8
    adafruit/DHT sensor library@^1.4.4
    adafruit/Adafruit Unified Sensor@^1.1.6

build_flags =
    -DCORE_DEBUG_LEVEL=1
    -DBOARD_HAS_PSRAM

board_build.partitions = default_16MB.csv
board_build.filesystem = littlefs

; Upload configuration
upload_speed = 921600
upload_port = /dev/ttyUSB0
monitor_port = /dev/ttyUSB0

6.2 Create .gitignore
gitignore

# PlatformIO
.pio/
.vscode/.browse.c_cpp.db*
.vscode/c_cpp_properties.json
.vscode/launch.json
.vscode/ipch/

# Credentials
credentials.h

# Compiled files
*.o
*.d
*.elf
*.bin

# IDE
.idea/
*.swp
*.swo

# Backup files
~*

┌─────────────────────────────────────────────────────────────────┐
│                         ESP32 BOOT                              │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
                ┌──────────────────────────┐
                │  Check for Serial Number  │
                │  (LittleFS: /serial.txt)  │
                └──────────────────────────┘
                               │
                        ┌──────┴──────┐
                        │             │
                        ▼             ▼
              ┌─────────────┐  ┌─────────────┐
              │  Generate   │  │   Load      │
              │  New SN     │  │   Existing  │
              │  (MAC)      │  │   SN        │
              └─────────────┘  └─────────────┘
                        │             │
                        └──────┬──────┘
                               │
                               ▼
                ┌──────────────────────────┐
                │  Connect to WiFi          │
                └──────────────────────────┘
                               │
                               ▼
                ┌──────────────────────────┐
                │  Check for API Token      │
                │  (LittleFS: /token.json)  │
                └──────────────────────────┘
                               │
                        ┌──────┴──────┐
                        │             │
                        ▼             ▼
              ┌─────────────┐  ┌─────────────┐
              │  HTTP POST  │  │   Load      │
              │  Register   │  │   Existing  │
              │  Device     │  │   Token     │
              └─────────────┘  └─────────────┘
                        │             │
                        └──────┬──────┘
                               │
                               ▼
                ┌──────────────────────────┐
                │  Connect to MQTT Broker   │
                │  (Username + Password)    │
                └──────────────────────────┘
                               │
                               ▼
                ┌──────────────────────────┐
                │  Subscribe to Topics      │
                │  gh/{SN}/cmd              │
                │  gh/{SN}/schedules        │
                └──────────────────────────┘
                               │
                               ▼
                ┌──────────────────────────┐
                │  Initialize Sensors       │
                │  Initialize Actuators     │
                └──────────────────────────┘
                               │
                               ▼
                ┌──────────────────────────┐
                │  Load Schedules from      │
                │  LittleFS                 │
                └──────────────────────────┘
                               │
                               ▼
                ┌──────────────────────────┐
                │  Sync NTP Time            │
                └──────────────────────────┘
                               │
                               ▼
              ┌────────────────────────────────┐
              │     SYSTEM READY               │
              └────────────────────────────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         │                     │                     │
         ▼                     ▼                     ▼
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│  SENSOR LOOP    │   │  SCHEDULE LOOP  │   │  MQTT LOOP      │
│  (Every 30s)    │   │  (Every 10s)    │   │  (Continuous)   │
│                 │   │                 │   │                 │
│ Read DHT22      │   │ Check current   │   │ Handle incoming │
│ Read Light      │   │ time against    │   │ messages:       │
│ Read Soil       │   │ schedules       │   │ - /cmd commands │
│ Publish to MQTT │   │ Apply if match  │   │ - /schedules    │
└─────────────────┘   └─────────────────┘   └─────────────────┘

api address and details are in the api.md