from django.contrib import admin
from django.urls import path, include, re_path

from .views import frontend_index, frontend_asset

urlpatterns = [
    path('admin/', admin.site.urls),

    # API (must stay above the frontend catch-all)
    path('api/v1/auth/', include('core.apps.accounts.urls')),
    path('api/v1/', include('core.apps.greenhouses.urls')),
    path('api/v1/devices/', include('core.apps.devices.urls')),
    path('api/v1/', include('core.apps.schedules.urls')),
    path('api/v1/staff/', include('core.apps.staff.urls')),

    # React SPA (built Vite output in frontend/dist)
    path('', frontend_index, name='frontend-index'),
    re_path(r'^(?P<path>(?!api/|admin/).+)$', frontend_asset, name='frontend-asset'),
]
