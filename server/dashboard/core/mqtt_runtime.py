"""
In-process MQTT subscriber + schedule dispatcher.

On hosting providers that cannot run a separate background worker for free
(e.g. Render free tier), this module runs the ESP32-data ingestion loop inside
the Django web process instead. It is a faithful port of the standalone
`server/mqtt/mqtt_worker.py`, rewritten to use the Django ORM instead of raw
psycopg2 + SQL.

Activation
----------
Started by `core.wsgi` on web-process boot, but ONLY when the env var
`MQTT_WORKER_IN_PROCESS=true`. Local Docker dev keeps using the standalone
worker (docker-compose), so there are no duplicate subscribers.

Persistent session (survives backend sleep / Render spin-down)
---------------------------------------------------------------
The client uses a FIXED client_id with clean_session=False and subscribes at
QoS 1. Combined with a broker that supports persistent sessions (HiveMQ, EMQX,
Mosquitto with persistence enabled), ESP32 sensor messages published while the
backend is asleep are queued by the broker and redelivered on reconnect – so no
sensor history is lost. Schedule firing still pauses during sleep, which is why
schedules should be executed on the ESP32 itself from flash (the server already
pushes the full schedule list to `gh/{serial}/schedules` with retain=True).

Topic map (unchanged from the standalone worker):
    SUBSCRIBE: gh/+/sensors, gh/+/state
    PUBLISH:   gh/{serial}/cmd, gh/{serial}/schedules
"""

import json
import logging
import operator as op
import os
import threading
import time
from datetime import datetime, timezone

import paho.mqtt.client as mqtt

logger = logging.getLogger('core.mqtt_runtime')

# ---------------------------------------------------------------------------
# Configuration (read lazily from settings so this imports cleanly at startup)
# ---------------------------------------------------------------------------

# How often the time-based dispatcher checks for due schedules (seconds).
SCHEDULE_CHECK_INTERVAL = 30
# How often the token + schedule caches are refreshed from the DB (seconds).
CACHE_REFRESH_INTERVAL = 60

# Fixed client id so the broker keeps a persistent session across reconnects.
_CLIENT_ID = 'greenhouse-django-worker'


def _conf():
    """Return a snapshot of MQTT config from Django settings/env."""
    from django.conf import settings
    return {
        'enabled': getattr(settings, 'MQTT_ENABLED', False),
        'broker': getattr(settings, 'MQTT_BROKER', 'localhost'),
        'port': int(getattr(settings, 'MQTT_PORT', 1883)),
        'username': os.environ.get('MQTT_USERNAME') or None,
        'password': os.environ.get('MQTT_PASSWORD') or None,
        'use_tls': _env_bool('MQTT_USE_TLS', False),
        'keepalive': int(os.environ.get('MQTT_KEEPALIVE', '60')),
    }


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {'1', 'true', 'yes', 'on'}


# ---------------------------------------------------------------------------
# Caches: serial → api_token, greenhouse → sensor-schedule list
# Refreshed periodically so brand-new greenhouses/schedules are picked up.
# ---------------------------------------------------------------------------

_token_cache: dict = {}
_token_cache_lock = threading.Lock()

_schedule_cache: dict = {}  # greenhouse_id -> list[Schedule]
_schedule_cache_lock = threading.Lock()


def refresh_caches():
    """Reload the token cache and sensor-schedule cache from the DB."""
    from core.apps.greenhouses.models import Greenhouse
    from core.apps.schedules.models import Schedule

    # Token cache
    rows = Greenhouse.objects.exclude(
        status=Greenhouse.STATUS_DELETED
    ).exclude(api_token__isnull=True).values_list('serial_number', 'api_token')

    with _token_cache_lock:
        _token_cache.clear()
        _token_cache.update(rows)

    # Sensor-schedule cache grouped by greenhouse_id
    schedules = list(
        Schedule.objects.filter(condition_type=Schedule.CONDITION_SENSOR)
        .select_related('greenhouse')
    )
    grouped: dict = {}
    for s in schedules:
        grouped.setdefault(s.greenhouse_id, []).append(s)

    with _schedule_cache_lock:
        _schedule_cache.clear()
        _schedule_cache.update(grouped)

    logger.info(
        'Caches refreshed: %d greenhouses, %d sensor schedules',
        len(_token_cache), len(schedules),
    )


def _cache_refresher_loop():
    """Background thread: refresh caches every CACHE_REFRESH_INTERVAL seconds."""
    # Refresh once immediately so the worker starts warm.
    while True:
        try:
            refresh_caches()
        except Exception as exc:
            logger.error('Cache refresh error: %s', exc)
        time.sleep(CACHE_REFRESH_INTERVAL)


# ---------------------------------------------------------------------------
# Schedule evaluation
# ---------------------------------------------------------------------------

OPERATOR_MAP = {
    '>':  op.gt,
    '<':  op.lt,
    '>=': op.ge,
    '<=': op.le,
    '==': op.eq,
}

SENSOR_FIELD_MAP = {
    'temperature':     'temperature',
    'humidity':        'humidity',
    'soil_moisture':   'soil_moisture',
    'light_intensity': 'light_intensity',
}


def evaluate_sensor_schedules(greenhouse_id, serial, sensor_payload, client):
    """
    Check the cached sensor-based schedules for the greenhouse.
    Publish a command to the ESP32 when a condition is met.
    """
    with _schedule_cache_lock:
        schedules = list(_schedule_cache.get(greenhouse_id, []))

    for rule in schedules:
        payload_key = SENSOR_FIELD_MAP.get(rule.sensor_name)
        reading = sensor_payload.get(payload_key) if payload_key else None
        if reading is None:
            continue

        compare = OPERATOR_MAP.get(rule.operator)
        if compare is None:
            continue

        try:
            condition_met = compare(float(reading), float(rule.threshold))
        except (TypeError, ValueError):
            continue

        if condition_met:
            fan_target = getattr(rule, 'fan_target', None)
            _publish_command(client, serial, rule.device_type, rule.action, fan_target=fan_target)
            logger.info(
                'Sensor schedule fired: gh=%s | %s %s %s → %s %s (fan_target=%s)',
                serial, rule.sensor_name, rule.operator, rule.threshold,
                rule.device_type, rule.action, fan_target,
            )


# ---------------------------------------------------------------------------
# Time-based schedule dispatcher
# ---------------------------------------------------------------------------

_fired_this_minute: set = set()
_last_minute_checked: int = -1


def time_schedule_dispatcher(client):
    """Background thread: fire due time-based schedules based on UTC time."""
    global _fired_this_minute, _last_minute_checked
    from core.apps.schedules.models import Schedule
    from core.apps.greenhouses.models import Greenhouse

    while True:
        time.sleep(SCHEDULE_CHECK_INTERVAL)
        try:
            now = datetime.now(timezone.utc)
            current_minute = now.hour * 60 + now.minute

            # Reset the per-minute dedup set when the minute changes
            if current_minute != _last_minute_checked:
                _fired_this_minute = set()
                _last_minute_checked = current_minute

            schedules = Schedule.objects.filter(
                condition_type=Schedule.CONDITION_TIME,
                greenhouse__status=Greenhouse.STATUS_ACTIVE,
            ).select_related('greenhouse')

            for rule in schedules:
                if rule.id in _fired_this_minute:
                    continue
                tod = rule.time_of_day
                if tod and tod.hour == now.hour and tod.minute == now.minute:
                    serial = rule.greenhouse.serial_number
                    fan_target = getattr(rule, 'fan_target', None)
                    _publish_command(client, serial, rule.device_type, rule.action, fan_target=fan_target)
                    _fired_this_minute.add(rule.id)
                    logger.info(
                        'Time schedule fired: id=%d serial=%s %s → %s %s (fan_target=%s)',
                        rule.id, serial, tod, rule.device_type, rule.action, fan_target,
                    )
        except Exception as exc:
            logger.error('Time schedule dispatcher error: %s', exc)


# ---------------------------------------------------------------------------
# MQTT callbacks
# ---------------------------------------------------------------------------

def _publish_command(client, serial, device, action, fan_target=None):
    """Publish a control command to the ESP32."""
    topic = f'gh/{serial}/cmd'
    cmd = {'device': device, 'action': action}
    if fan_target:
        cmd['fan_target'] = fan_target
    payload = json.dumps(cmd)
    client.publish(topic, payload, qos=1)


def _session_present(flags) -> bool:
    """Extract the 'session present' flag across paho-mqtt v1 (dict) and v2."""
    if isinstance(flags, dict):
        return bool(flags.get('session present', 0))
    return bool(getattr(flags, 'session present', 0))


def on_connect(client, userdata, flags, rc, *args):
    # paho-mqtt v2 passes an extra 'properties' arg; *args absorbs it.
    if rc == 0:
        logger.info(
            'Connected to MQTT broker (session_present=%s)',
            _session_present(flags),
        )
        # Subscribe at QoS 1 so the broker queues messages for this session
        # while the worker is disconnected (persistent session).
        client.subscribe('gh/+/sensors', qos=1)
        client.subscribe('gh/+/state', qos=1)
        logger.info('Subscribed to gh/+/sensors and gh/+/state @ QoS 1')
        # Refresh caches on every (re)connect so we never validate against
        # stale tokens after a long sleep.
        try:
            refresh_caches()
        except Exception as exc:
            logger.warning('Post-connect cache refresh failed: %s', exc)
    else:
        logger.error('MQTT connection failed with rc=%d', rc)


def on_disconnect(client, userdata, rc, *args):
    if rc != 0:
        logger.warning('Unexpected MQTT disconnect (rc=%d). Will auto-reconnect.', rc)
    else:
        logger.info('MQTT disconnected cleanly')


def on_message(client, userdata, msg):
    from core.apps.greenhouses.models import Greenhouse, SensorData, DeviceState

    try:
        payload = json.loads(msg.payload.decode('utf-8'))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        logger.warning('Invalid JSON on topic %s: %s', msg.topic, exc)
        return

    # Topic format: gh/{serial}/{type}
    parts = msg.topic.split('/')
    if len(parts) != 3 or parts[0] != 'gh':
        logger.warning('Unexpected topic format: %s', msg.topic)
        return

    serial, msg_type = parts[1], parts[2]

    # Fast token check against the in-memory cache (no DB hit in the hot path).
    token = payload.get('token', '')
    with _token_cache_lock:
        expected = _token_cache.get(serial)
    if expected is None:
        # Not in cache – cold lookup (handles brand-new greenhouses before the
        # next refresh). Caches its result implicitly once refresh runs.
        try:
            greenhouse = Greenhouse.objects.get(
                serial_number=serial, status=Greenhouse.STATUS_ACTIVE
            )
        except Greenhouse.DoesNotExist:
            logger.warning('No greenhouse found for serial %s', serial)
            return
        if not greenhouse.api_token or greenhouse.api_token != token:
            logger.warning('Invalid token for serial %s – message rejected', serial)
            return
    else:
        if expected != token:
            logger.warning('Invalid token for serial %s – message rejected', serial)
            return
        # Resolve the ORM object for writes (cached serial→id would also work,
        # but we need the FK instance and this is one indexed query).
        try:
            greenhouse = Greenhouse.objects.only('id').get(serial_number=serial)
        except Greenhouse.DoesNotExist:
            logger.warning('No greenhouse found for serial %s', serial)
            return

    if msg_type == 'sensors':
        required = {'temperature', 'humidity'}
        if not required.issubset(payload.keys()):
            logger.warning('Sensor payload missing required fields (serial=%s)', serial)
            return
        try:
            SensorData.objects.create(
                greenhouse=greenhouse,
                temperature=payload['temperature'],
                humidity=payload['humidity'],
                soil_moisture=payload.get('soil_moisture'),
                light_intensity=payload.get('light_intensity'),
                battery=payload.get('battery'),
            )
            from core.apps.greenhouses.utils import upsert_latest_sensor_reading
            upsert_latest_sensor_reading(greenhouse, payload)
        except Exception as exc:
            logger.error('DB insert failed for serial %s: %s', serial, exc)
            return

        from django.conf import settings
        if getattr(settings, 'SERVER_SCHEDULE_DISPATCH', True):
            evaluate_sensor_schedules(greenhouse.id, serial, payload, client)

    elif msg_type == 'state':
        # Single-statement upsert instead of get_or_create + save.
        DeviceState.objects.update_or_create(
            greenhouse=greenhouse,
            defaults={
                'fan_set1': bool(payload.get('fan_set1', False)),
                'fan_set2': bool(payload.get('fan_set2', False)),
                'water_pump': bool(payload.get('water_pump', False)),
                'light': bool(payload.get('light', False)),
                **({'energy_state': payload['energy_state']}
                   if payload.get('energy_state') in ('battery', 'grid') else {}),
            },
        )
        logger.info('Device state updated: serial=%s', serial)
    else:
        logger.debug('Ignored message type: %s', msg_type)


# ---------------------------------------------------------------------------
# Start / once-only guard
# ---------------------------------------------------------------------------

_started = False
_started_lock = threading.Lock()


def start():
    """
    Start the in-process MQTT subscriber + dispatcher.

    No-op unless:
      • MQTT_WORKER_IN_PROCESS env var is "true", AND
      • MQTT_ENABLED is true in settings.

    Called from core.wsgi so it runs once per gunicorn master boot and never
    during `manage.py migrate` / `collectstatic`.
    """
    global _started
    if not _env_bool('MQTT_WORKER_IN_PROCESS', False):
        return

    with _started_lock:
        if _started:
            return
        cfg = _conf()
        if not cfg['enabled']:
            logger.info('MQTT_ENABLED is false; in-process worker not started')
            return

        try:
            from paho.mqtt.enums import CallbackAPIVersion
            client = mqtt.Client(
                client_id=_CLIENT_ID,
                callback_api_version=CallbackAPIVersion.VERSION2,
                clean_session=False,  # persistent session → broker queues msgs
                protocol=mqtt.MQTTv311,
            )
        except ImportError:
            client = mqtt.Client(
                client_id=_CLIENT_ID,
                clean_session=False,
                protocol=mqtt.MQTTv311,
            )

        client.on_connect = on_connect
        client.on_disconnect = on_disconnect
        client.on_message = on_message
        client.enable_logger(logger)

        if cfg['username']:
            client.username_pw_set(cfg['username'], cfg['password'])
            logger.info('Configured MQTT username authentication')
        if cfg['use_tls']:
            client.tls_set()
            logger.info('Configured MQTT TLS')

        # Daemon threads die with the process.
        threading.Thread(target=_cache_refresher_loop, daemon=True).start()

        from django.conf import settings
        if getattr(settings, 'SERVER_SCHEDULE_DISPATCH', True):
            threading.Thread(target=time_schedule_dispatcher, args=(client,), daemon=True).start()
            logger.info('Server-side schedule dispatcher enabled')
        else:
            logger.info(
                'Server-side schedule dispatch disabled – ESP runs schedules from flash'
            )

        # Connect in a background thread so a slow/unreachable broker never
        # blocks the web process from booting. Reconnect is handled by paho.
        def _connect_loop():
            client.reconnect_delay_set(min_delay=1, max_delay=30)
            while True:
                try:
                    client.connect(cfg['broker'], cfg['port'], keepalive=cfg['keepalive'])
                    logger.info('In-process MQTT worker connected to %s:%d',
                                cfg['broker'], cfg['port'])
                    client.loop_forever()
                    break
                except Exception as exc:
                    logger.warning('MQTT connect failed: %s – retrying in 5s', exc)
                    time.sleep(5)

        threading.Thread(target=_connect_loop, daemon=True).start()
        _started = True
        logger.info('In-process MQTT worker scheduled to start')
