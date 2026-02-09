"""
Фоновый воркер для обработки событий пользователей из Redis и сохранения в PostgreSQL
"""
import os
import sys
import json
import logging
import time
from datetime import datetime
from typing import Optional

# Добавляем корневую директорию в путь
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import redis
from database.models import db, User, UserAction, initialize_db
from utils.event_logger import EventLogger

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('logs/worker.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

class EventWorker:
    """Воркер для обработки событий из Redis"""
    
    def __init__(self):
        self.redis_host = os.getenv('REDIS_HOST', 'localhost')
        self.redis_port = int(os.getenv('REDIS_PORT', 6379))
        self.redis_db = int(os.getenv('REDIS_DB', 0))
        self.redis_queue_key = 'user_events_queue'
        self.batch_size = 50  # Обрабатываем события батчами
        self.poll_interval = 1  # Интервал проверки очереди в секундах
        
        # Подключение к Redis
        try:
            self.redis_client = redis.Redis(
                host=self.redis_host,
                port=self.redis_port,
                db=self.redis_db,
                decode_responses=True,
                socket_connect_timeout=5,
                socket_timeout=5
            )
            self.redis_client.ping()
            logger.info(f"Connected to Redis at {self.redis_host}:{self.redis_port}")
        except Exception as e:
            logger.error(f"Failed to connect to Redis: {e}")
            raise
        
        # Подключение к БД
        try:
            initialize_db()
            db.connect()
            logger.info("Connected to database")
        except Exception as e:
            logger.error(f"Failed to connect to database: {e}")
            raise
    
    def get_or_create_user(self, telegram_id: int, username: Optional[str] = None,
                          first_name: Optional[str] = None, last_name: Optional[str] = None) -> User:
        """Получает или создает пользователя"""
        try:
            user = User.get(User.telegram_id == telegram_id)
            # Обновляем данные пользователя если они изменились
            updated = False
            if username and user.username != username:
                user.username = username
                updated = True
            if first_name and user.first_name != first_name:
                user.first_name = first_name
                updated = True
            if last_name and user.last_name != last_name:
                user.last_name = last_name
                updated = True
            if updated:
                user.last_active_at = datetime.now()
                user.save()
            else:
                # Обновляем last_active_at даже если данные не изменились
                user.last_active_at = datetime.now()
                user.save()
            return user
        except User.DoesNotExist:
            user = User.create(
                telegram_id=telegram_id,
                username=username,
                first_name=first_name,
                last_name=last_name,
                last_active_at=datetime.now()
            )
            logger.info(f"Created new user: {telegram_id}")
            return user
    
    def process_event(self, event_data: dict) -> bool:
        """Обрабатывает одно событие"""
        try:
            telegram_id = event_data.get('telegram_id')
            if not telegram_id:
                logger.warning("Event missing telegram_id, skipping")
                return False
            
            # Получаем или создаем пользователя
            user = self.get_or_create_user(
                telegram_id=telegram_id,
                username=event_data.get('username'),
                first_name=event_data.get('first_name'),
                last_name=event_data.get('last_name')
            )
            
            # Парсим timestamp
            timestamp_str = event_data.get('timestamp')
            if timestamp_str:
                try:
                    timestamp = datetime.fromisoformat(timestamp_str)
                except:
                    timestamp = datetime.now()
            else:
                timestamp = datetime.now()
            
            # Создаем запись о действии
            UserAction.create(
                user=user,
                action_type=event_data.get('action_type', 'unknown'),
                node_id=event_data.get('node_id'),
                button_id=event_data.get('button_id'),
                session_id=event_data.get('session_id'),
                metadata=event_data.get('metadata'),
                created_at=timestamp
            )
            
            return True
            
        except Exception as e:
            logger.error(f"Error processing event: {e}")
            logger.error(f"Event data: {event_data}")
            return False
    
    def process_batch(self) -> int:
        """Обрабатывает батч событий из Redis"""
        processed = 0
        events = []
        
        # Получаем события из очереди (правая часть списка - FIFO)
        for _ in range(self.batch_size):
            try:
                event_json = self.redis_client.rpop(self.redis_queue_key)
                if not event_json:
                    break
                events.append(json.loads(event_json))
            except Exception as e:
                logger.error(f"Error reading event from Redis: {e}")
                break
        
        if not events:
            return 0
        
        # Обрабатываем события в транзакции
        try:
            with db.atomic():
                for event in events:
                    if self.process_event(event):
                        processed += 1
        except Exception as e:
            logger.error(f"Error processing batch: {e}")
            # Возвращаем события обратно в очередь при ошибке
            for event in events:
                try:
                    self.redis_client.lpush(self.redis_queue_key, json.dumps(event))
                except:
                    pass
        
        if processed > 0:
            logger.info(f"Processed {processed} events")
        
        return processed
    
    def run(self):
        """Основной цикл воркера"""
        logger.info("Event worker started")
        
        try:
            while True:
                try:
                    queue_length = self.redis_client.llen(self.redis_queue_key)
                    if queue_length > 0:
                        processed = self.process_batch()
                        if processed == 0:
                            time.sleep(self.poll_interval)
                    else:
                        time.sleep(self.poll_interval)
                except KeyboardInterrupt:
                    logger.info("Received interrupt signal, shutting down...")
                    break
                except Exception as e:
                    logger.error(f"Error in worker loop: {e}")
                    time.sleep(self.poll_interval)
        finally:
            db.close()
            logger.info("Event worker stopped")

def main():
    """Точка входа для воркера"""
    try:
        worker = EventWorker()
        worker.run()
    except Exception as e:
        logger.error(f"Failed to start worker: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()




