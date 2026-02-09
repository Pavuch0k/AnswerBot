"""
Redis-based event logger for user actions
"""
import json
import redis
import os
import logging
from datetime import datetime
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)

class EventLogger:
    """Класс для логирования событий пользователей в Redis"""
    
    def __init__(self):
        self.redis_host = os.getenv('REDIS_HOST', 'localhost')
        self.redis_port = int(os.getenv('REDIS_PORT', 6379))
        self.redis_db = int(os.getenv('REDIS_DB', 0))
        self.redis_queue_key = 'user_events_queue'
        
        try:
            self.redis_client = redis.Redis(
                host=self.redis_host,
                port=self.redis_port,
                db=self.redis_db,
                decode_responses=True,
                socket_connect_timeout=5,
                socket_timeout=5
            )
            # Проверяем подключение
            self.redis_client.ping()
            logger.info(f"Connected to Redis at {self.redis_host}:{self.redis_port}")
        except Exception as e:
            logger.error(f"Failed to connect to Redis: {e}")
            self.redis_client = None
    
    def log_event(
        self,
        telegram_id: int,
        action_type: str,
        username: Optional[str] = None,
        first_name: Optional[str] = None,
        last_name: Optional[str] = None,
        node_id: Optional[int] = None,
        button_id: Optional[int] = None,
        session_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> bool:
        """
        Логирует событие пользователя в Redis очередь
        
        Args:
            telegram_id: Telegram chat_id пользователя
            action_type: Тип действия (start, button_click, back, home, message_view)
            username: Username пользователя
            first_name: Имя пользователя
            last_name: Фамилия пользователя
            node_id: ID узла (если применимо)
            button_id: ID кнопки (если применимо)
            session_id: ID сессии для группировки действий
            metadata: Дополнительные метаданные в виде словаря
            
        Returns:
            True если событие успешно добавлено в очередь, False в противном случае
        """
        if not self.redis_client:
            logger.warning("Redis client not available, event not logged")
            return False
        
        try:
            event = {
                'telegram_id': telegram_id,
                'action_type': action_type,
                'username': username,
                'first_name': first_name,
                'last_name': last_name,
                'node_id': node_id,
                'button_id': button_id,
                'session_id': session_id,
                'metadata': json.dumps(metadata) if metadata else None,
                'timestamp': datetime.now().isoformat()
            }
            
            # Удаляем None значения для экономии места
            event = {k: v for k, v in event.items() if v is not None}
            
            # Добавляем событие в очередь Redis (список)
            self.redis_client.lpush(self.redis_queue_key, json.dumps(event))
            
            logger.debug(f"Event logged: {action_type} for user {telegram_id}")
            return True
            
        except Exception as e:
            logger.error(f"Error logging event to Redis: {e}")
            return False
    
    def get_queue_length(self) -> int:
        """Возвращает длину очереди событий"""
        if not self.redis_client:
            return 0
        try:
            return self.redis_client.llen(self.redis_queue_key)
        except Exception as e:
            logger.error(f"Error getting queue length: {e}")
            return 0

# Глобальный экземпляр логгера
event_logger = EventLogger()




