from django.db import models

from core.apps.greenhouses.models import Greenhouse


class Schedule(models.Model):
    """
    A schedule rule for a greenhouse actuator.
    Two types:
      - time:   fires at a specific time of day every day
      - sensor: fires when a sensor reading crosses a threshold

    Table: schedules_schedule
    DB constraint mirrors schema.sql CHECK constraint enforced in serializer too.
    """
    # Device targets
    DEVICE_FAN = 'fan'
    DEVICE_PUMP = 'pump'
    DEVICE_LIGHT = 'light'
    DEVICE_CHOICES = [
        (DEVICE_FAN, 'Fan'),
        (DEVICE_PUMP, 'Pump'),
        (DEVICE_LIGHT, 'Light'),
    ]

    # Condition types
    CONDITION_TIME = 'time'
    CONDITION_SENSOR = 'sensor'
    CONDITION_CHOICES = [
        (CONDITION_TIME, 'Time-based'),
        (CONDITION_SENSOR, 'Sensor-based'),
    ]

    # Sensor names
    SENSOR_TEMPERATURE = 'temperature'
    SENSOR_HUMIDITY = 'humidity'
    SENSOR_SOIL = 'soil_moisture'
    SENSOR_LIGHT = 'light_intensity'
    SENSOR_CHOICES = [
        (SENSOR_TEMPERATURE, 'Temperature'),
        (SENSOR_HUMIDITY, 'Humidity'),
        (SENSOR_SOIL, 'Soil Moisture'),
        (SENSOR_LIGHT, 'Light Intensity'),
    ]

    # Operators
    OPERATOR_CHOICES = [
        ('>', 'Greater than'),
        ('<', 'Less than'),
        ('>=', 'Greater or equal'),
        ('<=', 'Less or equal'),
        ('==', 'Equal'),
    ]

    # Actions
    ACTION_ON = 'on'
    ACTION_OFF = 'off'
    ACTION_CHOICES = [
        (ACTION_ON, 'Turn On'),
        (ACTION_OFF, 'Turn Off'),
    ]

    greenhouse = models.ForeignKey(
        Greenhouse,
        on_delete=models.CASCADE,
        related_name='schedules',
    )
    device_type = models.CharField(max_length=20, choices=DEVICE_CHOICES)
    condition_type = models.CharField(max_length=10, choices=CONDITION_CHOICES)

    # Time-based fields
    time_of_day = models.TimeField(null=True, blank=True)

    # Sensor-based fields
    sensor_name = models.CharField(
        max_length=20, choices=SENSOR_CHOICES, null=True, blank=True
    )
    operator = models.CharField(
        max_length=5, choices=OPERATOR_CHOICES, null=True, blank=True
    )
    threshold = models.FloatField(null=True, blank=True)

    action = models.CharField(max_length=3, choices=ACTION_CHOICES)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'schedules_schedule'
        verbose_name = 'Schedule'
        verbose_name_plural = 'Schedules'
        ordering = ['condition_type', 'time_of_day']

    def __str__(self):
        if self.condition_type == self.CONDITION_TIME:
            return f'[time] {self.time_of_day} → {self.device_type} {self.action}'
        return (
            f'[sensor] {self.sensor_name} {self.operator} {self.threshold}'
            f' → {self.device_type} {self.action}'
        )
