import logging

from rest_framework import generics, status
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Greenhouse, SensorData, DeviceState, LatestSensorReading
from .serializers import (
    GreenhouseSerializer,
    GreenhouseCreateSerializer,
    SensorDataSerializer,
    LatestSensorReadingSerializer,
    DeviceStateSerializer,
    ControlCommandSerializer,
)
from .utils import mqtt_push_command

logger = logging.getLogger(__name__)


def get_owned_greenhouse(user, pk):
    """
    Return a Greenhouse owned by the user or raise 404/403.
    Excludes soft-deleted greenhouses.
    """
    try:
        gh = Greenhouse.objects.get(pk=pk)
    except Greenhouse.DoesNotExist:
        raise NotFound('Greenhouse not found.')
    if gh.owner != user:
        raise PermissionDenied('You do not own this greenhouse.')
    if gh.status == Greenhouse.STATUS_DELETED:
        raise NotFound('Greenhouse not found.')
    return gh


class GreenhouseListCreateView(generics.ListCreateAPIView):
    """
    GET  /api/v1/greenhouses/        – list owned greenhouses (returns [] if not authed)
    POST /api/v1/greenhouses/        – add new greenhouse (name + serial_number, requires auth)

    Query params:
      ?status=pending|active|offline  – filter by status
    """
    permission_classes = []
    pagination_class = None

    def get_queryset(self):
        # Return empty queryset for unauthenticated users
        if not self.request.user.is_authenticated:
            return Greenhouse.objects.none()
        qs = Greenhouse.objects.filter(
            owner=self.request.user
        ).exclude(status=Greenhouse.STATUS_DELETED)

        status_filter = self.request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)

        return qs.order_by('-created_at')

    def get_serializer_class(self):
        if self.request.method == 'POST':
            return GreenhouseCreateSerializer
        return GreenhouseSerializer

    def create(self, request, *args, **kwargs):
        # Require authentication for creating a greenhouse
        if not request.user.is_authenticated:
            return Response(
                {'detail': 'Authentication credentials were not provided.'},
                status=status.HTTP_401_UNAUTHORIZED,
            )
        serializer = GreenhouseCreateSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        greenhouse = serializer.save()
        return Response(
            GreenhouseSerializer(greenhouse).data,
            status=status.HTTP_201_CREATED,
        )


class GreenhouseDetailView(APIView):
    """
    GET    /api/v1/greenhouses/{id}/  – detail
    DELETE /api/v1/greenhouses/{id}/  – soft delete (status=deleted)
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        gh = get_owned_greenhouse(request.user, pk)
        return Response(GreenhouseSerializer(gh).data)

    def delete(self, request, pk):
        gh = get_owned_greenhouse(request.user, pk)
        gh.status = Greenhouse.STATUS_DELETED
        gh.save(update_fields=['status', 'updated_at'])
        return Response({'detail': 'Greenhouse deleted.'}, status=status.HTTP_200_OK)


class SensorDataListView(generics.ListAPIView):
    """
    GET /api/v1/greenhouses/{id}/sensors/
    Returns paginated sensor readings (latest first).

    Query params:
      ?limit=100  – number of records (default 50)
    """
    permission_classes = [IsAuthenticated]
    serializer_class = SensorDataSerializer

    def get_queryset(self):
        gh = get_owned_greenhouse(self.request.user, self.kwargs['pk'])
        limit = int(self.request.query_params.get('limit', 50))
        limit = min(limit, 500)  # cap at 500
        return SensorData.objects.filter(greenhouse=gh).order_by('-timestamp')[:limit]


class LatestSensorReadingView(APIView):
    """
    GET /api/v1/greenhouses/{id}/sensors/latest/

    Returns the most recent sensor reading for the greenhouse. This is
    updated on every MQTT ingest and is available immediately after a
    Render spin-down wake, even before queued MQTT backlog is processed.

    Response includes ``age_seconds`` (how old the reading is) and
    ``is_stale`` (True if older than 5 minutes) so the frontend can
    display a "last seen X min ago" indicator when the backend was sleeping.
  """
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        gh = get_owned_greenhouse(request.user, pk)
        try:
            reading = gh.latest_reading
        except LatestSensorReading.DoesNotExist:
            return Response(
                {'detail': 'No sensor readings yet.'},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(LatestSensorReadingSerializer(reading).data)


class DeviceStateView(APIView):
    """
    GET /api/v1/greenhouses/{id}/state/
    Returns current device state of the greenhouse.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        gh = get_owned_greenhouse(request.user, pk)
        try:
            state = gh.device_state
        except DeviceState.DoesNotExist:
            # Create a default state record if it doesn't exist yet
            state = DeviceState.objects.create(greenhouse=gh)
        return Response(DeviceStateSerializer(state).data)


class ControlView(APIView):
    """
    PATCH /api/v1/greenhouses/{id}/control/

    Body: {"device": "fan|pump|light", "action": "on|off"}

    Pushes an MQTT command to the ESP32 and updates the DeviceState in DB.
    """
    permission_classes = [IsAuthenticated]

    DEVICE_TO_FIELD = {
        'fan': 'fan',
        'pump': 'water_pump',
        'light': 'light',
    }

    def patch(self, request, pk):
        gh = get_owned_greenhouse(request.user, pk)

        if gh.status != Greenhouse.STATUS_ACTIVE:
            return Response(
                {'detail': 'Greenhouse is not active.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = ControlCommandSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        device = serializer.validated_data['device']
        action = serializer.validated_data['action']
        new_state = action == 'on'

        # Push MQTT command to ESP32
        success = mqtt_push_command(gh, device, action)

        # Update DeviceState in DB regardless of MQTT result
        # (ESP32 will confirm via gh/{serial}/state topic)
        state, _ = DeviceState.objects.get_or_create(greenhouse=gh)
        field = self.DEVICE_TO_FIELD[device]
        setattr(state, field, new_state)
        state.save(update_fields=[field, 'updated_at'])

        return Response({
            'device': device,
            'action': action,
            'mqtt_sent': success,
            'state': DeviceStateSerializer(state).data,
        })
