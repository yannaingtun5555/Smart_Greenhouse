from django.conf import settings
from django.db import models


class Greenhouse(models.Model):
    """
    Represents a physical greenhouse unit.
    Table: greenhouses_greenhouse
    """
    STATUS_PENDING = 'pending'
    STATUS_ACTIVE = 'active'
    STATUS_OFFLINE = 'offline'
    STATUS_DELETED = 'deleted'

    STATUS_CHOICES = [
        (STATUS_PENDING, 'Pending'),
        (STATUS_ACTIVE, 'Active'),
        (STATUS_OFFLINE, 'Offline'),
        (STATUS_DELETED, 'Deleted'),
    ]

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='greenhouses',
    )
    serial_number = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=100)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=STATUS_PENDING)
    api_token = models.CharField(max_length=255, unique=True, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'greenhouses_greenhouse'
        verbose_name = 'Greenhouse'
        verbose_name_plural = 'Greenhouses'
        indexes = [
            models.Index(fields=['owner', 'status'], name='idx_greenhouses_owner_status'),
        ]

    def __str__(self):
        return f'{self.name} ({self.serial_number})'


class SensorData(models.Model):
    """
    Time-series sensor readings from ESP32.
    Table: greenhouses_sensordata
    """
    greenhouse = models.ForeignKey(
        Greenhouse,
        on_delete=models.CASCADE,
        related_name='sensor_data',
    )
    timestamp = models.DateTimeField(auto_now_add=True, db_index=True)

    temperature = models.FloatField()
    humidity = models.FloatField()
    soil_moisture = models.FloatField(null=True, blank=True)
    light_intensity = models.FloatField(null=True, blank=True)
    battery = models.FloatField(null=True, blank=True)

    class Meta:
        db_table = 'greenhouses_sensordata'
        verbose_name = 'Sensor Data'
        verbose_name_plural = 'Sensor Data'
        ordering = ['-timestamp']
        indexes = [
            models.Index(
                fields=['greenhouse', '-timestamp'],
                name='idx_sensordata_gh_ts',
            ),
            models.Index(fields=['timestamp'], name='idx_sensordata_timestamp'),
        ]

    def __str__(self):
        return f'[{self.timestamp}] {self.greenhouse.serial_number}'


class LatestSensorReading(models.Model):
    """
    Denormalized latest sensor values per greenhouse.

    Updated on every MQTT ingest so the API can return the most recent
    reading immediately after a Render spin-down wake, without scanning
    the time-series table.
    """
    greenhouse = models.OneToOneField(
        Greenhouse,
        on_delete=models.CASCADE,
        primary_key=True,
        related_name='latest_reading',
    )
    timestamp = models.DateTimeField()
    temperature = models.FloatField()
    humidity = models.FloatField()
    soil_moisture = models.FloatField(null=True, blank=True)
    light_intensity = models.FloatField(null=True, blank=True)
    battery = models.FloatField(null=True, blank=True)

    class Meta:
        db_table = 'greenhouses_latestsensorreading'
        verbose_name = 'Latest Sensor Reading'
        verbose_name_plural = 'Latest Sensor Readings'

    def __str__(self):
        return f'Latest [{self.timestamp}] {self.greenhouse.serial_number}'


class DeviceState(models.Model):
    """
    Current actuator state of a greenhouse (1:1).
    Table: greenhouses_devicestate
    """
    ENERGY_BATTERY = 'battery'
    ENERGY_GRID = 'grid'
    ENERGY_CHOICES = [
        (ENERGY_BATTERY, 'Battery'),
        (ENERGY_GRID, 'Grid'),
    ]

    greenhouse = models.OneToOneField(
        Greenhouse,
        on_delete=models.CASCADE,
        primary_key=True,
        related_name='device_state',
    )
    fan_set1 = models.BooleanField(default=False)
    fan_set2 = models.BooleanField(default=False)
    water_pump = models.BooleanField(default=False)
    light = models.BooleanField(default=False)
    energy_state = models.CharField(
        max_length=10,
        choices=ENERGY_CHOICES,
        null=True,
        blank=True,
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'greenhouses_devicestate'
        verbose_name = 'Device State'
        verbose_name_plural = 'Device States'

    def __str__(self):
        return f'State of {self.greenhouse.serial_number}'
