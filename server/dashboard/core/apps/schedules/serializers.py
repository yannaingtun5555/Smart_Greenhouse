from rest_framework import serializers

from .models import Schedule


class ScheduleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Schedule
        fields = [
            'id', 'greenhouse', 'device_type', 'condition_type',
            'time_of_day', 'sensor_name', 'operator', 'threshold',
            'action', 'created_at',
        ]
        read_only_fields = ['id', 'greenhouse', 'created_at']

    def validate(self, attrs):
        condition_type = attrs.get('condition_type')
        if condition_type is None and self.instance is not None:
            condition_type = self.instance.condition_type

        if condition_type == Schedule.CONDITION_TIME:
            if not attrs.get('time_of_day'):
                raise serializers.ValidationError(
                    {'time_of_day': 'Required for time-based schedules.'}
                )
            # Clear sensor fields
            attrs['sensor_name'] = None
            attrs['operator'] = None
            attrs['threshold'] = None

        elif condition_type == Schedule.CONDITION_SENSOR:
            missing = []
            if not attrs.get('sensor_name'):
                missing.append('sensor_name')
            if not attrs.get('operator'):
                missing.append('operator')
            if attrs.get('threshold') is None:
                missing.append('threshold')
            if missing:
                raise serializers.ValidationError(
                    {f: 'Required for sensor-based schedules.' for f in missing}
                )
            # Clear time field
            attrs['time_of_day'] = None

        else:
            raise serializers.ValidationError(
                {'condition_type': 'Must be "time" or "sensor".'}
            )

        return attrs
