from django.urls import path
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from .views import RegisterView, MeView

urlpatterns = [
    # POST  – register new user
    path('register/', RegisterView.as_view(), name='auth-register'),

    # POST  – obtain JWT tokens (login)
    path('login/', TokenObtainPairView.as_view(), name='auth-login'),

    # POST  – refresh access token
    path('token/refresh/', TokenRefreshView.as_view(), name='auth-token-refresh'),

    # GET / PATCH – current user profile
    path('me/', MeView.as_view(), name='auth-me'),
]
