import logging
import paho.mqtt.publish as publish
from django.conf import settings

logger = logging.getLogger(__name__)


def mqtt_push_command(greenhouse, device: str, action: str) -> bool:
    """
    Publish a control command to the ESP32 via MQTT.

    Topic  : gh/{serial_number}/cmd
    Payload: {"device": "<fan|pump|light>", "action": "<on|off>"}

    Returns True on success, False on failure.
    """
    import json

    topic = f'gh/{greenhouse.serial_number}/cmd'
    payload = json.dumps({'device': device, 'action': action})

    try:
        publish.single(
            topic=topic,
            payload=payload,
            hostname=settings.MQTT_BROKER,
            port=settings.MQTT_PORT,
            qos=1,
            retain=False,
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
    import json
    from core.apps.schedules.models import Schedule

    schedules = Schedule.objects.filter(greenhouse=greenhouse).values(
        'id', 'device_type', 'condition_type',
        'time_of_day', 'sensor_name', 'operator', 'threshold', 'action',
    )

    # Convert time objects to string for JSON serialization
    payload_list = []
    for s in schedules:
        item = dict(s)
        if item.get('time_of_day'):
            item['time_of_day'] = item['time_of_day'].strftime('%H:%M')
        payload_list.append(item)

    topic = f'gh/{greenhouse.serial_number}/schedules'
    payload = json.dumps(payload_list)

    try:
        publish.single(
            topic=topic,
            payload=payload,
            hostname=settings.MQTT_BROKER,
            port=settings.MQTT_PORT,
            qos=1,
            retain=True,   # retain so ESP32 gets it on reconnect
        )
        logger.info('MQTT SCHEDULES → %s (%d schedules)', topic, len(payload_list))
        return True
    except Exception as exc:
        logger.error('MQTT schedule push failed for %s: %s', topic, exc)
        return False
