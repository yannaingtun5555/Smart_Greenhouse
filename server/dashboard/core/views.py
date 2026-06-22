from pathlib import Path

from django.conf import settings
from django.http import FileResponse, Http404


def frontend_index(request):
    index_path = Path(settings.FRONTEND_DIR) / 'index.html'
    if not index_path.exists():
        raise Http404('Frontend index not found.')
    return FileResponse(index_path.open('rb'), content_type='text/html')


def frontend_asset(request, path):
    asset_path = Path(settings.FRONTEND_DIR) / path
    if not asset_path.exists() or not asset_path.is_file():
        raise Http404('Asset not found.')
    content_type = 'text/plain'
    if path.endswith('.css'):
        content_type = 'text/css'
    elif path.endswith('.js'):
        content_type = 'application/javascript'
    elif path.endswith('.html'):
        content_type = 'text/html'
    return FileResponse(asset_path.open('rb'), content_type=content_type)
