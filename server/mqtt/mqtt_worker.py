#!/usr/bin/env python3
"""
Smart Greenhouse – MQTT Worker
================================
Responsibilities:
  1. Subscribe to all ESP32 sensor data and device state updates → store in PostgreSQL
  2. Validate every ESP32 message by its api_token
  3. Evaluate sensor-based schedule rules on every sensor reading
  4. Time-based schedule dispatcher (runs in a background thread every minute)
  5. Push control commands to ESP32 when schedules fire

MQTT Topic Map
--------------
  SUBSCRIBE:
    gh/+/sensors   – ESP32 sensor data
    gh/+/state     – ESP32 device state report

  PUBLISH:
    gh/{serial}/cmd       – control command to ESP32
    gh/{serial}/schedules – full schedule list pushed to ESP32

Payload – gh/{serial}/sensors (from ESP32):
  {
    "token": "<api_token>",
    "temperature": 28.5,
    "humidity": 65.2,
    "soil_moisture": 42.1,     (optional)
    "light_intensity": 800.0,  (optional)
    "battery": 3.7             (optional)
  }

Payload – gh/{serial}/state (from ESP32):
  {
    "token": "<api_token>",
    "fan": true,
    "water_pump": false,
    "light": false,
    "energy_state": "battery"  (optional)
  }

Payload – gh/{serial}/cmd (published by this worker):
  {"device": "fan", "action": "on"}
"""

import json
import logging
import operator as op
import os
import threading
import time
from datetime import datetime, timezone

import paho.mqtt.client as mqtt
import psycopg2
import psycopg2.pool
from psycopg2.extras import RealDictCursor

# ---------------------------------------------------------------------------
# Configuration from environment
# ---------------------------------------------------------------------------
DB_NAME     = os.environ['DB_NAME']
DB_USER     = os.environ['DB_USER']
DB_PASSWORD = os.environ['DB_PASSWORD']
DB_HOST     = os.environ['DB_HOST']
DB_PORT     = os.environ.get('DB_PORT', '5432')

MQTT_BROKER = os.environ['MQTT_BROKER']
MQTT_PORT   = int(os.environ.get('MQTT_PORT', 1883))
MQTT_USERNAME = os.environ.get('MQTT_USERNAME')
MQTT_PASSWORD = os.environ.get('MQTT_PASSWORD')
MQTT_USE_TLS = os.environ.get('MQTT_USE_TLS', 'false').lower() in {'1', 'true', 'yes', 'on'}
MQTT_KEEPALIVE = int(os.environ.get('MQTT_KEEPALIVE', 60))

# How often to refresh the token cache from DB (seconds)
TOKEN_CACHE_REFRESH_INTERVAL = 60

# How often to run the time-based schedule check (seconds)
SCHEDULE_CHECK_INTERVAL = 30

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s %(name)s: %(message)s',
)
logger = logging.getLogger('mqtt_worker')

# ---------------------------------------------------------------------------
# DB connection pool
# ---------------------------------------------------------------------------
db_pool: psycopg2.pool.ThreadedConnectionPool = None

def init_db_pool(retries: int = 10, delay: int = 3):
    global db_pool
    for attempt in range(1, retries + 1):
        try:
            db_pool = psycopg2.pool.ThreadedConnectionPool(
                minconn=2,
                maxconn=10,
                dbname=DB_NAME,
                user=DB_USER,
                password=DB_PASSWORD,
                host=DB_HOST,
                port=DB_PORT,
            )
            logger.info('DB pool connected (attempt %d)', attempt)
            return
        except psycopg2.OperationalError as exc:
            logger.warning('DB not ready (attempt %d/%d): %s', attempt, retries, exc)
            time.sleep(delay)
    raise RuntimeError('Cannot connect to database after %d attempts.' % retries)


def get_conn():
    return db_pool.getconn()


def put_conn(conn):
    db_pool.putconn(conn)

# ---------------------------------------------------------------------------
# Token cache: serial_number → api_token
# Refreshed periodically to pick up new greenhouses.
# ---------------------------------------------------------------------------
_token_cache: dict[str, str] = {}
_token_cache_lock = threading.Lock()


def refresh_token_cache():
    """Load all active greenhouse tokens from DB into memory."""
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT serial_number, api_token FROM greenhouses_greenhouse "
                "WHERE api_token IS NOT NULL AND status != 'deleted'"
            )
            rows = cur.fetchall()
        with _token_cache_lock:
            _token_cache.clear()
            for row in rows:
                _token_cache[row['serial_number']] = row['api_token']
        logger.info('Token cache refreshed: %d greenhouses loaded', len(rows))
    finally:
        put_conn(conn)


def token_cache_refresher():
    """Background thread: refresh token cache every TOKEN_CACHE_REFRESH_INTERVAL seconds."""
    while True:
        time.sleep(TOKEN_CACHE_REFRESH_INTERVAL)
        try:
            refresh_token_cache()
        except Exception as exc:
            logger.error('Token cache refresh error: %s', exc)


def validate_token(serial: str, token: str) -> bool:
    """Return True if the token matches the cached token for this serial."""
    with _token_cache_lock:
        expected = _token_cache.get(serial)
    if expected is None:
        # Not in cache – try a direct DB lookup (handles brand-new devices)
        conn = get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT api_token FROM greenhouses_greenhouse "
                    "WHERE serial_number = %s AND status = 'active'",
                    (serial,),
                )
                row = cur.fetchone()
            if row and row[0] == token:
                # Add to cache
                with _token_cache_lock:
                    _token_cache[serial] = token
                return True
            return False
        finally:
            put_conn(conn)
    return expected == token

# ---------------------------------------------------------------------------
# DB write helpers
# ---------------------------------------------------------------------------

def get_greenhouse_id(serial: str) -> int | None:
    """Return the DB id for a greenhouse by serial number."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM greenhouses_greenhouse WHERE serial_number = %s",
                (serial,),
            )
            row = cur.fetchone()
        return row[0] if row else None
    finally:
        put_conn(conn)


def insert_sensor_data(greenhouse_id: int, payload: dict):
    """Insert a SensorData row and upsert the latest-reading cache."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO greenhouses_sensordata
                  (greenhouse_id, temperature, humidity, soil_moisture,
                   light_intensity, battery, timestamp)
                VALUES (%s, %s, %s, %s, %s, %s, NOW())
                """,
                (
                    greenhouse_id,
                    payload['temperature'],
                    payload['humidity'],
                    payload.get('soil_moisture'),
                    payload.get('light_intensity'),
                    payload.get('battery'),
                ),
            )
            cur.execute(
                """
                INSERT INTO greenhouses_latestsensorreading
                  (greenhouse_id, timestamp, temperature, humidity,
                   soil_moisture, light_intensity, battery)
                VALUES (%s, NOW(), %s, %s, %s, %s, %s)
                ON CONFLICT (greenhouse_id) DO UPDATE SET
                  timestamp = EXCLUDED.timestamp,
                  temperature = EXCLUDED.temperature,
                  humidity = EXCLUDED.humidity,
                  soil_moisture = EXCLUDED.soil_moisture,
                  light_intensity = EXCLUDED.light_intensity,
                  battery = EXCLUDED.battery
                """,
                (
                    greenhouse_id,
                    payload['temperature'],
                    payload['humidity'],
                    payload.get('soil_moisture'),
                    payload.get('light_intensity'),
                    payload.get('battery'),
                ),
            )
        conn.commit()
    except Exception as exc:
        conn.rollback()
        raise exc
    finally:
        put_conn(conn)


def upsert_device_state(greenhouse_id: int, payload: dict):
    """
    Upsert DeviceState row based on a state report from ESP32.
    Only updates fields that are present in the payload.
    Uses a safe explicit approach: read → insert or update.
    """
    # Map payload keys → DB column names
    bool_fields = {
        'fan': 'fan',
        'water_pump': 'water_pump',
        'light': 'light',
    }

    update_parts = []
    update_vals = []

    for payload_key, col in bool_fields.items():
        if payload_key in payload:
            update_parts.append(f'{col} = %s')
            update_vals.append(bool(payload[payload_key]))

    if 'energy_state' in payload and payload['energy_state'] in ('battery', 'grid'):
        update_parts.append('energy_state = %s')
        update_vals.append(payload['energy_state'])

    update_parts.append('updated_at = NOW()')

    if not update_vals:
        return  # nothing to update

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            # INSERT … ON CONFLICT for proper upsert
            set_clause = ', '.join(update_parts)
            cur.execute(
                f"""
                INSERT INTO greenhouses_devicestate
                    (greenhouse_id, fan, water_pump, light, updated_at)
                VALUES (%s, FALSE, FALSE, FALSE, NOW())
                ON CONFLICT (greenhouse_id)
                DO UPDATE SET {set_clause}
                """,
                [greenhouse_id] + update_vals,
            )
        conn.commit()
    except Exception as exc:
        conn.rollback()
        logger.error('upsert_device_state error: %s', exc)
    finally:
        put_conn(conn)


# ---------------------------------------------------------------------------
# Schedule evaluation
# ---------------------------------------------------------------------------

# Python operator map for sensor-based rule evaluation
OPERATOR_MAP = {
    '>':  op.gt,
    '<':  op.lt,
    '>=': op.ge,
    '<=': op.le,
    '==': op.eq,
}

SENSOR_FIELD_MAP = {
    'temperature':    'temperature',
    'humidity':       'humidity',
    'soil_moisture':  'soil_moisture',
    'light_intensity': 'light_intensity',
}


def load_sensor_schedules(greenhouse_id: int) -> list[dict]:
    """Load all sensor-based schedules for a greenhouse."""
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, device_type, sensor_name, operator, threshold, action
                FROM schedules_schedule
                WHERE greenhouse_id = %s AND condition_type = 'sensor'
                """,
                (greenhouse_id,),
            )
            return cur.fetchall()
    finally:
        put_conn(conn)


def load_time_schedules() -> list[dict]:
    """Load all time-based schedules with their greenhouse serial numbers."""
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT s.id, s.device_type, s.time_of_day, s.action,
                       g.serial_number, g.id as greenhouse_id
                FROM schedules_schedule s
                JOIN greenhouses_greenhouse g ON g.id = s.greenhouse_id
                WHERE s.condition_type = 'time'
                  AND g.status = 'active'
                """
            )
            return cur.fetchall()
    finally:
        put_conn(conn)


def evaluate_sensor_schedules(greenhouse_id: int, serial: str, sensor_payload: dict, mqtt_client):
    """
    Check all sensor-based schedules for the greenhouse.
    If a condition is met, publish a command to the ESP32.
    """
    try:
        schedules = load_sensor_schedules(greenhouse_id)
    except Exception as exc:
        logger.error('Failed to load sensor schedules for %s: %s', serial, exc)
        return

    for rule in schedules:
        sensor_name = rule['sensor_name']
        payload_key = SENSOR_FIELD_MAP.get(sensor_name)
        reading = sensor_payload.get(payload_key)

        if reading is None:
            continue

        compare = OPERATOR_MAP.get(rule['operator'])
        if compare is None:
            continue

        try:
            condition_met = compare(float(reading), float(rule['threshold']))
        except (TypeError, ValueError):
            continue

        if condition_met:
            cmd = {'device': rule['device_type'], 'action': rule['action']}
            topic = f'gh/{serial}/cmd'
            mqtt_client.publish(topic, json.dumps(cmd), qos=1)
            logger.info(
                'Sensor schedule fired: gh=%s | %s %s %s → %s %s',
                serial, sensor_name, rule['operator'], rule['threshold'],
                rule['device_type'], rule['action'],
            )


# ---------------------------------------------------------------------------
# MQTT callbacks
# ---------------------------------------------------------------------------

def on_connect(client, userdata, flags, rc, *args):
    # paho-mqtt v2 passes an extra 'properties' arg; *args absorbs it
    if rc == 0:
        logger.info('Connected to MQTT broker %s:%d', MQTT_BROKER, MQTT_PORT)
        client.subscribe('gh/+/sensors', qos=1)
        client.subscribe('gh/+/state', qos=1)
        logger.info('Subscribed to gh/+/sensors and gh/+/state')
    else:
        logger.error('MQTT connection failed with rc=%d', rc)


def on_disconnect(client, userdata, rc, *args):
    # paho-mqtt v2 passes extra args; *args absorbs them
    if rc != 0:
        logger.warning('Unexpected MQTT disconnect (rc=%d). Will auto-reconnect.', rc)


def on_message(client, userdata, msg):
    topic = msg.topic

    try:
        payload = json.loads(msg.payload.decode('utf-8'))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        logger.warning('Invalid JSON on topic %s: %s', topic, exc)
        return

    # Topic format: gh/{serial}/{type}
    parts = topic.split('/')
    if len(parts) != 3 or parts[0] != 'gh':
        logger.warning('Unexpected topic format: %s', topic)
        return

    serial   = parts[1]
    msg_type = parts[2]  # 'sensors' or 'state'

    # Validate token
    token = payload.get('token', '')
    if not validate_token(serial, token):
        logger.warning('Invalid token for serial %s – message rejected', serial)
        return

    # Resolve greenhouse DB id
    gh_id = get_greenhouse_id(serial)
    if gh_id is None:
        logger.warning('No greenhouse found for serial %s', serial)
        return

    if msg_type == 'sensors':
        _handle_sensors(client, serial, gh_id, payload)

    elif msg_type == 'state':
        _handle_state(serial, gh_id, payload)

    else:
        logger.debug('Ignored message type: %s', msg_type)


def _handle_sensors(client, serial: str, gh_id: int, payload: dict):
    """Process a sensor reading: insert to DB + evaluate schedules."""
    required = {'temperature', 'humidity'}
    if not required.issubset(payload.keys()):
        logger.warning('Sensor payload missing required fields (serial=%s)', serial)
        return

    try:
        insert_sensor_data(gh_id, payload)
        logger.info(
            'Sensor data saved: serial=%s temp=%.1f hum=%.1f',
            serial, payload['temperature'], payload['humidity'],
        )
    except Exception as exc:
        logger.error('DB insert failed for serial %s: %s', serial, exc)
        return

    # Evaluate sensor-based schedule rules
    evaluate_sensor_schedules(gh_id, serial, payload, client)


def _handle_state(serial: str, gh_id: int, payload: dict):
    """Process a device state report from ESP32."""
    try:
        upsert_device_state(gh_id, payload)
        logger.info('Device state updated: serial=%s', serial)
    except Exception as exc:
        logger.error('State upsert failed for serial %s: %s', serial, exc)


# ---------------------------------------------------------------------------
# Time-based schedule dispatcher (runs in background thread)
# ---------------------------------------------------------------------------

# Track which schedule IDs fired in this minute to avoid double-firing
_fired_this_minute: set[int] = set()
_last_minute_checked: int = -1


def time_schedule_dispatcher(mqtt_client):
    """
    Background thread: every SCHEDULE_CHECK_INTERVAL seconds, check if any
    time-based schedules should fire based on the current UTC time.
    """
    global _fired_this_minute, _last_minute_checked

    while True:
        time.sleep(SCHEDULE_CHECK_INTERVAL)
        try:
            now = datetime.now(timezone.utc)
            current_minute = now.hour * 60 + now.minute

            # Reset the per-minute dedup set when the minute changes
            if current_minute != _last_minute_checked:
                _fired_this_minute = set()
                _last_minute_checked = current_minute

            schedules = load_time_schedules()

            for rule in schedules:
                schedule_id = rule['id']
                if schedule_id in _fired_this_minute:
                    continue

                tod = rule['time_of_day']  # datetime.time object from psycopg2
                if tod.hour == now.hour and tod.minute == now.minute:
                    serial = rule['serial_number']
                    cmd = {'device': rule['device_type'], 'action': rule['action']}
                    topic = f'gh/{serial}/cmd'
                    mqtt_client.publish(topic, json.dumps(cmd), qos=1)
                    _fired_this_minute.add(schedule_id)
                    logger.info(
                        'Time schedule fired: id=%d serial=%s %s → %s %s',
                        schedule_id, serial, tod, rule['device_type'], rule['action'],
                    )

        except Exception as exc:
            logger.error('Time schedule dispatcher error: %s', exc)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    logger.info('Starting Smart Greenhouse MQTT Worker…')

    # 1. Connect DB pool (with retries)
    init_db_pool()

    # 2. Initial token cache load
    refresh_token_cache()

    # 3. Build MQTT client
    import uuid
    client_id = f'greenhouse_worker_{uuid.uuid4().hex[:8]}'
    try:
        # paho-mqtt >= 2.0 supports CallbackAPIVersion
        from paho.mqtt.enums import CallbackAPIVersion
        client = mqtt.Client(
            client_id=client_id,
            callback_api_version=CallbackAPIVersion.VERSION2,
            clean_session=True,
            protocol=mqtt.MQTTv311,
        )
    except ImportError:
        client = mqtt.Client(client_id=client_id, clean_session=True, protocol=mqtt.MQTTv311)
    client.on_connect    = on_connect
    client.on_disconnect = on_disconnect
    client.on_message    = on_message
    client.enable_logger(logger)

    if MQTT_USERNAME:
        client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
        logger.info('Configured MQTT username authentication')

    if MQTT_USE_TLS:
        client.tls_set()
        logger.info('Configured MQTT TLS')

    # 4. Start background threads
    threading.Thread(target=token_cache_refresher, daemon=True).start()
    threading.Thread(
        target=time_schedule_dispatcher,
        args=(client,),
        daemon=True,
    ).start()

    # 5. Connect to broker with auto-reconnect
    client.reconnect_delay_set(min_delay=1, max_delay=30)
    connected = False
    while not connected:
        try:
            client.connect(MQTT_BROKER, MQTT_PORT, keepalive=MQTT_KEEPALIVE)
            connected = True
        except Exception as exc:
            logger.warning('MQTT broker not ready: %s – retrying in 5s', exc)
            time.sleep(5)

    logger.info('MQTT Worker running. Waiting for messages…')
    client.loop_forever()


if __name__ == '__main__':
    main()
