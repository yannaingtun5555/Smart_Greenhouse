from django.urls import path

from .views import DeviceRegisterView

urlpatterns = [
    # ESP32 calls this on first boot to get its API token
    path('register/', DeviceRegisterView.as_view(), name='device-register'),
]
