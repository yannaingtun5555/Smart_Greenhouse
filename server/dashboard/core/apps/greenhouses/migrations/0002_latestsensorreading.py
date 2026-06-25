from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('greenhouses', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='LatestSensorReading',
            fields=[
                ('greenhouse', models.OneToOneField(
                    on_delete=django.db.models.deletion.CASCADE,
                    primary_key=True,
                    related_name='latest_reading',
                    serialize=False,
                    to='greenhouses.greenhouse',
                )),
                ('timestamp', models.DateTimeField()),
                ('temperature', models.FloatField()),
                ('humidity', models.FloatField()),
                ('soil_moisture', models.FloatField(blank=True, null=True)),
                ('light_intensity', models.FloatField(blank=True, null=True)),
                ('battery', models.FloatField(blank=True, null=True)),
            ],
            options={
                'verbose_name': 'Latest Sensor Reading',
                'verbose_name_plural': 'Latest Sensor Readings',
                'db_table': 'greenhouses_latestsensorreading',
            },
        ),
    ]
