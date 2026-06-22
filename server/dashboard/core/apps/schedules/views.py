import logging

from rest_framework import status
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.apps.greenhouses.models import Greenhouse
from core.apps.greenhouses.utils import mqtt_push_schedules
from .models import Schedule
from .serializers import ScheduleSerializer

logger = logging.getLogger(__name__)


def get_owned_greenhouse(user, gh_pk):
    try:
        gh = Greenhouse.objects.get(pk=gh_pk)
    except Greenhouse.DoesNotExist:
        raise NotFound('Greenhouse not found.')
    if gh.owner != user:
        raise PermissionDenied('You do not own this greenhouse.')
    if gh.status == Greenhouse.STATUS_DELETED:
        raise NotFound('Greenhouse not found.')
    return gh


class ScheduleListCreateView(APIView):
    """
    GET  /api/v1/greenhouses/{id}/schedules/  – list all schedules
    POST /api/v1/greenhouses/{id}/schedules/  – create a schedule
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, gh_pk):
        gh = get_owned_greenhouse(request.user, gh_pk)
        schedules = Schedule.objects.filter(greenhouse=gh)
        return Response(ScheduleSerializer(schedules, many=True).data)

    def post(self, request, gh_pk):
        gh = get_owned_greenhouse(request.user, gh_pk)
        serializer = ScheduleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        schedule = serializer.save(greenhouse=gh)

        # Push updated schedule list to ESP32
        mqtt_push_schedules(gh)

        return Response(ScheduleSerializer(schedule).data, status=status.HTTP_201_CREATED)


class ScheduleDetailView(APIView):
    """
    GET    /api/v1/greenhouses/{id}/schedules/{sid}/
    PUT    /api/v1/greenhouses/{id}/schedules/{sid}/
    DELETE /api/v1/greenhouses/{id}/schedules/{sid}/
    """
    permission_classes = [IsAuthenticated]

    def _get_schedule(self, request, gh_pk, sid):
        gh = get_owned_greenhouse(request.user, gh_pk)
        try:
            return gh, Schedule.objects.get(pk=sid, greenhouse=gh)
        except Schedule.DoesNotExist:
            raise NotFound('Schedule not found.')

    def get(self, request, gh_pk, sid):
        _, schedule = self._get_schedule(request, gh_pk, sid)
        return Response(ScheduleSerializer(schedule).data)

    def put(self, request, gh_pk, sid):
        gh, schedule = self._get_schedule(request, gh_pk, sid)
        serializer = ScheduleSerializer(schedule, data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()

        # Push updated schedule list to ESP32
        mqtt_push_schedules(gh)

        return Response(ScheduleSerializer(schedule).data)

    def patch(self, request, gh_pk, sid):
        gh, schedule = self._get_schedule(request, gh_pk, sid)
        serializer = ScheduleSerializer(schedule, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()

        mqtt_push_schedules(gh)

        return Response(ScheduleSerializer(schedule).data)

    def delete(self, request, gh_pk, sid):
        gh, schedule = self._get_schedule(request, gh_pk, sid)
        schedule.delete()

        # Push updated schedule list (now without this schedule) to ESP32
        mqtt_push_schedules(gh)

        return Response(status=status.HTTP_204_NO_CONTENT)
