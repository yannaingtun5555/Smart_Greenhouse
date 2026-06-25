import math

from django.utils import timezone
from rest_framework import serializers

from .models import Greenhouse, SensorData, DeviceState, LatestSensorReading


class GreenhouseSerializer(serializers.ModelSerializer):
    owner_username = serializers.CharField(source='owner.username', read_only=True)

    class Meta:
        model = Greenhouse
        fields = [
            'id', 'owner_username', 'serial_number', 'name',
            'status', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'owner_username', 'status', 'created_at', 'updated_at']


class GreenhouseCreateSerializer(serializers.ModelSerializer):
    """Used only for creating a new greenhouse (name + serial_number)."""

    class Meta:
        model = Greenhouse
        fields = ['name', 'serial_number']

    def validate_serial_number(self, value):
        if Greenhouse.objects.filter(serial_number=value).exists():
            raise serializers.ValidationError('A greenhouse with this serial number already exists.')
        return value

    def create(self, validated_data):
        user = self.context['request'].user
        return Greenhouse.objects.create(owner=user, **validated_data)


class SensorDataSerializer(serializers.ModelSerializer):
    class Meta:
        model = SensorData
        fields = [
            'id', 'greenhouse', 'timestamp',
            'temperature', 'humidity', 'soil_moisture', 'light_intensity', 'battery',
        ]
        read_only_fields = fields


class LatestSensorReadingSerializer(serializers.ModelSerializer):
    """Includes staleness info so the frontend can show 'last seen X min ago'."""
    age_seconds = serializers.SerializerMethodField()
    is_stale = serializers.SerializerMethodField()

    class Meta:
        model = LatestSensorReading
        fields = [
            'greenhouse_id', 'timestamp',
            'temperature', 'humidity', 'soil_moisture', 'light_intensity', 'battery',
            'age_seconds', 'is_stale',
        ]
        read_only_fields = fields

    def get_age_seconds(self, obj):
        """Seconds since this reading was taken (null if never)."""
        if obj.timestamp:
            delta = timezone.now() - obj.timestamp
            return max(0, math.floor(delta.total_seconds()))
        return None

    def get_is_stale(self, obj):
        """True if reading is older than 5 minutes (backend may have been sleeping)."""
        if obj.timestamp:
            delta = timezone.now() - obj.timestamp
            return delta.total_seconds() > 300  # 5 minutes
        return True


class DeviceStateSerializer(serializers.ModelSerializer):
    class Meta:
        model = DeviceState
        fields = ['greenhouse_id', 'fan', 'water_pump', 'light', 'energy_state', 'updated_at']
        read_only_fields = ['greenhouse_id', 'updated_at']


class ControlCommandSerializer(serializers.Serializer):
    """Validates a real-time control command from the frontend."""
    DEVICE_CHOICES = ['fan', 'pump', 'light']
    ACTION_CHOICES = ['on', 'off']

    device = serializers.ChoiceField(choices=DEVICE_CHOICES)
    action = serializers.ChoiceField(choices=ACTION_CHOICES)
