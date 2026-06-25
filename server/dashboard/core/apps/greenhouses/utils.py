import json
import logging
import os

import paho.mqtt.publish as publish
from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)


def _mqtt_publish_kwargs():
    """Common kwargs for one-shot MQTT publishes (broker auth + TLS)."""
    kwargs = {
        'hostname': settings.MQTT_BROKER,
        'port': settings.MQTT_PORT,
    }
    username = os.environ.get('MQTT_USERNAME')
    password = os.environ.get('MQTT_PASSWORD')
    if username:
        kwargs['auth'] = {'username': username, 'password': password or ''}
    if os.environ.get('MQTT_USE_TLS', 'false').lower() in {'1', 'true', 'yes', 'on'}:
        kwargs['tls'] = {}
    return kwargs


def upsert_latest_sensor_reading(greenhouse, payload: dict):
    """Persist the most recent sensor values for fast API reads after wake."""
    from .models import LatestSensorReading

    LatestSensorReading.objects.update_or_create(
        greenhouse=greenhouse,
        defaults={
            'timestamp': timezone.now(),
            'temperature': payload['temperature'],
            'humidity': payload['humidity'],
            'soil_moisture': payload.get('soil_moisture'),
            'light_intensity': payload.get('light_intensity'),
            'battery': payload.get('battery'),
        },
    )


def build_schedule_payload(greenhouse) -> list:
    """Serialize all schedules for a greenhouse into an MQTT-ready list."""
    from core.apps.schedules.models import Schedule

    schedules = Schedule.objects.filter(greenhouse=greenhouse).values(
        'id', 'device_type', 'condition_type',
        'time_of_day', 'sensor_name', 'operator', 'threshold', 'action',
    )
    payload_list = []
    for s in schedules:
        item = dict(s)
        if item.get('time_of_day'):
            item['time_of_day'] = item['time_of_day'].strftime('%H:%M')
        payload_list.append(item)
    return payload_list


def mqtt_push_command(greenhouse, device: str, action: str) -> bool:
    """
    Publish a control command to the ESP32 via MQTT.

    Topic  : gh/{serial_number}/cmd
    Payload: {"device": "<fan|pump|light>", "action": "<on|off>"}

    Returns True on success, False on failure.
    """
    if not getattr(settings, 'MQTT_ENABLED', True):
        logger.info('MQTT disabled; skipping CMD publish for %s', greenhouse.serial_number)
        return False

    topic = f'gh/{greenhouse.serial_number}/cmd'
    payload = json.dumps({'device': device, 'action': action})

    try:
        publish.single(
            topic=topic,
            payload=payload,
            qos=1,
            retain=False,
            **_mqtt_publish_kwargs(),
        )
        logger.info('MQTT CMD → %s | %s', topic, payload)
        return True
    except Exception as exc:
        logger.error('MQTT publish failed for %s: %s', topic, exc)
        return False


def mqtt_push_schedules(greenhouse) -> bool:
    """
    Push all active schedules for a greenhouse to the ESP32.
    This is called when a schedule is created/updated/deleted.

    Topic  : gh/{serial_number}/schedules
    Payload: list of schedule dicts
    """
    if not getattr(settings, 'MQTT_ENABLED', True):
        logger.info('MQTT disabled; skipping schedule publish for %s', greenhouse.serial_number)
        return False

    payload_list = build_schedule_payload(greenhouse)
    topic = f'gh/{greenhouse.serial_number}/schedules'
    payload = json.dumps(payload_list)

    try:
        publish.single(
            topic=topic,
            payload=payload,
            qos=1,
            retain=True,   # retain so ESP32 gets it on reconnect / flash write
            **_mqtt_publish_kwargs(),
        )
        logger.info('MQTT SCHEDULES → %s (%d schedules)', topic, len(payload_list))
        return True
    except Exception as exc:
        logger.error('MQTT schedule push failed for %s: %s', topic, exc)
        return False
