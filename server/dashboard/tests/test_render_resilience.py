from types import SimpleNamespace

import pytest
from django.utils import timezone
from django.contrib.auth import get_user_model

from core.apps.greenhouses.models import Greenhouse, LatestSensorReading
from core.apps.greenhouses.serializers import LatestSensorReadingSerializer
from core.apps.greenhouses.utils import mqtt_push_schedules


@pytest.mark.django_db
def test_latest_sensor_reading_serializer_exposes_freshness_fields():
    User = get_user_model()
    user = User.objects.create_user(username='tester', password='pass12345')
    greenhouse = Greenhouse.objects.create(
        owner=user,
        serial_number='GH-TEST-001',
        name='Test House',
        status=Greenhouse.STATUS_ACTIVE,
    )
    reading = LatestSensorReading.objects.create(
        greenhouse=greenhouse,
        timestamp=timezone.now(),
        temperature=28.4,
        humidity=63.2,
        soil_moisture=41.0,
        light_intensity=801.0,
        battery=3.9,
    )

    data = LatestSensorReadingSerializer(reading).data

    assert data['greenhouse_id'] == greenhouse.id
    assert data['age_seconds'] is not None
    assert data['age_seconds'] >= 0
    assert data['is_stale'] is False


def test_mqtt_push_schedules_retains_payload(monkeypatch):
    greenhouse = SimpleNamespace(serial_number='GH-TEST-001')
    captured = {}

    def fake_single(**kwargs):
        captured.update(kwargs)

    monkeypatch.setattr('core.apps.greenhouses.utils.publish.single', fake_single)
    monkeypatch.setattr('core.apps.greenhouses.utils.settings.MQTT_ENABLED', True, raising=False)
    monkeypatch.setattr('core.apps.greenhouses.utils.settings.MQTT_BROKER', 'localhost', raising=False)
    monkeypatch.setattr('core.apps.greenhouses.utils.settings.MQTT_PORT', 1883, raising=False)

    monkeypatch.setattr(
        'core.apps.greenhouses.utils.build_schedule_payload',
        lambda gh: [
            {
                'id': 1,
                'device_type': 'fan',
                'condition_type': 'time',
                'time_of_day': '06:00',
                'sensor_name': None,
                'operator': None,
                'threshold': None,
                'action': 'on',
            }
        ],
    )

    ok = mqtt_push_schedules(greenhouse)

    assert ok is True
    assert captured['topic'] == 'gh/GH-TEST-001/schedules'
    assert captured['qos'] == 1
    assert captured['retain'] is True
    assert captured['payload']
