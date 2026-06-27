from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('schedules', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='schedule',
            name='fan_target',
            field=models.CharField(
                blank=True,
                choices=[('all', 'All Sets'), ('set1', 'Set 1'), ('set2', 'Set 2')],
                default='all',
                help_text='Which fan set to control (only when device_type=fan).',
                max_length=10,
                null=True,
            ),
        ),
    ]
