import logging

from rest_framework import status
from rest_framework.exceptions import NotFound
from rest_framework.permissions import IsAdminUser, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.apps.greenhouses.models import Greenhouse
from core.apps.greenhouses.serializers import GreenhouseSerializer

logger = logging.getLogger(__name__)


class StaffGreenhouseListView(APIView):
    """
    GET /api/v1/staff/greenhouses/

    Staff-only: list ALL greenhouses system-wide.
    Supports filtering by status via ?status= query param.
    """
    permission_classes = [IsAuthenticated, IsAdminUser]

    def get(self, request):
        qs = Greenhouse.objects.select_related('owner').order_by('-created_at')

        status_filter = request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)

        serializer = GreenhouseSerializer(qs, many=True)
        return Response(serializer.data)


class StaffNotificationsView(APIView):
    """
    GET /api/v1/staff/notifications/

    Staff-only: list of greenhouses with status=pending.
    These are newly added greenhouses awaiting ESP32 activation.
    """
    permission_classes = [IsAuthenticated, IsAdminUser]

    def get(self, request):
        pending = Greenhouse.objects.filter(
            status=Greenhouse.STATUS_PENDING
        ).select_related('owner').order_by('-created_at')

        data = []
        for gh in pending:
            data.append({
                'id': gh.id,
                'name': gh.name,
                'serial_number': gh.serial_number,
                'owner': gh.owner.username,
                'owner_email': gh.owner.email,
                'created_at': gh.created_at,
                'status': gh.status,
            })

        return Response({'count': len(data), 'results': data})


class StaffGreenhouseStatusView(APIView):
    """
    PATCH /api/v1/staff/greenhouses/{id}/status/

    Staff-only: manually change a greenhouse status.
    Body: {"status": "active|pending|offline|deleted"}
    """
    permission_classes = [IsAuthenticated, IsAdminUser]

    ALLOWED_STATUSES = [
        Greenhouse.STATUS_PENDING,
        Greenhouse.STATUS_ACTIVE,
        Greenhouse.STATUS_OFFLINE,
        Greenhouse.STATUS_DELETED,
    ]

    def patch(self, request, pk):
        try:
            gh = Greenhouse.objects.get(pk=pk)
        except Greenhouse.DoesNotExist:
            raise NotFound('Greenhouse not found.')

        new_status = request.data.get('status', '').strip()
        if new_status not in self.ALLOWED_STATUSES:
            return Response(
                {'detail': f'Invalid status. Choices: {self.ALLOWED_STATUSES}'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        gh.status = new_status
        gh.save(update_fields=['status', 'updated_at'])

        logger.info(
            'Staff %s changed greenhouse %s status to %s',
            request.user.username, gh.serial_number, new_status,
        )

        return Response(GreenhouseSerializer(gh).data)
