import os
import secrets
from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model


class Command(BaseCommand):
    help = "Create an initial superuser if none exists (idempotent)."

    def handle(self, *args, **kwargs):
        User = get_user_model()

        if User.objects.filter(is_superuser=True).exists():
            self.stdout.write(self.style.SUCCESS("Superuser already exists, skipping."))
            return

        username = os.getenv("DOKO_ADMIN_USERNAME", "admin")
        email = os.getenv("DOKO_ADMIN_EMAIL", "admin@local")
        password = os.getenv("DOKO_ADMIN_PASSWORD")
        generated_password = False

        if not password:
            password = secrets.token_urlsafe(18)
            generated_password = True

        User.objects.create_superuser(username=username, email=email, password=password)

        self.stdout.write(self.style.WARNING("=============================================="))
        self.stdout.write(self.style.WARNING(" DOKO INITIAL SUPERUSER CREATED"))
        self.stdout.write(self.style.WARNING(f" Username: {username}"))
        self.stdout.write(self.style.WARNING(f" Email:    {email}"))

        if generated_password:
            self.stdout.write(self.style.WARNING(f" Password: {password}"))
        else:
            self.stdout.write(self.style.WARNING(" Password: provided by DOKO_ADMIN_PASSWORD"))

        self.stdout.write(self.style.WARNING(" IMPORTANT: change this password after login."))
        self.stdout.write(self.style.WARNING("=============================================="))