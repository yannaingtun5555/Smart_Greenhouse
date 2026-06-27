from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('greenhouses', '0002_latestsensorreading'),
    ]

    operations = [
        # Rename fan → fan_set1, add fan_set2
        migrations.RenameField(
            model_name='devicestate',
            old_name='fan',
            new_name='fan_set1',
        ),
        migrations.AddField(
            model_name='devicestate',
            name='fan_set2',
            field=models.BooleanField(default=False),
        ),
    ]
