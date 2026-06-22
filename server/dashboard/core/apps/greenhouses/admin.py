from django.contrib import admin

from .models import Greenhouse, SensorData, DeviceState


@admin.register(Greenhouse)
class GreenhouseAdmin(admin.ModelAdmin):
    list_display = ['name', 'serial_number', 'owner', 'status', 'created_at']
    list_filter = ['status']
    search_fields = ['name', 'serial_number', 'owner__username']
    readonly_fields = ['api_token', 'created_at', 'updated_at']


@admin.register(SensorData)
class SensorDataAdmin(admin.ModelAdmin):
    list_display = ['greenhouse', 'timestamp', 'temperature', 'humidity', 'soil_moisture']
    list_filter = ['greenhouse']
    readonly_fields = ['timestamp']


@admin.register(DeviceState)
class DeviceStateAdmin(admin.ModelAdmin):
    list_display = ['greenhouse', 'fan', 'water_pump', 'light', 'energy_state', 'updated_at']
