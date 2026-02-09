from flask import Flask, render_template, request, jsonify, redirect, url_for, session, send_from_directory, flash, make_response
from werkzeug.utils import secure_filename
import os
import json
from datetime import datetime
from functools import wraps

from database.models import initialize_db, User, UserAction, Node
from database.manager import db
from datetime import datetime, timedelta
from peewee import fn

template_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'templates'))
static_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'static'))

app = Flask(__name__, template_folder=template_dir, static_folder=static_dir)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'your-secret-key')

# Путь к папке uploads относительно корня проекта
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
app.config['UPLOAD_FOLDER'] = os.path.join(project_root, 'static', 'uploads')
app.config['MAX_CONTENT_LENGTH'] = int(os.getenv('MAX_CONTENT_LENGTH', 16777216))

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'tiff', 'ico'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('logged_in'):
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

@app.route('/')
def index():
    return redirect(url_for('login'))

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        
        if username == os.getenv('ADMIN_USERNAME', 'admin') and password == os.getenv('ADMIN_PASSWORD', 'admin'):
            session['logged_in'] = True
            return redirect(url_for('editor'))
        else:
            flash('Неверные учетные данные', 'error')
    
    return render_template('login.html')

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))

@app.route('/settings')
@login_required
def settings():
    return render_template('settings.html')

@app.route('/api/change-password', methods=['POST'])
@login_required
def change_password():
    try:
        data = request.get_json()
        current_password = data.get('current_password')
        new_password = data.get('new_password')
        confirm_password = data.get('confirm_password')
        
        # Проверяем текущий пароль
        if current_password != os.getenv('ADMIN_PASSWORD', 'admin'):
            return jsonify({'success': False, 'message': 'Неверный текущий пароль'}), 400
        
        # Проверяем новый пароль
        if not new_password or len(new_password) < 6:
            return jsonify({'success': False, 'message': 'Новый пароль должен содержать минимум 6 символов'}), 400
        
        if new_password != confirm_password:
            return jsonify({'success': False, 'message': 'Пароли не совпадают'}), 400
        
        # Обновляем пароль в .env файле
        env_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), '.env')
        if os.path.exists(env_file):
            with open(env_file, 'r', encoding='utf-8') as f:
                lines = f.readlines()
            
            # Ищем строку с паролем и обновляем её
            updated = False
            for i, line in enumerate(lines):
                if line.startswith('ADMIN_PASSWORD='):
                    lines[i] = f'ADMIN_PASSWORD={new_password}\n'
                    updated = True
                    break
            
            if not updated:
                lines.append(f'ADMIN_PASSWORD={new_password}\n')
            
            with open(env_file, 'w', encoding='utf-8') as f:
                f.writelines(lines)
        
        return jsonify({'success': True, 'message': 'Пароль успешно изменен'})
        
    except Exception as e:
        return jsonify({'success': False, 'message': f'Ошибка при изменении пароля: {str(e)}'}), 500

@app.route('/editor')
@login_required
def editor():
    return render_template('editor.html')

@app.route('/stats')
@login_required
def stats():
    response = make_response(render_template('stats.html'))
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response

@app.route('/api/nodes', methods=['GET'])
@login_required
def get_nodes():
    nodes = db.get_all_nodes()
    nodes_data = []
    
    for node in nodes:
        media_files = db.get_node_media(node.id)
        # Безопасное получение name, если поле не существует в БД
        node_name = getattr(node, 'name', None)
        if not node_name:
            # Устанавливаем название по умолчанию на основе типа
            if node.type == 'start':
                node_name = 'Начало'
            elif node.type == 'message':
                node_name = 'Сообщение'
            elif node.type == 'button':
                node_name = 'Кнопка'
            else:
                node_name = 'Блок'
        
        nodes_data.append({
            'id': node.id,
            'type': node.type,
            'name': node_name,
            'text': node.text,
            'x': node.x,
            'y': node.y,
            'width': getattr(node, 'width', 200),
            'height': getattr(node, 'height', 80),
            'media': [{'filename': f.filename, 'type': f.file_type} for f in media_files]
        })
    
    return jsonify(nodes_data)

@app.route('/api/nodes', methods=['POST'])
@login_required
def create_node():
    data = request.json
    node = db.create_node(
        node_type=data.get('type', 'message'),
        text=data.get('text'),
        name=data.get('name'),
        x=data.get('x', 0),
        y=data.get('y', 0),
        width=data.get('width', 200),
        height=data.get('height', 80)
    )
    
    node_name = getattr(node, 'name', None)
    if not node_name:
        if node.type == 'start':
            node_name = 'Начало'
        elif node.type == 'message':
            node_name = 'Сообщение'
        elif node.type == 'button':
            node_name = 'Кнопка'
        else:
            node_name = 'Блок'
    
    return jsonify({
        'id': node.id,
        'type': node.type,
        'name': node_name,
        'text': node.text,
        'x': node.x,
        'y': node.y,
        'width': getattr(node, 'width', 200),
        'height': getattr(node, 'height', 80)
    })

@app.route('/api/nodes/<int:node_id>', methods=['PUT'])
@login_required
def update_node(node_id):
    data = request.json
    node = db.update_node(node_id, **data)
    
    if node:
        node_name = getattr(node, 'name', None)
        if not node_name:
            if node.type == 'start':
                node_name = 'Начало'
            elif node.type == 'message':
                node_name = 'Сообщение'
            elif node.type == 'button':
                node_name = 'Кнопка'
            else:
                node_name = 'Блок'
        
        return jsonify({
            'id': node.id,
            'type': node.type,
            'name': node_name,
            'text': node.text,
            'x': node.x,
            'y': node.y,
            'width': getattr(node, 'width', 200),
            'height': getattr(node, 'height', 80)
        })
    return jsonify({'error': 'Node not found'}), 404

@app.route('/api/nodes/<int:node_id>', methods=['DELETE'])
@login_required
def delete_node(node_id):
    success = db.delete_node(node_id)
    return jsonify({'success': success})

@app.route('/api/connections', methods=['GET'])
@login_required
def get_connections():
    connections = db.get_connections()
    connections_data = []
    
    for conn in connections:
        connections_data.append({
            'id': conn.id,
            'source': conn.source_node.id,
            'target': conn.target_node.id,
            'buttonText': conn.button_text
        })
    
    return jsonify(connections_data)

@app.route('/api/connections', methods=['POST'])
@login_required
def create_connection():
    data = request.json
    connection = db.create_connection(
        data['source'],
        data['target'],
        data.get('buttonText', 'Button')
    )
    
    return jsonify({
        'id': connection.id,
        'source': connection.source_node.id,
        'target': connection.target_node.id,
        'buttonText': connection.button_text
    })

@app.route('/api/connections/<int:connection_id>', methods=['DELETE'])
@login_required
def delete_connection(connection_id):
    success = db.delete_connection(connection_id)
    return jsonify({'success': success})

@app.route('/api/upload/<int:node_id>', methods=['POST'])
@login_required
def upload_file(node_id):
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    
    if file and allowed_file(file.filename):
        filename = secure_filename(f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{file.filename}")
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        
        os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
        file.save(file_path)
        
        # Всегда сохраняем как изображение, так как мы принимаем только изображения
        file_type = 'image'
        
        media = db.save_media(
            filename=filename,
            original_name=file.filename,
            file_type=file_type,
            file_size=os.path.getsize(file_path),
            node_id=node_id
        )
        
        return jsonify({
            'id': media.id,
            'filename': filename,
            'type': file_type,
            'size': media.file_size
        })
    
    return jsonify({'error': 'File type not allowed'}), 400

@app.route('/api/uploads/<filename>', methods=['DELETE'])
@login_required
def delete_uploaded_file(filename):
    try:
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        if os.path.exists(file_path):
            os.remove(file_path)
        
        # Удаляем запись из базы данных
        success = db.delete_media_by_filename(filename)
        return jsonify({'success': success})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

@app.route('/api/stats/overview')
@login_required
def stats_overview():
    """Общая статистика пользователей"""
    try:
        # Общее количество пользователей
        total_users = User.select().count()
        
        # Активные пользователи за последние 7 дней
        week_ago = datetime.now() - timedelta(days=7)
        active_users = User.select().where(User.last_active_at >= week_ago).count()
        
        # Общее количество действий
        total_actions = UserAction.select().count()
        
        # Действия за последние 7 дней
        actions_last_week = UserAction.select().where(UserAction.created_at >= week_ago).count()
        
        # Новые пользователи за последние 7 дней
        new_users = User.select().where(User.created_at >= week_ago).count()
        
        return jsonify({
            'total_users': total_users,
            'active_users': active_users,
            'total_actions': total_actions,
            'actions_last_week': actions_last_week,
            'new_users': new_users
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/stats/users/growth')
@login_required
def stats_users_growth():
    """График роста пользователей по дням"""
    try:
        days = int(request.args.get('days', 30))
        start_date = datetime.now() - timedelta(days=days)
        
        # Группируем по дням (используем DATE() для совместимости)
        query = (User
                .select(
                    fn.DATE(User.created_at).alias('date'),
                    fn.count(User.id).alias('count')
                )
                .where(User.created_at >= start_date)
                .group_by(fn.DATE(User.created_at))
                .order_by(fn.DATE(User.created_at)))
        
        data = []
        for row in query:
            data.append({
                'date': row.date.strftime('%Y-%m-%d'),
                'count': row.count
            })
        
        return jsonify(data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/stats/actions/timeline')
@login_required
def stats_actions_timeline():
    """График действий по дням"""
    try:
        days = int(request.args.get('days', 30))
        start_date = datetime.now() - timedelta(days=days)
        
        query = (UserAction
                .select(
                    fn.DATE(UserAction.created_at).alias('date'),
                    fn.count(UserAction.id).alias('count')
                )
                .where(UserAction.created_at >= start_date)
                .group_by(fn.DATE(UserAction.created_at))
                .order_by(fn.DATE(UserAction.created_at)))
        
        data = []
        for row in query:
            data.append({
                'date': row.date.strftime('%Y-%m-%d'),
                'count': row.count
            })
        
        return jsonify(data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/stats/actions/by-type')
@login_required
def stats_actions_by_type():
    """Статистика действий по типам"""
    try:
        days = int(request.args.get('days', 30))
        start_date = datetime.now() - timedelta(days=days)
        
        query = (UserAction
                .select(
                    UserAction.action_type,
                    fn.count(UserAction.id).alias('count')
                )
                .where(UserAction.created_at >= start_date)
                .group_by(UserAction.action_type))
        
        data = []
        for row in query:
            data.append({
                'action_type': row.action_type,
                'count': row.count
            })
        
        return jsonify(data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/stats/users/list')
@login_required
def stats_users_list():
    """Список пользователей с пагинацией"""
    try:
        page = int(request.args.get('page', 1))
        per_page = int(request.args.get('per_page', 20))
        search = request.args.get('search', '')
        
        query = User.select()
        
        if search:
            query = query.where(
                (User.username.contains(search)) |
                (User.first_name.contains(search)) |
                (User.last_name.contains(search)) |
                (User.telegram_id == search)
            )
        
        total = query.count()
        users = query.order_by(User.last_active_at.desc()).paginate(page, per_page)
        
        users_data = []
        for user in users:
            # Подсчитываем количество действий пользователя
            actions_count = UserAction.select().where(UserAction.user == user).count()
            
            users_data.append({
                'id': user.id,
                'telegram_id': user.telegram_id,
                'username': user.username,
                'first_name': user.first_name,
                'last_name': user.last_name,
                'created_at': user.created_at.isoformat(),
                'last_active_at': user.last_active_at.isoformat() if user.last_active_at else None,
                'actions_count': actions_count
            })
        
        return jsonify({
            'users': users_data,
            'total': total,
            'page': page,
            'per_page': per_page,
            'pages': (total + per_page - 1) // per_page
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/stats/users/<int:user_id>/actions')
@login_required
def stats_user_actions(user_id):
    """История действий конкретного пользователя"""
    # Импортируем Node здесь, чтобы избежать проблем с загрузкой модулей в Gunicorn
    from database.models import Node
    
    try:
        page = int(request.args.get('page', 1))
        per_page = int(request.args.get('per_page', 50))
        
        user = User.get_by_id(user_id)
        query = UserAction.select().where(UserAction.user == user)
        
        total = query.count()
        actions = query.order_by(UserAction.created_at.desc()).paginate(page, per_page)
        
        actions_data = []
        for action in actions:
            # Получаем информацию о кнопке, если есть button_id
            button_name = None
            node_name = None
            if action.button_id:
                try:
                    button_node = Node.get_by_id(action.button_id)
                    if button_node:
                        # Используем поле name (название блока из редактора)
                        button_name = button_node.name if button_node.name else (button_node.text or f'Кнопка {action.button_id}')
                        print(f"DEBUG: button_id={action.button_id}, button_name={button_name}")
                except Exception as e:
                    print(f"DEBUG: Error getting button {action.button_id}: {e}")
                    import traceback
                    traceback.print_exc()
                    pass
            
            # Получаем название узла, если есть node_id
            if action.node_id:
                try:
                    node = Node.get_by_id(action.node_id)
                    if node:
                        # Используем поле name (название блока из редактора)
                        node_name = node.name if node.name else (node.text[:50] + '...' if node.text and len(node.text) > 50 else (node.text or f'Узел {action.node_id}'))
                        print(f"DEBUG: node_id={action.node_id}, node_name={node_name}")
                except Exception as e:
                    import traceback
                    print(f"DEBUG: Error getting node {action.node_id}: {e}")
                    print(traceback.format_exc())
                    pass
            
            actions_data.append({
                'id': action.id,
                'action_type': action.action_type,
                'node_id': action.node_id,
                'node_name': node_name,
                'button_id': action.button_id,
                'button_name': button_name,
                'session_id': str(action.session_id) if action.session_id else None,
                'metadata': action.metadata,
                'created_at': action.created_at.isoformat()
            })
        
        response = make_response(jsonify({
            'actions': actions_data,
            'total': total,
            'page': page,
            'per_page': per_page,
            'pages': (total + per_page - 1) // per_page
        }))
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
        return response
    except User.DoesNotExist:
        return jsonify({'error': 'User not found'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
    initialize_db()
    app.run(debug=True, host='0.0.0.0', port=5000)