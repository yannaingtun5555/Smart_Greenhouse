from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from core.apps.greenhouses.models import Greenhouse, DeviceState

User = get_user_model()


class AuthAPITests(APITestCase):
    def test_register_and_login(self):
        register_url = reverse('auth-register')
        response = self.client.post(register_url, {
            'username': 'grower1',
            'email': 'grower1@example.com',
            'password': 'StrongPass123!',
            'password2': 'StrongPass123!',
            'first_name': 'Green',
            'last_name': 'Grower',
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['username'], 'grower1')

        login_url = reverse('auth-login')
        response = self.client.post(login_url, {
            'username': 'grower1',
            'password': 'StrongPass123!',
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('access', response.data)
        self.assertIn('refresh', response.data)


class GreenhouseAPITests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='owner',
            email='owner@example.com',
            password='StrongPass123!',
        )
        self.client.force_authenticate(user=self.user)

    def test_create_and_list_greenhouse(self):
        create_url = reverse('greenhouse-list-create')
        response = self.client.post(create_url, {
            'name': 'Main House',
            'serial_number': 'GH-001',
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['status'], Greenhouse.STATUS_PENDING)

        response = self.client.get(create_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['results']), 1)

    def test_soft_delete_greenhouse(self):
        gh = Greenhouse.objects.create(
            owner=self.user,
            name='Delete Me',
            serial_number='GH-DEL',
        )
        detail_url = reverse('greenhouse-detail', kwargs={'pk': gh.pk})
        response = self.client.delete(detail_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        gh.refresh_from_db()
        self.assertEqual(gh.status, Greenhouse.STATUS_DELETED)


class DeviceRegisterAPITests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='owner2',
            email='owner2@example.com',
            password='StrongPass123!',
        )
        self.greenhouse = Greenhouse.objects.create(
            owner=self.user,
            name='Device House',
            serial_number='GH-DEV',
        )

    def test_device_register_issues_token(self):
        url = reverse('device-register')
        response = self.client.post(url, {'serial_number': 'GH-DEV'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(response.data['api_token'])

        self.greenhouse.refresh_from_db()
        self.assertEqual(self.greenhouse.status, Greenhouse.STATUS_ACTIVE)
        self.assertTrue(DeviceState.objects.filter(greenhouse=self.greenhouse).exists())

    def test_device_register_is_idempotent(self):
        url = reverse('device-register')
        first = self.client.post(url, {'serial_number': 'GH-DEV'}, format='json')
        second = self.client.post(url, {'serial_number': 'GH-DEV'}, format='json')
        self.assertEqual(first.data['api_token'], second.data['api_token'])


class ScheduleAPITests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='scheduler',
            email='scheduler@example.com',
            password='StrongPass123!',
        )
        self.greenhouse = Greenhouse.objects.create(
            owner=self.user,
            name='Schedule House',
            serial_number='GH-SCH',
            status=Greenhouse.STATUS_ACTIVE,
        )
        self.client.force_authenticate(user=self.user)

    def test_create_time_schedule(self):
        url = reverse('schedule-list-create', kwargs={'gh_pk': self.greenhouse.pk})
        response = self.client.post(url, {
            'device_type': 'fan',
            'condition_type': 'time',
            'time_of_day': '08:30:00',
            'action': 'on',
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['condition_type'], 'time')

    def test_create_sensor_schedule(self):
        url = reverse('schedule-list-create', kwargs={'gh_pk': self.greenhouse.pk})
        response = self.client.post(url, {
            'device_type': 'pump',
            'condition_type': 'sensor',
            'sensor_name': 'soil_moisture',
            'operator': '<',
            'threshold': 30.0,
            'action': 'on',
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['sensor_name'], 'soil_moisture')
