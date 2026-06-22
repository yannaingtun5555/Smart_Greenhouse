from django.urls import path

from .views import ScheduleListCreateView, ScheduleDetailView

urlpatterns = [
    # List + create schedules for a greenhouse
    path(
        'greenhouses/<int:gh_pk>/schedules/',
        ScheduleListCreateView.as_view(),
        name='schedule-list-create',
    ),
    # Detail, update, delete a specific schedule
    path(
        'greenhouses/<int:gh_pk>/schedules/<int:sid>/',
        ScheduleDetailView.as_view(),
        name='schedule-detail',
    ),
]
