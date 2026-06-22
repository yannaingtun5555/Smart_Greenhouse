from rest_framework import serializers

from .models import Greenhouse, SensorData, DeviceState


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
