from django.urls import path

from .views import (
    GreenhouseListCreateView,
    GreenhouseDetailView,
    SensorDataListView,
    LatestSensorReadingView,
    DeviceStateView,
    ControlView,
)

urlpatterns = [
    # Greenhouse CRUD
    path('greenhouses/', GreenhouseListCreateView.as_view(), name='greenhouse-list-create'),
    path('greenhouses/<int:pk>/', GreenhouseDetailView.as_view(), name='greenhouse-detail'),

    # Sensor data (read-only)
    path('greenhouses/<int:pk>/sensors/', SensorDataListView.as_view(), name='greenhouse-sensors'),
    path('greenhouses/<int:pk>/sensors/latest/', LatestSensorReadingView.as_view(), name='greenhouse-sensors-latest'),

    # Device state
    path('greenhouses/<int:pk>/state/', DeviceStateView.as_view(), name='greenhouse-state'),

    # Real-time control command → MQTT push
    path('greenhouses/<int:pk>/control/', ControlView.as_view(), name='greenhouse-control'),
]
