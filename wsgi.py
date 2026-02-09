#!/usr/bin/env python3
"""
WSGI приложение для запуска AnswerBot через Gunicorn
Запускает только админку, бот запускается отдельно
"""

import os
import sys
from pathlib import Path

# Добавляем путь к проекту
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

# Импортируем Flask приложение
from admin.app import app
from database.models import initialize_db

# Инициализируем БД при запуске
initialize_db()

# WSGI приложение (только админка)
application = app

if __name__ == "__main__":
    # Для локального тестирования
    app.run(host='0.0.0.0', port=5000, debug=True)
