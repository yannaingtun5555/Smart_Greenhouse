from django.apps import AppConfig


class DevicesConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'core.apps.devices'
    label = 'devices'
    verbose_name = 'Devices'
