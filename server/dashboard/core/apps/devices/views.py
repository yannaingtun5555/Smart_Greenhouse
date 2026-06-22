import logging
import secrets

from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from core.apps.greenhouses.models import Greenhouse, DeviceState

logger = logging.getLogger(__name__)


class DeviceRegisterView(APIView):
    """
    POST /api/v1/devices/register/

    Called by ESP32 on first boot with its serial number.
    Django looks up the Greenhouse by serial_number:
      - Not found            → 404
      - Found, no token yet  → generate token, set status=active, return token
      - Found, token exists  → return existing token (idempotent)

    No user auth required (ESP32 doesn't have a user JWT).
    The serial number itself must already exist in the DB (added by the owner).

    Request body:
        {"serial_number": "GH-001"}

    Response:
        {"api_token": "..."}
    """
    permission_classes = [AllowAny]

    def post(self, request):
        serial_number = request.data.get('serial_number', '').strip()
        if not serial_number:
            return Response(
                {'detail': 'serial_number is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            greenhouse = Greenhouse.objects.get(serial_number=serial_number)
        except Greenhouse.DoesNotExist:
            logger.warning('Device register: unknown serial %s', serial_number)
            return Response(
                {'detail': 'No greenhouse found with this serial number.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        if greenhouse.status == Greenhouse.STATUS_DELETED:
            return Response(
                {'detail': 'Greenhouse has been deleted.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Idempotent: if token already issued, just return it
        if greenhouse.api_token:
            logger.info('Device register: token already exists for %s', serial_number)
            return Response({'api_token': greenhouse.api_token})

        # Generate a secure 64-char hex token
        token = secrets.token_hex(32)
        greenhouse.api_token = token
        greenhouse.status = Greenhouse.STATUS_ACTIVE
        greenhouse.save(update_fields=['api_token', 'status', 'updated_at'])

        # Ensure a DeviceState row exists
        DeviceState.objects.get_or_create(greenhouse=greenhouse)

        logger.info('Device register: token issued for %s', serial_number)
        return Response({'api_token': token}, status=status.HTTP_201_CREATED)
