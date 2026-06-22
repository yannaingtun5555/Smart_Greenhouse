from django.contrib import admin
from django.urls import path, include, re_path

from .views import frontend_index, frontend_asset

urlpatterns = [
    path('admin/', admin.site.urls),
    path('', frontend_index, name='frontend-index'),
    re_path(r'^(?P<path>(?!api/|admin/).+)$', frontend_asset, name='frontend-asset'),

    # Authentication (register, login, token refresh, me)
    path('api/v1/auth/', include('core.apps.accounts.urls')),

    # Greenhouse + sensors + device control
    path('api/v1/', include('core.apps.greenhouses.urls')),

    # ESP32 device provisioning
    path('api/v1/devices/', include('core.apps.devices.urls')),

    # Schedules (nested under greenhouses)
    path('api/v1/', include('core.apps.schedules.urls')),

    # Staff panel
    path('api/v1/staff/', include('core.apps.staff.urls')),
]
