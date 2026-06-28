import mimetypes
from pathlib import Path

from django.conf import settings
from django.http import FileResponse, Http404


def _serve_file(path: Path):
    if not path.exists() or not path.is_file():
        return None
    content_type, _ = mimetypes.guess_type(str(path))
    return FileResponse(path.open('rb'), content_type=content_type or 'application/octet-stream')


def frontend_index(request):
    index_path = Path(settings.FRONTEND_DIR) / 'index.html'
    response = _serve_file(index_path)
    if response:
        return response
    raise Http404('Frontend index not found.')


def frontend_asset(request, path):
    asset_path = Path(settings.FRONTEND_DIR) / path
    response = _serve_file(asset_path)
    if response:
        return response

    # React Router paths (e.g. /overview) — serve SPA shell
    if '.' not in Path(path).name:
        index_path = Path(settings.FRONTEND_DIR) / 'index.html'
        response = _serve_file(index_path)
        if response:
            return response

    raise Http404('Asset not found.')
