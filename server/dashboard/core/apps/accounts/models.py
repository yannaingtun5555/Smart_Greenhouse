from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    """
    Custom user model.
    Extends Django's AbstractUser with an extra phone field.
    Table name: accounts_user (matches schema.sql)
    """
    email = models.EmailField(unique=True)
    phone = models.CharField(max_length=15, blank=True, null=True)

    # AbstractUser already has: username, password, first_name, last_name,
    # is_staff, is_active, date_joined

    class Meta:
        db_table = 'accounts_user'
        verbose_name = 'User'
        verbose_name_plural = 'Users'

    def __str__(self):
        return self.username
