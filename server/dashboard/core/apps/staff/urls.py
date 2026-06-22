from django.urls import path

from .views import (
    StaffGreenhouseListView,
    StaffNotificationsView,
    StaffGreenhouseStatusView,
)

urlpatterns = [
    # All greenhouses system-wide (staff only)
    path('greenhouses/', StaffGreenhouseListView.as_view(), name='staff-greenhouse-list'),

    # Pending greenhouse notifications (staff only)
    path('notifications/', StaffNotificationsView.as_view(), name='staff-notifications'),

    # Manually change a greenhouse status (staff only)
    path('greenhouses/<int:pk>/status/', StaffGreenhouseStatusView.as_view(), name='staff-greenhouse-status'),
]
