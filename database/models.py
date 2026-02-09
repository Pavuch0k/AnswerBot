from peewee import *
from datetime import datetime
import os
from playhouse.pool import PooledPostgresqlDatabase
from playhouse.postgres_ext import PostgresqlDatabase

# Определяем тип базы данных из DATABASE_URL
database_url = os.getenv('DATABASE_URL', 'sqlite:///answerbot.db')

if database_url.startswith('postgresql://') or database_url.startswith('postgres://'):
    # Парсим PostgreSQL URL: postgresql://user:password@host:port/dbname
    import re
    match = re.match(r'postgres(ql)?://([^:]+):([^@]+)@([^:]+):(\d+)/(.+)', database_url)
    if match:
        user, password, host, port, dbname = match.groups()[1:]
        db = PooledPostgresqlDatabase(
            dbname,
            user=user,
            password=password,
            host=host,
            port=int(port),
            max_connections=20,
            stale_timeout=300
        )
    else:
        # Fallback на SQLite если не удалось распарсить
        db_path = database_url.replace('sqlite:///', '')
        db = SqliteDatabase(db_path)
else:
    # SQLite для обратной совместимости
    db_path = database_url.replace('sqlite:///', '')
    db = SqliteDatabase(db_path)

class BaseModel(Model):
    class Meta:
        database = db

class Node(BaseModel):
    id = AutoField()
    type = CharField()  # message, button, start
    name = CharField(null=True)  # Название блока, отображается сверху
    text = TextField(null=True)
    x = IntegerField(default=0)
    y = IntegerField(default=0)
    width = IntegerField(default=200)
    height = IntegerField(default=80)
    created_at = DateTimeField(default=datetime.now)
    updated_at = DateTimeField(default=datetime.now)

class NodeConnection(BaseModel):
    id = AutoField()
    source_node = ForeignKeyField(Node, backref='outputs')
    target_node = ForeignKeyField(Node, backref='inputs')
    button_text = CharField(default='Button')
    created_at = DateTimeField(default=datetime.now)

class MediaFile(BaseModel):
    id = AutoField()
    filename = CharField()
    original_name = CharField()
    file_type = CharField()  # image, document, audio, video
    file_size = IntegerField()
    node = ForeignKeyField(Node, backref='media_files', null=True)
    uploaded_at = DateTimeField(default=datetime.now)

class ButtonStyle(BaseModel):
    id = AutoField()
    name = CharField()
    style_data = TextField()  # JSON with style settings
    created_at = DateTimeField(default=datetime.now)

class User(BaseModel):
    id = AutoField()
    telegram_id = BigIntegerField(unique=True, index=True)  # Telegram chat_id
    username = CharField(null=True, index=True)
    first_name = CharField(null=True)
    last_name = CharField(null=True)
    created_at = DateTimeField(default=datetime.now)
    last_active_at = DateTimeField(null=True)
    
    class Meta:
        table_name = 'users'

class UserAction(BaseModel):
    id = AutoField()
    user = ForeignKeyField(User, backref='actions', on_delete='CASCADE')
    action_type = CharField(index=True)  # start, button_click, back, home, message_view
    node_id = IntegerField(null=True, index=True)
    button_id = IntegerField(null=True)
    session_id = CharField(null=True, index=True)  # Для группировки действий в сессии
    metadata = TextField(null=True)  # JSON с дополнительными данными
    created_at = DateTimeField(default=datetime.now, index=True)
    
    class Meta:
        table_name = 'user_actions'
        indexes = (
            (('user', 'created_at'), False),  # Составной индекс для быстрого поиска
        )

def initialize_db():
    db.connect()
    db.create_tables([Node, NodeConnection, MediaFile, ButtonStyle, User, UserAction], safe=True)
    db.close()