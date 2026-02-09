from peewee import *
from database.models import Node, NodeConnection, MediaFile, ButtonStyle
from datetime import datetime
import json
import os

class Database:
    def __init__(self):
        self.db_path = os.getenv('DATABASE_URL', 'sqlite:///answerbot.db').replace('sqlite:///', '')
    
    def create_node(self, node_type, text=None, name=None, x=0, y=0, width=200, height=80):
        # Устанавливаем название по умолчанию на основе типа
        if not name:
            if node_type == 'start':
                name = 'Начало'
            elif node_type == 'message':
                name = 'Сообщение'
            elif node_type == 'button':
                name = 'Кнопка'
            else:
                name = 'Блок'
        
        return Node.create(
            type=node_type,
            name=name,
            text=text,
            x=x,
            y=y,
            width=width,
            height=height,
            updated_at=datetime.now()
        )
    
    def get_all_nodes(self):
        nodes = list(Node.select().order_by(Node.created_at))
        # Загружаем медиафайлы для каждого узла
        for node in nodes:
            node.media_files = list(MediaFile.select().where(MediaFile.node == node))
        return nodes
    
    def get_node(self, node_id):
        try:
            node = Node.get_by_id(node_id)
            # Загружаем связанные медиафайлы
            node.media_files = list(MediaFile.select().where(MediaFile.node == node))
            return node
        except Node.DoesNotExist:
            return None
    
    def update_node(self, node_id, **kwargs):
        try:
            node = Node.get_by_id(node_id)
            for key, value in kwargs.items():
                setattr(node, key, value)
            node.updated_at = datetime.now()
            node.save()
            return node
        except Node.DoesNotExist:
            return None
    
    def delete_node(self, node_id):
        try:
            node = Node.get_by_id(node_id)
            NodeConnection.delete().where((NodeConnection.source_node == node) | (NodeConnection.target_node == node)).execute()
            MediaFile.delete().where(MediaFile.node == node).execute()
            node.delete_instance()
            return True
        except Node.DoesNotExist:
            return False
    
    def create_connection(self, source_id, target_id, button_text="Button"):
        return NodeConnection.create(
            source_node=source_id,
            target_node=target_id,
            button_text=button_text
        )
    
    def get_connections(self):
        return list(NodeConnection.select())
    
    def delete_connection(self, connection_id):
        try:
            connection = NodeConnection.get_by_id(connection_id)
            connection.delete_instance()
            return True
        except NodeConnection.DoesNotExist:
            return False
    
    def get_start_node(self):
        try:
            node = Node.get(Node.type == 'start')
            # Загружаем связанные медиафайлы
            node.media_files = list(MediaFile.select().where(MediaFile.node == node))
            return node
        except Node.DoesNotExist:
            return None
    
    def get_node_connections(self, node_id):
        return list(NodeConnection.select().where(
            (NodeConnection.source_node == node_id) | 
            (NodeConnection.target_node == node_id)
        ))
    
    def save_media(self, filename, original_name, file_type, file_size, node_id=None):
        return MediaFile.create(
            filename=filename,
            original_name=original_name,
            file_type=file_type,
            file_size=file_size,
            node=node_id
        )
    
    def get_node_media(self, node_id):
        return list(MediaFile.select().where(MediaFile.node == node_id))
    
    def delete_media(self, media_id):
        try:
            media = MediaFile.get_by_id(media_id)
            file_path = os.path.join('static/uploads', media.filename)
            if os.path.exists(file_path):
                os.remove(file_path)
            media.delete_instance()
            return True
        except MediaFile.DoesNotExist:
            return False
    
    def delete_media_by_filename(self, filename):
        try:
            media = MediaFile.get(MediaFile.filename == filename)
            file_path = os.path.join('static/uploads', media.filename)
            if os.path.exists(file_path):
                os.remove(file_path)
            media.delete_instance()
            return True
        except MediaFile.DoesNotExist:
            return False
    
    def get_all_connections(self):
        """Получает все связи между узлами"""
        connections = []
        for conn in NodeConnection.select():
            try:
                # Используем ForeignKeyField напрямую
                source_node = conn.source_node
                target_node = conn.target_node
                connections.append(type('Connection', (), {
                    'source_node': source_node,
                    'target_node': target_node,
                    'button_text': conn.button_text
                })())
            except Exception as e:
                print(f"DEBUG: Error loading connection: {e}")
                continue
        return connections

db = Database()