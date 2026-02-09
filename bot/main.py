import asyncio
import logging
import os
import sys
import uuid
from dotenv import load_dotenv
from aiogram import Bot, Dispatcher
from aiogram.types import Message, CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, FSInputFile
from aiogram.filters import Command
from aiogram.enums import ParseMode
from aiogram.client.default import DefaultBotProperties
import markdown

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Устанавливаем правильный путь к базе данных
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

from database.models import initialize_db
from database.manager import db
import sys
import os
# Добавляем корневую директорию в путь для импорта utils
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from utils.event_logger import event_logger

load_dotenv()

TOKEN = os.getenv('TELEGRAM_BOT_TOKEN')

logging.basicConfig(level=logging.INFO)

bot = Bot(token=TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
dp = Dispatcher()

class BotHandler:
    def __init__(self):
        self.current_nodes = {}
        self.previous_nodes = {}  # Отслеживаем предыдущие узлы для кнопки "назад"
        self.last_messages = {}  # chat_id -> [messages] для отслеживания отправленных сообщений
        self.user_sessions = {}  # chat_id -> session_id для отслеживания сессий
    
    def get_or_create_session(self, chat_id):
        """Получает или создает session_id для пользователя"""
        if chat_id not in self.user_sessions:
            self.user_sessions[chat_id] = str(uuid.uuid4())
        return self.user_sessions[chat_id]
    
    def log_user_action(self, message_or_callback, action_type, node_id=None, button_id=None, metadata=None):
        """Логирует действие пользователя в Redis"""
        try:
            if isinstance(message_or_callback, Message):
                user = message_or_callback.from_user
                chat_id = message_or_callback.chat.id
            elif isinstance(message_or_callback, CallbackQuery):
                user = message_or_callback.from_user
                chat_id = message_or_callback.message.chat.id
            else:
                return
            
            session_id = self.get_or_create_session(chat_id)
            
            event_logger.log_event(
                telegram_id=chat_id,
                action_type=action_type,
                username=user.username,
                first_name=user.first_name,
                last_name=user.last_name,
                node_id=node_id,
                button_id=button_id,
                session_id=session_id,
                metadata=metadata
            )
        except Exception as e:
            logging.error(f"Error logging user action: {e}")
    
    async def delete_last_messages(self, chat_id):
        """Удаляет последние отправленные сообщения для чата"""
        if chat_id in self.last_messages:
            for message in self.last_messages[chat_id]:
                try:
                    await message.delete()
                except:
                    pass  # Игнорируем ошибки удаления
            self.last_messages[chat_id] = []
    
    async def send_node_message(self, chat_id, node, reply_markup=None, log_view=True, user_info=None):
        if node.text:
            try:
                print(f"DEBUG: Sending node {node.id}, text: {node.text}")
                print(f"DEBUG: Media files: {len(node.media_files) if hasattr(node, 'media_files') else 'No media_files attribute'}")
                
                # Логируем просмотр сообщения (если не стартовое сообщение, оно логируется отдельно)
                if log_view and node.type != 'start' and user_info:
                    event_logger.log_event(
                        telegram_id=chat_id,
                        action_type='message_view',
                        username=user_info.get('username'),
                        first_name=user_info.get('first_name'),
                        last_name=user_info.get('last_name'),
                        node_id=node.id,
                        session_id=self.get_or_create_session(chat_id)
                    )
                
                if hasattr(node, 'media_files') and node.media_files:
                    # Фильтруем только изображения
                    images = [media for media in node.media_files if media.file_type == 'image']
                    print(f"DEBUG: Images found: {len(images)}")
                    if images:
                        # Если есть изображения, отправляем их
                        if len(images) == 1:
                            # Одно изображение - отправляем как фото с текстом и кнопками
                            media = images[0]
                            file_path = f"{project_root}/static/uploads/{media.filename}"
                            print(f"DEBUG: Looking for image at: {file_path}")
                            print(f"DEBUG: File exists: {os.path.exists(file_path)}")
                            if os.path.exists(file_path):
                                message = await bot.send_photo(chat_id, FSInputFile(file_path), caption=node.text, reply_markup=reply_markup)
                                # Сохраняем отправленное сообщение
                                if chat_id not in self.last_messages:
                                    self.last_messages[chat_id] = []
                                self.last_messages[chat_id].append(message)
                            else:
                                print(f"DEBUG: Image file not found: {file_path}")
                                error_message = await bot.send_message(chat_id, f"Изображение не найдено: {media.filename}", reply_markup=reply_markup)
                                if chat_id not in self.last_messages:
                                    self.last_messages[chat_id] = []
                                self.last_messages[chat_id].append(error_message)
                        else:
                            # Несколько изображений - отправляем как медиа-группу
                            from aiogram.types import InputMediaPhoto
                            media_group = []
                            
                            for i, media in enumerate(images):
                                file_path = f"{project_root}/static/uploads/{media.filename}"
                                print(f"DEBUG: Looking for image {i+1} at: {file_path}")
                                if os.path.exists(file_path):
                                    # Все изображения без текста
                                    media_group.append(InputMediaPhoto(media=FSInputFile(file_path)))
                                else:
                                    print(f"DEBUG: Image file not found: {file_path}")
                            
                            if media_group:
                                # Отправляем медиа-группу
                                messages = await bot.send_media_group(chat_id, media_group)
                                # Сохраняем отправленные сообщения
                                if chat_id not in self.last_messages:
                                    self.last_messages[chat_id] = []
                                self.last_messages[chat_id].extend(messages)
                                
                                # Отправляем текст с кнопками отдельным сообщением
                                text_message = await bot.send_message(chat_id, node.text, reply_markup=reply_markup)
                                self.last_messages[chat_id].append(text_message)
                            else:
                                error_message = await bot.send_message(chat_id, "Изображения не найдены", reply_markup=reply_markup)
                                if chat_id not in self.last_messages:
                                    self.last_messages[chat_id] = []
                                self.last_messages[chat_id].append(error_message)
                        return
                
                # Если нет изображений, отправляем обычное текстовое сообщение
                print(f"DEBUG: Sending text message: {repr(node.text)}")
                print(f"DEBUG: Message contains links: {'<a href=' in node.text}")
                message = await bot.send_message(chat_id, node.text, reply_markup=reply_markup)
                # Сохраняем отправленное сообщение
                if chat_id not in self.last_messages:
                    self.last_messages[chat_id] = []
                self.last_messages[chat_id].append(message)
            except Exception as e:
                print(f"DEBUG: Error in send_node_message: {str(e)}")
                await bot.send_message(chat_id, f"Error: {str(e)}")
    
    async def edit_node_message(self, message, node, reply_markup=None):
        """Редактирует существующее сообщение с учетом изображений"""
        try:
            chat_id = message.chat.id
            
            # ВАЖНО: Сначала удаляем все предыдущие сообщения (включая медиа-группу изображений)
            # Это должно произойти ДО любых операций редактирования
            await self.delete_last_messages(chat_id)
            
            # Также удаляем само сообщение callback (текстовое с кнопками или изображение)
            # Это нужно, так как если была медиа-группа, все изображения в last_messages уже удалены,
            # но callback.message (текстовое сообщение) осталось
            try:
                await message.delete()
            except:
                pass  # Игнорируем ошибки, если сообщение уже удалено или недоступно
            
            # Теперь просто отправляем новое сообщение для нового узла
            # Все старые сообщения (включая медиа-группу) уже удалены
            await self.send_node_message(chat_id, node, reply_markup)
                
        except Exception as e:
            print(f"DEBUG: Error in edit_node_message: {str(e)}")
            # Если не удалось отредактировать, удаляем старое и отправляем новое
            try:
                await message.delete()
            except:
                pass
            # user_info не передаем здесь, так как это fallback после ошибки
            await self.send_node_message(message.chat.id, node, reply_markup, log_view=False)
    
    def get_keyboard_for_node(self, node, chat_id=None):
        connections = db.get_node_connections(node.id)
        buttons = []
        
        # Сначала добавляем кнопки, связанные с этим узлом
        for conn in connections:
            if conn.source_node.id == node.id and conn.target_node.type == 'button':
                buttons.append([InlineKeyboardButton(text=conn.target_node.text, callback_data=f"button_{conn.target_node.id}")])
        
        # Затем добавляем кнопки навигации
        if node.type != 'start':
            # Кнопка "назад" (если есть предыдущий узел) - предпоследняя
            if chat_id and chat_id in self.previous_nodes:
                buttons.append([InlineKeyboardButton(text="⬅️ Назад", callback_data="back")])
            
            # Кнопка "в начало" всегда последняя
            buttons.append([InlineKeyboardButton(text="🏠 В начало", callback_data="start")])
        
        return InlineKeyboardMarkup(inline_keyboard=buttons) if buttons else None
    
    def get_keyboard_for_start_node(self, start_node):
        """Получает кнопки, связанные со стартовым узлом"""
        connections = db.get_node_connections(start_node.id)
        buttons = []
        for conn in connections:
            if conn.source_node.id == start_node.id and conn.target_node.type == 'button':
                # Кнопка ведет к другому узлу кнопки - показываем название кнопки
                buttons.append([InlineKeyboardButton(text=conn.target_node.text, callback_data=f"button_{conn.target_node.id}")])
        
        # В стартовом узле не добавляем кнопку "В начало" - мы уже в начале
        return InlineKeyboardMarkup(inline_keyboard=buttons) if buttons else None

handler = BotHandler()

@dp.message(Command("start"))
async def cmd_start(message: Message):
    start_node = db.get_start_node()
    if not start_node:
        await message.answer("Бот не настроен. Обратитесь к администратору.")
        return
    
    # Стартовый узел - текст с кнопками под ним
    handler.current_nodes[message.chat.id] = start_node.id
    reply_markup = handler.get_keyboard_for_start_node(start_node)
    
    user_info = {
        'username': message.from_user.username,
        'first_name': message.from_user.first_name,
        'last_name': message.from_user.last_name
    }
    await handler.send_node_message(message.chat.id, start_node, reply_markup, log_view=False, user_info=user_info)
    
    # Логируем событие
    handler.log_user_action(message, 'start', node_id=start_node.id)

@dp.callback_query(lambda c: c.data.startswith("node_"))
async def process_node_callback(callback: CallbackQuery):
    try:
        node_id = int(callback.data.split("_")[1])
        node = db.get_node(node_id)
        
        if not node:
            await callback.answer("Узел не найден")
            return
        
        handler.current_nodes[callback.message.chat.id] = node_id
        reply_markup = handler.get_keyboard_for_node(node, callback.message.chat.id)
        
        user_info = {
            'username': callback.from_user.username,
            'first_name': callback.from_user.first_name,
            'last_name': callback.from_user.last_name
        }
        
        if reply_markup:
            await handler.send_node_message(callback.message.chat.id, node, reply_markup, user_info=user_info)
        else:
            await handler.send_node_message(callback.message.chat.id, node, None, user_info=user_info)
        
        await callback.answer()
    except Exception as e:
        await callback.answer(f"Ошибка: {str(e)}")

@dp.callback_query(lambda c: c.data.startswith("button_"))
async def process_button_callback(callback: CallbackQuery):
    try:
        button_id = int(callback.data.split("_")[1])
        button_node = db.get_node(button_id)
        
        if not button_node or button_node.type != 'button':
            await callback.answer("Кнопка не найдена")
            return
        
        # Сохраняем текущий узел как предыдущий
        chat_id = callback.message.chat.id
        if chat_id in handler.current_nodes:
            handler.previous_nodes[chat_id] = handler.current_nodes[chat_id]
        
        # Кнопка ведет к сообщению - трансформируем текущее сообщение
        connections = db.get_node_connections(button_id)
        target_node_id = None
        for conn in connections:
            if conn.source_node.id == button_id and conn.target_node.type == 'message':
                message_node = conn.target_node
                handler.current_nodes[chat_id] = message_node.id
                target_node_id = message_node.id
                
                # Трансформируем сообщение с кнопками
                reply_markup = handler.get_keyboard_for_node(message_node, chat_id)
                user_info = {
                    'username': callback.from_user.username,
                    'first_name': callback.from_user.first_name,
                    'last_name': callback.from_user.last_name
                }
                await handler.edit_node_message(callback.message, message_node, reply_markup)
                # Логируем просмотр сообщения после перехода
                if message_node:
                    event_logger.log_event(
                        telegram_id=chat_id,
                        action_type='message_view',
                        username=callback.from_user.username,
                        first_name=callback.from_user.first_name,
                        last_name=callback.from_user.last_name,
                        node_id=message_node.id,
                        session_id=handler.get_or_create_session(chat_id)
                    )
                break
        
        # Логируем событие
        handler.log_user_action(callback, 'button_click', node_id=target_node_id, button_id=button_id)
        
        await callback.answer()
    except Exception as e:
        await callback.answer(f"Ошибка: {str(e)}")

@dp.callback_query(lambda c: c.data == "back")
async def process_back_callback(callback: CallbackQuery):
    chat_id = callback.message.chat.id
    current_node_id = handler.current_nodes.get(chat_id)
    
    # Логируем событие до обработки
    handler.log_user_action(callback, 'back', node_id=current_node_id)
    
    print(f"DEBUG: Back button pressed, chat_id: {chat_id}, current_node_id: {current_node_id}")
    
    if not current_node_id:
        print("DEBUG: No current node found")
        await callback.answer("Текущий узел не найден")
        return
    
    current_node = db.get_node(current_node_id)
    if not current_node:
        print("DEBUG: Current node not found in database")
        await callback.answer("Текущий узел не найден")
        return
    
    print(f"DEBUG: Current node: {current_node.type}, id: {current_node.id}, text: {current_node.text[:50]}...")
    
    # Находим предыдущее сообщение по иерархии
    parent_node = None
    
    if current_node.type == 'message':
        print("DEBUG: Looking for previous message for current message")
        # Для сообщения ищем предыдущее сообщение в цепочке
        # Сначала найдем кнопку, которая ведет к текущему сообщению
        all_connections = db.get_all_connections()
        print(f"DEBUG: Found {len(all_connections)} connections")
        
        # Найдем кнопку, которая ведет к текущему сообщению
        button_to_current = None
        for conn in all_connections:
            print(f"DEBUG: Connection: {conn.source_node.type}({conn.source_node.id}) -> {conn.target_node.type}({conn.target_node.id})")
            if conn.target_node.id == current_node_id and conn.source_node.type == 'button':
                button_to_current = conn.source_node
                print(f"DEBUG: Found button leading to current message: {button_to_current.id}")
                break
        
        if button_to_current:
            # Теперь найдем сообщение, от которого идет эта кнопка
            for conn in all_connections:
                if conn.target_node.id == button_to_current.id and conn.source_node.type == 'message':
                    parent_node = conn.source_node
                    print(f"DEBUG: Found previous message: {parent_node.id}")
                    break
                elif conn.target_node.id == button_to_current.id and conn.source_node.type == 'start':
                    parent_node = conn.source_node
                    print(f"DEBUG: Found start node as previous: {parent_node.id}")
                    break
    elif current_node.type == 'button':
        print("DEBUG: Looking for previous message for button")
        # Для кнопки ищем сообщение, от которого она идет
        all_connections = db.get_all_connections()
        print(f"DEBUG: Found {len(all_connections)} connections")
        for conn in all_connections:
            print(f"DEBUG: Connection: {conn.source_node.type}({conn.source_node.id}) -> {conn.target_node.type}({conn.target_node.id})")
            if conn.target_node.id == current_node_id and conn.source_node.type == 'message':
                parent_node = conn.source_node
                print(f"DEBUG: Found parent message for button: {parent_node.id}")
                break
            elif conn.target_node.id == current_node_id and conn.source_node.type == 'start':
                parent_node = conn.source_node
                print(f"DEBUG: Found start node as parent for button: {parent_node.id}")
                break
    
    if parent_node:
        print(f"DEBUG: Parent node found: {parent_node.type}, id: {parent_node.id}")
        # Сохраняем текущий узел как предыдущий для нового узла
        handler.previous_nodes[chat_id] = current_node_id
        
        # Обновляем текущий узел
        handler.current_nodes[chat_id] = parent_node.id
        
        # Трансформируем сообщение
        if parent_node.type == 'start':
            reply_markup = handler.get_keyboard_for_start_node(parent_node)
        else:
            reply_markup = handler.get_keyboard_for_node(parent_node, chat_id)
        
        print(f"DEBUG: Editing message to parent node")
        await handler.edit_node_message(callback.message, parent_node, reply_markup)
    else:
        print("DEBUG: No parent node found")
        await callback.answer("Нет родительского узла")
    
    await callback.answer()

@dp.callback_query(lambda c: c.data == "start")
async def process_start_callback(callback: CallbackQuery):
    start_node = db.get_start_node()
    if start_node:
        handler.current_nodes[callback.message.chat.id] = start_node.id
        
        # Очищаем историю при переходе в начало
        chat_id = callback.message.chat.id
        if chat_id in handler.previous_nodes:
            del handler.previous_nodes[chat_id]
        
        # Трансформируем сообщение в стартовое
        reply_markup = handler.get_keyboard_for_start_node(start_node)
        await handler.edit_node_message(callback.message, start_node, reply_markup)
        
        # Логируем событие (home уже логирует просмотр стартового узла)
        handler.log_user_action(callback, 'home', node_id=start_node.id)
    await callback.answer()

async def main():
    initialize_db()
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())