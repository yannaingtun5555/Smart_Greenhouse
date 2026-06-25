"""
WSGI config for core project.

It exposes the WSGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/6.0/howto/deployment/wsgi/
"""

import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')

application = get_wsgi_application()

# On hosting providers that cannot run a separate background worker for free
# (e.g. Render free tier), start the in-process MQTT subscriber here. It is a
# no-op unless MQTT_WORKER_IN_PROCESS=true, so local dev is unaffected.
try:
    from core import mqtt_runtime
    mqtt_runtime.start()
except Exception:  # never let a subscriber failure break web boot
    import logging
    logging.getLogger('core.mqtt_runtime').exception('MQTT runtime failed to start')
