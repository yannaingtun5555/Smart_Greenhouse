from django.conf import settings


class DevLanHostMiddleware:
    """Allow the request Host in DEBUG so phones/tablets can reach the dev server."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if settings.DEBUG:
            host = (request.META.get('HTTP_HOST') or '').split(':')[0]
            if host and host not in settings.ALLOWED_HOSTS:
                settings.ALLOWED_HOSTS = [*settings.ALLOWED_HOSTS, host]
        return self.get_response(request)
