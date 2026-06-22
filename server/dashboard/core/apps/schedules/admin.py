from django.contrib import admin

from .models import Schedule


@admin.register(Schedule)
class ScheduleAdmin(admin.ModelAdmin):
    list_display = [
        'greenhouse', 'condition_type', 'device_type', 'action',
        'time_of_day', 'sensor_name', 'operator', 'threshold', 'created_at',
    ]
    list_filter = ['condition_type', 'device_type', 'action', 'greenhouse']
