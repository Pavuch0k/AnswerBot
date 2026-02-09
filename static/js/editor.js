class FlowEditor {
    constructor() {
        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.nodes = [];
        this.connections = [];
        this.selectedNode = null;
        this.selectedNodes = []; // Массив для множественного выделения
        this.selectedConnection = null;
        this.isDragging = false;
        this.isMultiDragging = false; // Флаг для перемещения нескольких узлов
        this.isConnecting = false;
        this.connectionMode = false;
        this.dragOffset = { x: 0, y: 0 };
        this.connectStart = null;
        this.mousePosition = { x: 0, y: 0 };
        this.connectionPreview = null;
        this.hoveredNode = null;
        this.hoveredConnection = null;
        this.connectionPoints = [];
        
        // Переменные для изменения размера
        this.isResizing = false;
        this.resizeStart = { x: 0, y: 0, width: 0, height: 0 };
        this.resizeHandleSize = 12;
        
        // Переменные для зума и панорамирования
        this.zoom = 1;
        this.minZoom = 0.1;
        this.maxZoom = 3;
        this.zoomStep = 0.1;
        this.isPanning = false;
        this.panStart = { x: 0, y: 0 };
        this.canvasOffset = { x: 0, y: 0 };
        this.lastMousePos = { x: 0, y: 0 };
        this.isSpacePressed = false;
        
        // Переменные для выбора рамкой (selection box)
        this.isSelecting = false;
        this.selectionStart = { x: 0, y: 0 };
        this.selectionBox = null;
        
        // Throttling для рендера
        this.renderTimeout = null;
        this.lastRenderTime = 0;
        
        // Кэш для загруженных изображений
        this.imageCache = new Map();
        this.loadingImages = new Set(); // Отслеживаем загружаемые изображения
        
        this.init();
    }

    init() {
        this.setupCanvas();
        this.setupEventListeners();
        this.loadWorkflow();
        this.animate();
    }

    setupCanvas() {
        const resizeCanvas = () => {
            this.canvas.width = this.canvas.offsetWidth;
            this.canvas.height = this.canvas.offsetHeight;
            this.render();
        };
        
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
    }

    setupEventListeners() {
        this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
        this.canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
        this.canvas.addEventListener('mouseup', this.onMouseUp.bind(this));
        this.canvas.addEventListener('mouseleave', this.onMouseLeave.bind(this));
        this.canvas.addEventListener('mouseout', this.onMouseLeave.bind(this));
        this.canvas.addEventListener('dblclick', this.onDoubleClick.bind(this));
        this.canvas.addEventListener('wheel', this.onWheel.bind(this));
        this.canvas.addEventListener('contextmenu', this.onContextMenu.bind(this));
        
        document.querySelectorAll('.node-item').forEach(node => {
            node.addEventListener('dragstart', this.onNodeDragStart.bind(this));
        });
        
        this.canvas.addEventListener('dragover', this.onDragOver.bind(this));
        this.canvas.addEventListener('drop', this.onDrop.bind(this));
        
        document.getElementById('clear-btn').addEventListener('click', this.clearWorkflow.bind(this));
        document.getElementById('auto-layout').addEventListener('click', this.autoLayout.bind(this));
        
        // Обработчики для кнопок зума
        document.getElementById('zoom-in').addEventListener('click', () => {
            console.log('Zoom in button clicked');
            this.zoomIn();
        });
        document.getElementById('zoom-out').addEventListener('click', () => {
            console.log('Zoom out button clicked');
            this.zoomOut();
        });
        document.getElementById('zoom-reset').addEventListener('click', () => {
            console.log('Zoom reset button clicked');
            this.zoomReset();
        });
          
        document.addEventListener('keydown', this.onKeyDown.bind(this));
        document.addEventListener('keyup', this.onKeyUp.bind(this));
        
        // Обработчик mouseup на уровне документа для гарантированного сброса состояний
        // Это исправляет баг с залипанием панорамирования, если мышь ушла за пределы canvas
        document.addEventListener('mouseup', (e) => {
            if (this.isPanning || this.isDragging || this.isResizing || this.isSelecting) {
                this.onMouseUp(e);
            }
        });
        
        // Делегирование событий для открытия модального окна изображений
        document.addEventListener('click', (e) => {
            const img = e.target.closest('.image-item img[data-image-src]');
            if (img && img.dataset.imageSrc) {
                e.stopPropagation();
                const imageSrc = img.dataset.imageSrc;
                const imageName = img.dataset.imageName || img.alt;
                this.openImageModal(imageSrc, imageName);
            }
        });
        
        // Обработчик закрытия модального окна
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('image-modal-close') || 
                (e.target.id === 'image-modal' && e.target.classList.contains('show'))) {
                this.closeImageModal();
            }
        });
        
        // Закрытие по Escape
        document.addEventListener('keydown', (e) => {
            const modal = document.getElementById('image-modal');
            if (e.key === 'Escape' && modal && modal.classList.contains('show')) {
                this.closeImageModal();
            }
        });
    }

    toggleConnectionMode() {
        this.connectionMode = !this.connectionMode;
        const btn = document.getElementById('connection-mode');
        if (this.connectionMode) {
            btn.style.background = '#2d7dd2';
            btn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: inline-block; margin-right: 6px; vertical-align: middle;">
                    <path d="M5 12h14"></path>
                    <path d="M12 5l7 7-7 7"></path>
                </svg>
                Связи (ВКЛ)
            `;
            this.canvas.style.cursor = 'crosshair';
        } else {
            btn.style.background = '#4a9eff';
            btn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: inline-block; margin-right: 6px; vertical-align: middle;">
                    <path d="M5 12h14"></path>
                    <path d="M12 5l7 7-7 7"></path>
                </svg>
                Связи
            `;
            this.canvas.style.cursor = 'default';
            this.connectStart = null;
            this.connectionPreview = null;
        }
    }

    onKeyDown(e) {
        if (e.key === 'Escape') {
            this.connectionMode = false;
            this.connectStart = null;
            this.connectStartPoint = null;
            this.connectionPreview = null;
            this.isPanning = false;
            this.canvas.style.cursor = 'default';
            if (document.getElementById('connection-mode').style.background === 'rgb(45, 125, 210)') {
                this.toggleConnectionMode();
            }
        } else if (e.key === 'Delete' && this.selectedNode) {
            this.deleteSelectedNode();
        } else if (e.key === ' ' || e.key === 'Space') {
            // Проверяем, не находится ли фокус на поле ввода текста
            const activeElement = document.activeElement;
            const isTextInput = activeElement && (
                activeElement.id === 'node-text' || 
                activeElement.contentEditable === 'true' ||
                activeElement.tagName === 'INPUT' ||
                activeElement.tagName === 'TEXTAREA'
            );
            
            if (!isTextInput) {
            e.preventDefault();
            this.isSpacePressed = true;
            this.canvas.style.cursor = 'grab';
            }
        } else if (e.ctrlKey && e.key === '=') {
            // Ctrl + = для увеличения
            console.log('Ctrl + = pressed');
            e.preventDefault();
            this.zoomIn();
        } else if (e.ctrlKey && e.key === '-') {
            // Ctrl + - для уменьшения
            console.log('Ctrl + - pressed');
            e.preventDefault();
            this.zoomOut();
        } else if (e.ctrlKey && e.key === '0') {
            // Ctrl + 0 для сброса зума
            console.log('Ctrl + 0 pressed');
            e.preventDefault();
            this.zoomReset();
        }
    }

    onNodeDragStart(e) {
        e.dataTransfer.setData('nodeType', e.target.dataset.nodeType);
    }

    onDragOver(e) {
        e.preventDefault();
    }

    onDrop(e) {
        e.preventDefault();
        const nodeType = e.dataTransfer.getData('nodeType');
        const rect = this.canvas.getBoundingClientRect();
        // Учитываем зум и панорамирование при расчете координат
        const x = (e.clientX - rect.left - this.canvasOffset.x) / this.zoom;
        const y = (e.clientY - rect.top - this.canvasOffset.y) / this.zoom;
        
        this.createNode(nodeType, x, y);
    }

    createNode(type, x, y) {
        // Проверяем, что может быть только один стартовый узел
        if (type === 'start') {
            const existingStart = this.nodes.find(n => n.type === 'start');
            if (existingStart) {
                alert('Стартовый узел уже существует! Удалите существующий перед созданием нового.');
                return;
            }
        }
        
        let defaultText = '';
        switch (type) {
            case 'start':
                defaultText = 'Начало';
                break;
            case 'message':
                defaultText = 'Новое сообщение';
                break;
            case 'button':
                defaultText = 'Новая кнопка';
                break;
            default:
                defaultText = 'Новый узел';
        }
        
        let defaultName = '';
        switch (type) {
            case 'start':
                defaultName = 'Начало';
                break;
            case 'message':
                defaultName = 'Сообщение';
                break;
            case 'button':
                defaultName = 'Кнопка';
                break;
            default:
                defaultName = 'Блок';
        }
        
        const node = {
            id: Date.now(),
            type: type,
            name: defaultName,
            text: defaultText,
            x: x - 100,
            y: y - 40,
            width: 200,
            height: 80
        };
        
        this.nodes.push(node);
        this.selectedNode = node;
        this.updatePropertiesPanel();
        this.render();
        
        fetch('/api/nodes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: type,
                name: node.name,
                text: node.text,
                x: node.x,
                y: node.y,
                width: node.width,
                height: node.height
            })
        })
        .then(response => response.json())
        .then(data => {
            node.id = data.id;
            this.showNotification('Блок создан', 'success', 2000);
        })
        .catch(error => {
            console.error('Error creating node:', error);
            this.showNotification('Ошибка при создании блока', 'error', 3000);
        });
    }

    onMouseDown(e) {
        const rect = this.canvas.getBoundingClientRect();
        // Учитываем зум и панорамирование при расчете координат
        const x = (e.clientX - rect.left - this.canvasOffset.x) / this.zoom;
        const y = (e.clientY - rect.top - this.canvasOffset.y) / this.zoom;
        
        // Запоминаем начальную позицию для pan
        this.lastMousePos = { x: e.clientX, y: e.clientY };
        
        const clickedNode = this.getNodeAt(x, y);
        const clickedPoint = this.getConnectionPointAt(x, y);
        const clickedDeleteBtn = this.getDeleteButtonAt(x, y);
        const clickedResizeHandle = this.getResizeHandleAt(x, y);
        
        // ПКМ - только выделение
        if (e.button === 2 || e.which === 3) {
            e.preventDefault(); // Предотвращаем контекстное меню
            
            if (clickedNode) {
                // ПКМ на узле - выделение/добавление к выделению
                const index = this.selectedNodes.indexOf(clickedNode);
                if (index > -1) {
                    // Узел уже выделен - убираем из выделения
                    this.selectedNodes.splice(index, 1);
                    if (this.selectedNodes.length === 0) {
                        this.selectedNode = null;
                    } else if (this.selectedNode === clickedNode) {
                        this.selectedNode = this.selectedNodes[0];
                    }
                } else {
                    // Добавляем узел в выделение
                    if (!this.selectedNodes.includes(clickedNode)) {
                        this.selectedNodes.push(clickedNode);
                    }
                    this.selectedNode = clickedNode;
                }
                this.updatePropertiesPanel();
                this.render();
            } else {
                // ПКМ на пустом месте - выбор рамкой
                this.isSelecting = true;
                this.selectionStart = { x, y };
                this.selectionBox = { x, y, width: 0, height: 0 };
                
                // Сбрасываем выделение только если не зажат Ctrl
                if (!e.ctrlKey && !e.metaKey) {
                    this.selectedNode = null;
                    this.selectedNodes = [];
                }
                this.updatePropertiesPanel();
            }
            return;
        }
        
        // Все действия ниже только для ЛКМ - перемещение и взаимодействие
        if (clickedResizeHandle) {
            // Начинаем изменение размера (только ЛКМ)
            this.isResizing = true;
            this.selectedNode = clickedResizeHandle.node;
            this.resizeStart = {
                x: x,
                y: y,
                width: clickedResizeHandle.node.width,
                height: clickedResizeHandle.node.height
            };
            this.canvas.style.cursor = 'nwse-resize';
            return;
        }
        
        if (clickedDeleteBtn) {
            // Клик по кнопке удаления узла (только ЛКМ)
            this.deleteNode(clickedDeleteBtn.node);
            return;
        }
        
        // НЕ проверяем кнопку удаления связи здесь - она будет проверена позже,
        // только если нет узла под курсором, чтобы не мешать выделению узлов
        
        if (clickedPoint) {
            // Обработка точек соединения (только ЛКМ)
            if (!this.connectStart) {
                this.connectStart = clickedPoint.node;
                this.connectStartPoint = clickedPoint.point;
                this.selectedNode = clickedPoint.node;
            } else if (this.connectStart !== clickedPoint.node) {
                this.createConnectionFromPoints(this.connectStart, this.connectStartPoint, clickedPoint.node, clickedPoint.point);
                this.connectStart = null;
                this.connectStartPoint = null;
                this.connectionPreview = null;
            }
            this.updatePropertiesPanel();
        } else if (clickedNode) {
            // ЛКМ на узле - перемещение
            if (e.button === 0) {
            if (e.shiftKey && this.selectedNode && this.selectedNode !== clickedNode) {
                    // Shift + ЛКМ - создание связи
                this.createConnection(this.selectedNode, clickedNode);
            } else {
                    // ЛКМ на узле - начинаем перемещение
                    // Если узел не в выделении, выделяем только его
                    if (!this.selectedNodes.includes(clickedNode)) {
                this.selectedNode = clickedNode;
                        this.selectedNodes = [clickedNode];
                        this.updatePropertiesPanel();
                    }
                this.isDragging = true;
                    this.isMultiDragging = this.selectedNodes.length > 1;
                this.dragOffset = {
                    x: x - clickedNode.x,
                    y: y - clickedNode.y
                };
                }
            }
        } else {
            // ЛКМ на пустом месте или на связи
            if (e.button === 0) {
                // Проверяем связь только если нет узла и нет точки соединения
                const clickedConnection = this.getConnectionAt(x, y);
                if (clickedConnection) {
                    // Проверяем, не кликнули ли по кнопке удаления связи
                    const clickedConnectionDeleteBtn = this.getConnectionDeleteButtonAt(x, y);
                    if (clickedConnectionDeleteBtn) {
                        // Клик по кнопке удаления связи
                        this.deleteConnection(clickedConnectionDeleteBtn);
                        return;
                    }
                    // ЛКМ на связи - выделение связи
            this.selectedConnection = clickedConnection;
                    this.updatePropertiesPanel();
        } else {
                    // ЛКМ на пустом месте - перемещение холста
                    this.isPanning = true;
                    this.panStart = { x: e.clientX, y: e.clientY };
                    this.canvas.style.cursor = 'grabbing';
                    
                    // Сбрасываем выделение только если не зажат Ctrl
                    if (!e.ctrlKey && !e.metaKey) {
            this.selectedNode = null;
                        this.selectedNodes = [];
                    }
                }
                
            this.selectedConnection = null;
            this.connectStart = null;
            this.connectStartPoint = null;
            this.connectionPreview = null;
            }
        }
        
        this.render();
    }

    onMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        // Учитываем зум и панорамирование при расчете координат мыши
        this.mousePosition.x = (e.clientX - rect.left - this.canvasOffset.x) / this.zoom;
        this.mousePosition.y = (e.clientY - rect.top - this.canvasOffset.y) / this.zoom;
        
        // Обработка изменения размера
        if (this.isResizing && this.selectedNode) {
            const x = (e.clientX - rect.left - this.canvasOffset.x) / this.zoom;
            const y = (e.clientY - rect.top - this.canvasOffset.y) / this.zoom;
            
            const deltaX = x - this.resizeStart.x;
            const deltaY = y - this.resizeStart.y;
            
            // Минимальный размер блока
            const minWidth = 150;
            const minHeight = 60;
            
            this.selectedNode.width = Math.max(minWidth, this.resizeStart.width + deltaX);
            this.selectedNode.height = Math.max(minHeight, this.resizeStart.height + deltaY);
            
            this.render();
            return;
        }
        
        // Обработка перемещения холста
        if (this.isPanning) {
            const deltaX = e.clientX - this.panStart.x;
            const deltaY = e.clientY - this.panStart.y;
            
            // Обновляем смещение холста
            this.canvasOffset.x += deltaX;
            this.canvasOffset.y += deltaY;
            
            this.panStart = { x: e.clientX, y: e.clientY };
            this.render();
            return;
        }
        
        // Обработка выбора рамкой
        if (this.isSelecting) {
            const rect = this.canvas.getBoundingClientRect();
            const x = (e.clientX - rect.left - this.canvasOffset.x) / this.zoom;
            const y = (e.clientY - rect.top - this.canvasOffset.y) / this.zoom;
            
            this.selectionBox = {
                x: Math.min(this.selectionStart.x, x),
                y: Math.min(this.selectionStart.y, y),
                width: Math.abs(x - this.selectionStart.x),
                height: Math.abs(y - this.selectionStart.y)
            };
            
            // Выбираем узлы внутри рамки
            this.updateSelectionFromBox();
            
            this.render();
            return;
        }
        
        // Групповое перемещение выделенных узлов
        if (this.isDragging && this.isMultiDragging && this.selectedNodes.length > 0) {
            // Вычисляем новую позицию основного узла
            const newX = this.mousePosition.x - this.dragOffset.x;
            const newY = this.mousePosition.y - this.dragOffset.y;
            
            // Вычисляем дельту перемещения
            const deltaX = newX - this.selectedNode.x;
            const deltaY = newY - this.selectedNode.y;
            
            // Перемещаем все выделенные узлы на одинаковое расстояние
            this.selectedNodes.forEach(node => {
                node.x += deltaX;
                node.y += deltaY;
            });
            
            this.throttledRender();
            return;
        }
        
        // Перемещение одного узла
        if (this.isDragging && this.selectedNode && !this.isMultiDragging) {
            this.selectedNode.x = this.mousePosition.x - this.dragOffset.x;
            this.selectedNode.y = this.mousePosition.y - this.dragOffset.y;
            this.throttledRender(); // Throttled render для плавного перетаскивания
            return;
        }
        
        const node = this.getNodeAt(this.mousePosition.x, this.mousePosition.y);
        const connectionPoint = this.getConnectionPointAt(this.mousePosition.x, this.mousePosition.y);
        const connection = this.getConnectionAt(this.mousePosition.x, this.mousePosition.y);
        const resizeHandle = this.getResizeHandleAt(this.mousePosition.x, this.mousePosition.y);
        
        // Изменяем курсор при наведении на ручку изменения размера
        if (resizeHandle) {
            this.canvas.style.cursor = 'nwse-resize';
        } else if (node) {
            this.canvas.style.cursor = 'move';
        } else {
            this.canvas.style.cursor = 'default';
        }
        
        const wasHovered = this.hoveredNode;
        const wasHoveredConnection = this.hoveredConnection;
        this.hoveredNode = node;
        this.hoveredConnection = connection;
        
        if (this.connectStart) {
            if (connectionPoint && connectionPoint.node !== this.connectStart) {
                this.connectionPreview = {
                    source: this.connectStart,
                    sourcePoint: this.connectStartPoint,
                    targetPoint: connectionPoint.point,
                    targetNode: connectionPoint.node
                };
            } else {
                this.connectionPreview = {
                    source: this.connectStart,
                    sourcePoint: this.connectStartPoint,
                    target: { x: this.mousePosition.x, y: this.mousePosition.y }
                };
            }
        }
        
        // Обновляем курсор
        if (this.isPanning) {
            this.canvas.style.cursor = 'grabbing';
        } else if (this.isSelecting) {
            this.canvas.style.cursor = 'crosshair';
        } else if (this.isDragging && this.isMultiDragging) {
            this.canvas.style.cursor = 'move';
        } else if (connectionPoint) {
            this.canvas.style.cursor = 'pointer';
        } else if (node) {
            this.canvas.style.cursor = this.connectStart ? 'pointer' : 'move';
        } else {
            this.canvas.style.cursor = 'default';
        }
        
        if (wasHovered !== this.hoveredNode || wasHoveredConnection !== this.hoveredConnection) {
            this.render();
        }
        
        if (this.connectStart) {
            this.render();
        }
    }

    onMouseUp(e) {
        // Завершаем выбор рамкой
        if (this.isSelecting) {
            this.isSelecting = false;
            this.selectionBox = null;
            this.updatePropertiesPanel();
            this.render();
            return;
        }
        
        // Сохраняем позиции при групповом перемещении
        if (this.isDragging && this.isMultiDragging && this.selectedNodes.length > 0) {
            // Сохраняем все выделенные узлы
            this.selectedNodes.forEach(node => {
                this.updateNode(node);
            });
            // Обновляем ссылки на узлы в связях
            this.updateConnectionsReferences();
            // Очищаем timeout и делаем финальный рендер
            if (this.renderTimeout) {
                clearTimeout(this.renderTimeout);
                this.renderTimeout = null;
            }
            this.render(); // Финальный рендер после перетаскивания
        } else if (this.isDragging && this.selectedNode) {
            this.updateNode(this.selectedNode);
            // Обновляем ссылки на узлы в связях
            this.updateConnectionsReferences();
            // Очищаем timeout и делаем финальный рендер
            if (this.renderTimeout) {
                clearTimeout(this.renderTimeout);
                this.renderTimeout = null;
            }
            this.render(); // Финальный рендер после перетаскивания
        }
        
        // Завершаем перемещение холста
        if (this.isPanning) {
            this.isPanning = false;
            this.canvas.style.cursor = 'default';
        }
        
        if (this.isResizing && this.selectedNode) {
            // Сохраняем изменения размера
            this.updateNode(this.selectedNode);
            this.isResizing = false;
            this.canvas.style.cursor = 'default';
            this.render();
            return;
        }
        
        this.isDragging = false;
        this.isMultiDragging = false;
    }

    onMouseLeave(e) {
        // Сбрасываем все состояния при выходе мыши за пределы canvas
        // Это исправляет баг с залипанием панорамирования
        if (this.isPanning) {
            this.isPanning = false;
            this.canvas.style.cursor = 'default';
        }
        if (this.isDragging) {
            this.isDragging = false;
            this.isMultiDragging = false;
            // Сохраняем позиции, если были изменения
            if (this.selectedNode) {
                this.updateNode(this.selectedNode);
            }
            if (this.selectedNodes.length > 0) {
                this.selectedNodes.forEach(node => {
                    this.updateNode(node);
                });
            }
            this.updateConnectionsReferences();
        }
        if (this.isResizing) {
            this.isResizing = false;
            if (this.selectedNode) {
                this.updateNode(this.selectedNode);
            }
            this.canvas.style.cursor = 'default';
        }
        if (this.isSelecting) {
            this.isSelecting = false;
            this.selectionBox = null;
            this.updatePropertiesPanel();
        }
        this.render();
    }
    
    updateSelectionFromBox() {
        if (!this.selectionBox || this.selectionBox.width === 0 || this.selectionBox.height === 0) {
            return;
        }
        
        const box = this.selectionBox;
        const selectedInBox = [];
        
        // Находим все узлы, которые пересекаются с рамкой
        this.nodes.forEach(node => {
            const nodeCenterX = node.x + node.width / 2;
            const nodeCenterY = node.y + node.height / 2;
            
            // Проверяем, находится ли центр узла внутри рамки
            if (nodeCenterX >= box.x && nodeCenterX <= box.x + box.width &&
                nodeCenterY >= box.y && nodeCenterY <= box.y + box.height) {
                selectedInBox.push(node);
            }
        });
        
        // Обновляем выделение
        this.selectedNodes = selectedInBox;
        if (selectedInBox.length > 0) {
            this.selectedNode = selectedInBox[0];
        } else {
            this.selectedNode = null;
        }
    }

    createConnectionFromPoints(sourceNode, sourcePoint, targetNode, targetPoint) {
        // Проверяем, что выход одного узла соединяется со входом другого
        if (sourcePoint.type !== 'output' || targetPoint.type !== 'input') {
            // Если типы не подходят, меняем узлы местами
            if (sourcePoint.type === 'input' && targetPoint.type === 'output') {
                [sourceNode, targetNode] = [targetNode, sourceNode];
                [sourcePoint, targetPoint] = [targetPoint, sourcePoint];
            } else {
                return; // Нельзя соединять вход с входом или выход с выходом
            }
        }
        
        // Проверяем ограничения на связи
        if (!this.validateConnection(sourceNode, targetNode)) {
            alert('Недопустимая связь!\n\nПравила:\n• Стартовый узел → только к кнопкам\n• Кнопки → только к сообщениям\n• Сообщения → только к кнопкам\n• НЕЛЬЗЯ: сообщение→сообщение, стартовый→сообщение, кнопка→кнопка');
            return;
        }
        
        // ВАЖНО: Находим узлы в массиве this.nodes, чтобы использовать правильные ссылки
        const actualSourceNode = this.nodes.find(n => n.id === sourceNode.id);
        const actualTargetNode = this.nodes.find(n => n.id === targetNode.id);
        
        if (!actualSourceNode || !actualTargetNode) {
            console.error('Nodes not found in this.nodes array');
            return;
        }
        
        const connection = {
            id: Date.now(),
            source: actualSourceNode,
            target: actualTargetNode,
            buttonText: '' // Пустой текст для кнопок
            // НЕ сохраняем sourcePoint и targetPoint, чтобы связь рисовалась от центров узлов
            // и автоматически обновлялась при их перемещении
        };
        
        this.connections.push(connection);
        this.render();
        
        fetch('/api/connections', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                source: sourceNode.id,
                target: targetNode.id,
                buttonText: '->' // Просто символ стрелки
            })
        })
        .then(response => response.json())
        .then(data => {
            connection.id = data.id;
            this.showNotification('Связь создана', 'success', 2000);
        })
        .catch(error => {
            console.error('Error creating connection:', error);
            this.showNotification('Ошибка при создании связи', 'error', 3000);
        });
    }

    onDoubleClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        // Учитываем зум и панорамирование при расчете координат
        const x = (e.clientX - rect.left - this.canvasOffset.x) / this.zoom;
        const y = (e.clientY - rect.top - this.canvasOffset.y) / this.zoom;
        
        const node = this.getNodeAt(x, y);
        if (node) {
            this.editNodeText(node);
        }
    }

    onWheel(e) {
        e.preventDefault();
        
        // Определяем тип устройства по deltaMode
        // 0 = DOM_DELTA_PIXEL (обычная мышь)
        // 1 = DOM_DELTA_LINE (скролл по строкам)
        // 2 = DOM_DELTA_PAGE (скролл по страницам)
        // Трекпады MacOS обычно дают большие значения deltaY в пикселях
        
        let zoomDelta = 0;
        const absDeltaY = Math.abs(e.deltaY);
        
        // Определяем, является ли это трекпадом (большие значения deltaY)
        const isTrackpad = absDeltaY > 50 || e.deltaMode === 0;
        
        if (isTrackpad) {
            // Для трекпадов: используем более плавное и медленное изменение зума
            // Нормализуем deltaY: делим на коэффициент для уменьшения чувствительности
            const trackpadSensitivity = 300; // Коэффициент для уменьшения чувствительности
            zoomDelta = -e.deltaY / trackpadSensitivity;
            
            // Ограничиваем максимальную скорость изменения зума
            const maxZoomDelta = 0.05; // Максимальное изменение за один шаг
            zoomDelta = Math.max(-maxZoomDelta, Math.min(maxZoomDelta, zoomDelta));
        } else {
            // Для обычной мыши: используем фиксированный шаг
            zoomDelta = e.deltaY > 0 ? -this.zoomStep : this.zoomStep;
        }
        
        // Вычисляем новый зум
        const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom + zoomDelta));
        
        if (newZoom !== this.zoom) {
            this.zoom = newZoom;
            this.render();
        }
    }

    onContextMenu(e) {
        e.preventDefault();
        // Предотвращаем появление контекстного меню
    }

    onKeyUp(e) {
        if (e.key === ' ' || e.key === 'Space') {
            // Проверяем, не находится ли фокус на поле ввода текста
            const activeElement = document.activeElement;
            const isTextInput = activeElement && (
                activeElement.id === 'node-text' || 
                activeElement.contentEditable === 'true' ||
                activeElement.tagName === 'INPUT' ||
                activeElement.tagName === 'TEXTAREA'
            );
            
            if (!isTextInput) {
            this.isSpacePressed = false;
            // При отпускании пробела восстанавливаем обычный курсор
            if (!this.isPanning && !this.hoveredNode && !this.connectStart) {
                this.canvas.style.cursor = 'default';
                }
            }
        }
    }

    // Функции зума
    zoomIn() {
        console.log('Zoom in clicked, current zoom:', this.zoom);
        this.zoom = Math.min(this.zoom + this.zoomStep, this.maxZoom);
        console.log('New zoom:', this.zoom);
        this.render();
    }

    zoomOut() {
        console.log('Zoom out clicked, current zoom:', this.zoom);
        this.zoom = Math.max(this.zoom - this.zoomStep, this.minZoom);
        console.log('New zoom:', this.zoom);
        this.render();
    }

    zoomReset() {
        console.log('Zoom reset clicked');
        this.zoom = 1;
        this.centerOnStartNode();
        console.log('Reset zoom to:', this.zoom);
        this.render();
    }
    
    centerOnStartNode() {
        // Находим стартовый узел
        const startNode = this.nodes.find(n => n.type === 'start');
        
        if (startNode && this.canvas) {
            // Центрируем холст на стартовом узле
            const centerX = startNode.x + startNode.width / 2;
            const centerY = startNode.y + startNode.height / 2;
            
            // Получаем актуальные размеры canvas
            const canvasWidth = this.canvas.width || this.canvas.offsetWidth;
            const canvasHeight = this.canvas.height || this.canvas.offsetHeight;
            
            // Центрируем на экране
            this.canvasOffset.x = canvasWidth / 2 - centerX * this.zoom;
            this.canvasOffset.y = canvasHeight / 2 - centerY * this.zoom;
        } else {
            // Если стартового узла нет, просто сбрасываем смещение
            this.canvasOffset = { x: 0, y: 0 };
        }
    }

    validateConnection(sourceNode, targetNode) {
        // Правила связей:
        // 1. От стартового узла можно вести только к кнопкам
        if (sourceNode.type === 'start' && targetNode.type !== 'button') {
            return false;
        }
        
        // 2. Кнопки могут вести только к сообщениям
        if (sourceNode.type === 'button' && targetNode.type !== 'message') {
            return false;
        }
        
        // 3. Сообщения могут вести только к кнопкам
        if (sourceNode.type === 'message' && targetNode.type !== 'button') {
            return false;
        }
        
        // 4. К одному сообщению могут вести несколько кнопок (разрешено)
        // 5. Из сообщения могут вести несколько кнопок (разрешено)
        
        return true;
    }

    createConnection(source, target) {
        // Проверяем ограничения на связи
        if (!this.validateConnection(source, target)) {
            alert('Недопустимая связь!\n\nПравила:\n• Стартовый узел → только к кнопкам\n• Кнопки → только к сообщениям\n• Сообщения → только к кнопкам\n• НЕЛЬЗЯ: сообщение→сообщение, стартовый→сообщение, кнопка→кнопка');
            return;
        }
        
        // ВАЖНО: Находим узлы в массиве this.nodes, чтобы использовать правильные ссылки
        const actualSourceNode = this.nodes.find(n => n.id === source.id);
        const actualTargetNode = this.nodes.find(n => n.id === target.id);
        
        if (!actualSourceNode || !actualTargetNode) {
            console.error('Nodes not found in this.nodes array');
            return;
        }
        
        const connection = {
            id: Date.now(),
            source: actualSourceNode,
            target: actualTargetNode,
            buttonText: '' // Пустой текст
        };
        
        this.connections.push(connection);
        this.render();
        
        fetch('/api/connections', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                source: source.id,
                target: target.id,
                buttonText: '->'
            })
        })
        .then(response => response.json())
        .then(data => {
            connection.id = data.id;
            this.showNotification('Связь создана', 'success', 2000);
        })
        .catch(error => {
            console.error('Error creating connection:', error);
            this.showNotification('Ошибка при создании связи', 'error', 3000);
        });
    }

    getNodeAt(x, y) {
        return this.nodes.find(node => 
            x >= node.x && x <= node.x + node.width &&
            y >= node.y && y <= node.y + node.height
        );
    }

    getConnectionAt(x, y) {
        return this.connections.find(conn => {
            const dist = this.pointToLineDistance(
                x, y,
                conn.source.x + conn.source.width / 2,
                conn.source.y + conn.source.height / 2,
                conn.target.x + conn.target.width / 2,
                conn.target.y + conn.target.height / 2
            );
            return dist < 5;
        });
    }

    pointToLineDistance(px, py, x1, y1, x2, y2) {
        const A = px - x1;
        const B = py - y1;
        const C = x2 - x1;
        const D = y2 - y1;
        
        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        let param = -1;
        
        if (lenSq !== 0) param = dot / lenSq;
        
        let xx, yy;
        
        if (param < 0) {
            xx = x1;
            yy = y1;
        } else if (param > 1) {
            xx = x2;
            yy = y2;
        } else {
            xx = x1 + param * C;
            yy = y1 + param * D;
        }
        
        const dx = px - xx;
        const dy = py - yy;
        return Math.sqrt(dx * dx + dy * dy);
    }

    updateNode(node) {
        fetch(`/api/nodes/${node.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: node.name,
                text: node.text,
                x: node.x,
                y: node.y,
                width: node.width,
                height: node.height
            })
        })
        .then(response => {
            if (response.ok) {
                this.showNotification('Блок сохранен', 'success', 2000);
            } else {
                this.showNotification('Ошибка при сохранении блока', 'error', 3000);
            }
        })
        .catch(error => {
            console.error('Error updating node:', error);
            this.showNotification('Ошибка при сохранении блока', 'error', 3000);
        });
    }

    editNodeText(node) {
        // Убираем ввод текста при клике на блок - теперь редактирование только через панель свойств
        // const newText = prompt('Текст сообщения:', node.text);
        // if (newText !== null) {
        //     node.text = newText;
        //     this.updateNode(node);
        //     this.updatePropertiesPanel();
        //     this.render();
        // }
    }

    updatePropertiesPanel() {
        const panel = document.getElementById('properties');
        
        // Проверяем множественное выделение
        if (this.selectedNodes.length > 1) {
            panel.innerHTML = `
                <h3>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: inline-block; margin-right: 6px; vertical-align: middle;">
                        <circle cx="12" cy="12" r="3"></circle>
                        <path d="M12 1v6m0 6v6m4.22-13.22l4.24 4.24M1.54 1.54l4.24 4.24M1 12h6m6 0h6"></path>
                    </svg>
                    Множественное выделение
                </h3>
                <p>Выбрано блоков: <strong>${this.selectedNodes.length}</strong></p>
                <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 20px;">
                    <button class="btn-primary" onclick="copySelectedNodes()" style="width: 100%;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: inline-block; margin-right: 4px; vertical-align: middle;">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                        Скопировать группу
                    </button>
                    <button class="btn-danger" onclick="deleteSelectedNodes()" style="width: 100%;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: inline-block; margin-right: 4px; vertical-align: middle;">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                        Удалить группу
                    </button>
                </div>
                <p style="color: #b3b3b3; font-size: 12px; margin-top: 10px;">
                    ПКМ на выделенном узле - переместить группу<br>
                    ЛКМ - перемещение холста
                </p>
                ${this.connectionMode ? '<p style="color: #4a9eff; margin-top: 10px;">🔗 Режим создания связей: нажмите на два узла для соединения</p>' : ''}
            `;
            return;
        }
        
        if (!this.selectedNode) {
            panel.innerHTML = `
                <h3>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: inline-block; margin-right: 6px; vertical-align: middle;">
                        <circle cx="12" cy="12" r="3"></circle>
                        <path d="M12 1v6m0 6v6m4.22-13.22l4.24 4.24M1.54 1.54l4.24 4.24M1 12h6m6 0h6"></path>
                    </svg>
                    Свойства
                </h3>
                <p>Выберите узел для редактирования</p>
                <p style="color: #b3b3b3; font-size: 12px; margin-top: 10px;">
                    ПКМ на узле - выделение<br>
                    ПКМ на пустом месте - выбор рамкой<br>
                    ЛКМ - перемещение и взаимодействие
                </p>
                ${this.connectionMode ? '<p style="color: #4a9eff; margin-top: 10px;">🔗 Режим создания связей: нажмите на два узла для соединения</p>' : ''}
            `;
            return;
        }
        
        panel.innerHTML = `
            <h3>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: inline-block; margin-right: 6px; vertical-align: middle;">
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M12 1v6m0 6v6m4.22-13.22l4.24 4.24M1.54 1.54l4.24 4.24M1 12h6m6 0h6"></path>
                </svg>
                Свойства узла
            </h3>
            <div class="form-group">
                <label>Тип узла</label>
                <input type="text" value="${this.selectedNode.type}" disabled>
            </div>
            <div class="form-group">
                <label>Название блока</label>
                <input type="text" id="node-name" value="${this.selectedNode.name || ''}" placeholder="Введите название">
            </div>
            <div class="form-group">
                <label>Текст сообщения</label>
                <div class="editor-toolbar">
                    <button class="editor-btn" onclick="formatText('bold')"><b>B</b></button>
                    <button class="editor-btn" onclick="formatText('italic')"><i>I</i></button>
                    <button class="editor-btn" onclick="formatText('underline')"><u>U</u></button>
                    <button class="editor-btn" onclick="createLink()" title="Создать ссылку"><a>L</a></button>
                </div>
                <div class="text-editor" contenteditable="true" id="node-text">${this.selectedNode.text}</div>
            </div>
            <div class="form-group">
                <label>Позиция X</label>
                <input type="number" id="node-x" value="${Math.round(this.selectedNode.x)}">
            </div>
            <div class="form-group">
                <label>Позиция Y</label>
                <input type="number" id="node-y" value="${Math.round(this.selectedNode.y)}">
            </div>
            ${this.selectedNode.type !== 'button' ? `
            <div class="image-upload">
                <input type="file" id="image-input" accept="image/*" multiple>
                <label for="image-input">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: inline-block; margin-right: 6px; vertical-align: middle;">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                        <circle cx="8.5" cy="8.5" r="1.5"></circle>
                        <polyline points="21 15 16 10 5 21"></polyline>
                    </svg>
                    Добавить изображения
                </label>
                <div class="image-list" id="image-list"></div>
            </div>
            ` : ''}
            <div style="display: flex; gap: 10px; margin-top: 20px;">
                <button class="btn-primary" onclick="copySelectedNode()" style="flex: 1;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: inline-block; margin-right: 4px; vertical-align: middle;">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                    Скопировать
                </button>
                <button class="btn-danger" onclick="deleteSelectedNode()" style="flex: 1;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: inline-block; margin-right: 4px; vertical-align: middle;">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                        ${this.selectedNode.type === 'start' ? 'Удалить стартовый узел' : 'Удалить'}
                    </button>
            </div>
            ${this.connectionMode ? '<p style="color: #4a9eff; margin-top: 10px;">🔗 Нажмите на другой узел для создания связи</p>' : ''}
        `;
        
        // Автосохранение названия
        const nameInput = document.getElementById('node-name');
        if (nameInput) {
            let nameSaveTimeout;
            nameInput.addEventListener('input', () => {
                this.selectedNode.name = nameInput.value;
                
                // Автоматическое сохранение с задержкой (debounce)
                clearTimeout(nameSaveTimeout);
                nameSaveTimeout = setTimeout(() => {
                    this.updateNode(this.selectedNode);
                    this.render();
                }, 500);
            });
        }
        
        const textEditor = document.getElementById('node-text');
        if (textEditor) {
            let textSaveTimeout;
            textEditor.addEventListener('input', () => {
                // Сохраняем текст с сохранением пробелов и форматирования
                const cleanedHtml = cleanHtmlForTelegram(textEditor.innerHTML);
                this.selectedNode.text = cleanedHtml;
                
                // Автоматическое сохранение с задержкой (debounce)
                clearTimeout(textSaveTimeout);
                textSaveTimeout = setTimeout(() => {
                    this.updateNode(this.selectedNode);
                }, 1000); // Сохранение через 1 секунду после окончания ввода
            });
            
            // Убираем обработчик keydown для пробела, чтобы он работал нормально
        }
        
        // Автоматическое сохранение при изменении координат
        const nodeX = document.getElementById('node-x');
        const nodeY = document.getElementById('node-y');
        if (nodeX) {
            nodeX.addEventListener('change', () => {
                this.selectedNode.x = parseInt(nodeX.value);
                this.updateNode(this.selectedNode);
                this.render();
            });
        }
        if (nodeY) {
            nodeY.addEventListener('change', () => {
                this.selectedNode.y = parseInt(nodeY.value);
                this.updateNode(this.selectedNode);
                this.render();
            });
        }
        
        const imageInput = document.getElementById('image-input');
        if (imageInput) {
            imageInput.addEventListener('change', this.handleImageUpload.bind(this));
        }
        
        this.loadNodeImages();
    }

    handleImageUpload(e) {
        const files = e.target.files;
        for (let file of files) {
            // Проверяем, что это изображение
            if (!file.type.startsWith('image/')) {
                alert('Пожалуйста, выберите только изображения');
                continue;
            }
            
            const formData = new FormData();
            formData.append('file', file);
            
            fetch(`/api/upload/${this.selectedNode.id}`, {
                method: 'POST',
                body: formData
            })
            .then(response => response.json())
            .then(data => {
                if (data.error) {
                    alert(data.error);
                } else {
                    this.loadNodeImages();
                }
            });
        }
    }

    loadNodeImages() {
        if (!this.selectedNode) return;
        
        fetch('/api/nodes')
        .then(response => response.json())
        .then(nodes => {
            const nodeData = nodes.find(n => n.id === this.selectedNode.id);
            const imageList = document.getElementById('image-list');
            
            if (nodeData && nodeData.media && nodeData.media.length > 0) {
                // Фильтруем только изображения
                const images = nodeData.media.filter(file => file.type === 'image');
                if (images.length > 0) {
                    imageList.innerHTML = images.map(image => `
                        <div class="image-item">
                            <img src="/uploads/${image.filename}" alt="${image.filename}" data-image-src="/uploads/${image.filename}" data-image-name="${image.filename.replace(/"/g, '&quot;')}" style="width: 50px; height: 50px; object-fit: cover; border-radius: 4px; margin-right: 8px; cursor: pointer;">
                            <div class="image-info">
                                <div class="image-name">${image.filename}</div>
                                <button class="image-delete" onclick="event.stopPropagation(); deleteImage('${image.filename}')">Удалить</button>
                            </div>
                    </div>
                `).join('');
            } else {
                    imageList.innerHTML = '<p style="color: #666; font-size: 12px;">Нет изображений</p>';
                }
            } else {
                imageList.innerHTML = '<p style="color: #666; font-size: 12px;">Нет изображений</p>';
            }
        });
    }

    openImageModal(imageSrc, imageName) {
        let modal = document.getElementById('image-modal');
        let modalImg = document.getElementById('image-modal-img');
        let modalName = document.getElementById('image-modal-name');
        
        // Если модальное окно не существует, создаем его
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'image-modal';
            modal.className = 'image-modal';
            modal.innerHTML = `
                <div class="image-modal-content">
                    <span class="image-modal-close">&times;</span>
                    <img id="image-modal-img" src="" alt="">
                    <div id="image-modal-name" class="image-modal-name"></div>
                </div>
            `;
            document.body.appendChild(modal);
            modalImg = document.getElementById('image-modal-img');
            modalName = document.getElementById('image-modal-name');
        }
        
        if (!modalImg || !modalName) {
            console.error('Не удалось создать или найти элементы модального окна');
            return;
        }
        
        modalImg.src = imageSrc;
        modalName.textContent = imageName || '';
        modal.classList.add('show');
    }

    closeImageModal() {
        const modal = document.getElementById('image-modal');
        modal.classList.remove('show');
    }

    getDeleteButtonAt(x, y) {
        for (let node of this.nodes) {
            const nameHeight = 28;
            const deleteBtnSize = 20;
            const deleteBtnX = node.x + node.width - deleteBtnSize - 4;
            const deleteBtnY = node.y + nameHeight + 4;
            
            if (x >= deleteBtnX && x <= deleteBtnX + deleteBtnSize &&
                y >= deleteBtnY && y <= deleteBtnY + deleteBtnSize) {
                return { node, button: 'delete' };
            }
        }
        return null;
    }
    
    getResizeHandleAt(x, y) {
        for (let node of this.nodes) {
            const resizeHandleX = node.x + node.width - this.resizeHandleSize - 2;
            const resizeHandleY = node.y + node.height - this.resizeHandleSize - 2;
            
            if (x >= resizeHandleX && x <= node.x + node.width - 2 &&
                y >= resizeHandleY && y <= node.y + node.height - 2) {
                return { node };
            }
        }
        return null;
    }

    deleteNode(node) {
        if (!node) return;
        
        const nodeType = node.type === 'start' ? 'стартовый узел' : 'этот узел';
        
        if (confirm(`Удалить ${nodeType} и все связи?`)) {
            fetch(`/api/nodes/${node.id}`, {
                method: 'DELETE'
            })
            .then(response => {
                if (response.ok) {
                this.nodes = this.nodes.filter(n => n !== node);
                this.connections = this.connections.filter(c => 
                    c.source !== node && c.target !== node
                );
                
                if (this.selectedNode === node) {
                    this.selectedNode = null;
                    this.updatePropertiesPanel();
                }
                
                if (this.hoveredNode === node) {
                    this.hoveredNode = null;
                }
                
                this.render();
                    this.showNotification('Блок удален', 'success', 2000);
                } else {
                    this.showNotification('Ошибка при удалении блока', 'error', 3000);
                }
            })
            .catch(error => {
                console.error('Ошибка при удалении узла:', error);
                this.showNotification('Ошибка при удалении блока', 'error', 3000);
            });
        }
    }

    deleteSelectedNode() {
        this.deleteNode(this.selectedNode);
    }

    copyNode(node) {
        if (!node) return;
        
        // Нельзя копировать стартовый узел
        if (node.type === 'start') {
            alert('Стартовый узел нельзя копировать. Создайте новый стартовый узел вручную.');
            return;
        }
        
        // Смещение для копии (правее и ниже оригинала)
        const offsetX = 50;
        const offsetY = 50;
        
        // Создаем копию узла
        const copiedNode = {
            id: Date.now(), // Временный ID, будет заменен после создания на сервере
            type: node.type,
            name: (node.name || 'Блок') + ' (копия)',
            text: node.text || '',
            x: node.x + offsetX,
            y: node.y + offsetY,
            width: node.width || 200,
            height: node.height || 80
        };
        
        // Добавляем узел в массив
        this.nodes.push(copiedNode);
        this.selectedNode = copiedNode;
        this.render();
        
        // Создаем узел на сервере
        fetch('/api/nodes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: copiedNode.type,
                name: copiedNode.name,
                text: copiedNode.text,
                x: copiedNode.x,
                y: copiedNode.y,
                width: copiedNode.width,
                height: copiedNode.height
            })
        })
        .then(response => response.json())
        .then(data => {
            copiedNode.id = data.id;
            
            // Копируем изображения, если они есть
            fetch('/api/nodes')
                .then(response => response.json())
                .then(nodes => {
                    const originalNodeData = nodes.find(n => n.id === node.id);
                    if (originalNodeData && originalNodeData.media && originalNodeData.media.length > 0) {
                        const images = originalNodeData.media.filter(file => file.type === 'image');
                        
                        // Копируем каждое изображение
                        images.forEach((image, index) => {
                            // Загружаем изображение как файл для нового узла
                            fetch(`/uploads/${image.filename}`)
                                .then(response => {
                                    if (!response.ok) {
                                        throw new Error('Не удалось загрузить изображение');
                                    }
                                    return response.blob();
                                })
                                .then(blob => {
                                    // Создаем новый файл с оригинальным именем
                                    const file = new File([blob], image.filename, { type: blob.type });
                                    const formData = new FormData();
                                    formData.append('file', file);
                                    
                                    return fetch(`/api/upload/${copiedNode.id}`, {
                                        method: 'POST',
                                        body: formData
                                    });
                                })
                                .then(response => {
                                    if (!response.ok) {
                                        throw new Error('Не удалось загрузить копию изображения');
                                    }
                                    // Обновляем панель свойств после копирования всех изображений
                                    if (index === images.length - 1) {
                                        setTimeout(() => {
                                            this.loadNodeImages();
                                        }, 500);
                                    }
                                })
                                .catch(error => {
                                    console.error('Ошибка при копировании изображения:', error);
                                });
                        });
                    }
                })
                .catch(error => {
                    console.error('Ошибка при получении изображений:', error);
                });
            
            this.updatePropertiesPanel();
            this.showNotification('Блок скопирован', 'success', 2000);
        })
        .catch(error => {
            console.error('Ошибка при копировании узла:', error);
            // Удаляем узел из массива в случае ошибки
            this.nodes = this.nodes.filter(n => n !== copiedNode);
            this.selectedNode = null;
            this.updatePropertiesPanel();
            this.render();
            this.showNotification('Ошибка при копировании блока', 'error', 3000);
        });
    }

    copySelectedNode() {
        this.copyNode(this.selectedNode);
    }

    copySelectedNodes() {
        if (!this.selectedNodes || this.selectedNodes.length === 0) {
            return;
        }
        
        // Проверяем, нет ли стартового узла в выделении
        const hasStartNode = this.selectedNodes.some(node => node.type === 'start');
        if (hasStartNode) {
            alert('Нельзя копировать группу, содержащую стартовый узел. Уберите стартовый узел из выделения.');
            return;
        }
        
        // Вычисляем смещение для группы (правее и ниже оригинала)
        const offsetX = 50;
        const offsetY = 50;
        
        // Находим минимальные координаты для вычисления относительных позиций
        const minX = Math.min(...this.selectedNodes.map(n => n.x));
        const minY = Math.min(...this.selectedNodes.map(n => n.y));
        
        // Создаем маппинг старых ID на новые узлы
        const nodeMapping = new Map(); // oldNode -> newCopiedNode
        const copiedNodes = [];
        const copyPromises = [];
        
        // Сначала создаем все узлы на сервере
        this.selectedNodes.forEach((originalNode, index) => {
            const relativeX = originalNode.x - minX;
            const relativeY = originalNode.y - minY;
            
            const copiedNode = {
                id: Date.now() + index, // Временный ID
                type: originalNode.type,
                name: (originalNode.name || 'Блок') + ' (копия)',
                text: originalNode.text || '',
                x: minX + offsetX + relativeX,
                y: minY + offsetY + relativeY,
                width: originalNode.width || 200,
                height: originalNode.height || 80,
                originalNode: originalNode // Сохраняем ссылку на оригинал для копирования изображений
            };
            
            copiedNodes.push(copiedNode);
            nodeMapping.set(originalNode.id, copiedNode);
            
            // Добавляем узел в массив сразу для визуализации
            this.nodes.push(copiedNode);
            
            // Создаем промис для создания узла на сервере
            const promise = fetch('/api/nodes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: copiedNode.type,
                    name: copiedNode.name,
                    text: copiedNode.text,
                    x: copiedNode.x,
                    y: copiedNode.y,
                    width: copiedNode.width,
                    height: copiedNode.height
                })
            })
            .then(response => response.json())
            .then(data => {
                copiedNode.id = data.id;
                return { copiedNode, originalNode };
            });
            
            copyPromises.push(promise);
        });
        
        // Ждем создания всех узлов на сервере
        Promise.all(copyPromises)
            .then(results => {
                // Копируем изображения для всех узлов
                const imageCopyPromises = [];
                
                results.forEach(({ copiedNode, originalNode }) => {
                    // Копируем изображения
                    fetch('/api/nodes')
                        .then(response => response.json())
                        .then(nodes => {
                            const originalNodeData = nodes.find(n => n.id === originalNode.id);
                            if (originalNodeData && originalNodeData.media && originalNodeData.media.length > 0) {
                                const images = originalNodeData.media.filter(file => file.type === 'image');
                                
                                images.forEach(image => {
                                    fetch(`/uploads/${image.filename}`)
                                        .then(response => {
                                            if (!response.ok) return null;
                                            return response.blob();
                                        })
                                        .then(blob => {
                                            if (!blob) return;
                                            const file = new File([blob], image.filename, { type: blob.type });
                                            const formData = new FormData();
                                            formData.append('file', file);
                                            
                                            return fetch(`/api/upload/${copiedNode.id}`, {
                                                method: 'POST',
                                                body: formData
                                            });
                                        })
                                        .catch(error => {
                                            console.error('Ошибка при копировании изображения:', error);
                                        });
                                });
                            }
                        });
                });
                
                // Выделяем все скопированные узлы
                this.selectedNodes = copiedNodes;
                this.selectedNode = copiedNodes[0];
                
                this.updatePropertiesPanel();
                this.render();
                this.showNotification(`Скопировано блоков: ${copiedNodes.length}`, 'success', 2000);
            })
            .catch(error => {
                console.error('Ошибка при копировании группы узлов:', error);
                // Удаляем все скопированные узлы из массива в случае ошибки
                copiedNodes.forEach(node => {
                    this.nodes = this.nodes.filter(n => n !== node);
                });
                this.selectedNode = null;
                this.selectedNodes = [];
                this.updatePropertiesPanel();
                this.render();
                this.showNotification('Ошибка при копировании группы блоков', 'error', 3000);
            });
    }

    deleteSelectedNodes() {
        if (!this.selectedNodes || this.selectedNodes.length === 0) {
            return;
        }
        
        // Проверяем, есть ли стартовый узел в выделении
        const startNodes = this.selectedNodes.filter(node => node.type === 'start');
        if (startNodes.length > 0) {
            alert('Нельзя удалить стартовый узел. Уберите стартовый узел из выделения.');
            return;
        }
        
        const count = this.selectedNodes.length;
        const nodeType = count === 1 ? 'блок' : (count < 5 ? 'блока' : 'блоков');
        
        if (!confirm(`Удалить ${count} ${nodeType} и все связанные связи?`)) {
            return;
        }
        
        // Создаем копию массива для удаления
        const nodesToDelete = [...this.selectedNodes];
        const deletePromises = [];
        
        // Удаляем каждый узел на сервере
        nodesToDelete.forEach(node => {
            const promise = fetch(`/api/nodes/${node.id}`, {
                method: 'DELETE'
            })
            .then(response => {
                if (response.ok) {
                    // Удаляем узел из массива
                    this.nodes = this.nodes.filter(n => n !== node);
                    // Удаляем все связи, связанные с этим узлом
                    this.connections = this.connections.filter(c => 
                        c.source !== node && c.target !== node
                    );
                    return true;
                } else {
                    throw new Error(`Ошибка при удалении узла ${node.id}`);
                }
            });
            
            deletePromises.push(promise);
        });
        
        // Ждем удаления всех узлов
        Promise.all(deletePromises)
            .then(() => {
                // Очищаем выделение
                this.selectedNode = null;
                this.selectedNodes = [];
                
                // Очищаем hoveredNode, если он был удален
                if (this.hoveredNode && nodesToDelete.includes(this.hoveredNode)) {
                    this.hoveredNode = null;
                }
                
                this.updatePropertiesPanel();
                this.render();
                this.showNotification(`Удалено блоков: ${count}`, 'success', 2000);
            })
            .catch(error => {
                console.error('Ошибка при удалении группы узлов:', error);
                this.showNotification('Ошибка при удалении группы блоков', 'error', 3000);
            });
    }

    getConnectionAt(x, y) {
        for (let conn of this.connections) {
            let fromX, fromY, toX, toY;
            
            if (conn.sourcePoint) {
                fromX = conn.sourcePoint.x;
                fromY = conn.sourcePoint.y;
            } else {
                fromX = conn.source.x + conn.source.width / 2;
                fromY = conn.source.y + conn.source.height / 2;
            }
            
            if (conn.targetPoint) {
                toX = conn.targetPoint.x;
                toY = conn.targetPoint.y;
            } else {
                toX = conn.target.x + conn.target.width / 2;
                toY = conn.target.y + conn.target.height / 2;
            }
            
            // Проверяем, находится ли точка рядом с кривой Безье связи
            const distance = this.distanceToBezierCurve(x, y, fromX, fromY, toX, toY);
            if (distance < 8) { // 8px радиус для наведения (более строгая проверка)
                return conn;
            }
        }
        return null;
    }

    distanceToBezierCurve(px, py, fromX, fromY, toX, toY) {
        // Вычисляем контрольные точки так же, как в drawArrow
        const distance = Math.sqrt((toX - fromX) ** 2 + (toY - fromY) ** 2);
        if (distance === 0) return Infinity;
        
        const offset = Math.min(distance * 0.3, 50);
        const perpX = -(toY - fromY) / distance;
        const perpY = (toX - fromX) / distance;
        
        const control1X = fromX + (toX - fromX) * 0.3 + perpX * offset;
        const control1Y = fromY + (toY - fromY) * 0.3 + perpY * offset;
        const control2X = fromX + (toX - fromX) * 0.7 - perpX * offset;
        const control2Y = fromY + (toY - fromY) * 0.7 - perpY * offset;
        
        // Вычисляем угол для стрелки
        const angle = Math.atan2(toY - fromY, toX - fromX);
        const headLength = 15;
        const endX = toX - headLength * Math.cos(angle);
        const endY = toY - headLength * Math.sin(angle);
        
        // Проверяем расстояние до кубической кривой Безье
        // Используем метод деления пополам для поиска ближайшей точки на кривой
        let minDistance = Infinity;
        const steps = 50; // Количество точек для проверки
        
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            // Формула кубической кривой Безье
            const curveX = (1 - t) ** 3 * fromX + 
                          3 * (1 - t) ** 2 * t * control1X + 
                          3 * (1 - t) * t ** 2 * control2X + 
                          t ** 3 * endX;
            const curveY = (1 - t) ** 3 * fromY + 
                          3 * (1 - t) ** 2 * t * control1Y + 
                          3 * (1 - t) * t ** 2 * control2Y + 
                          t ** 3 * endY;
            
            const dist = Math.sqrt((px - curveX) ** 2 + (py - curveY) ** 2);
            if (dist < minDistance) {
                minDistance = dist;
            }
        }
        
        return minDistance;
    }

    getConnectionDeleteButtonAt(x, y) {
        // Проверяем кнопку удаления только для наведенной связи
        if (!this.hoveredConnection) {
            return null;
        }
        
        const conn = this.hoveredConnection;
            let fromX, fromY, toX, toY;
            
            if (conn.sourcePoint) {
                fromX = conn.sourcePoint.x;
                fromY = conn.sourcePoint.y;
            } else {
                fromX = conn.source.x + conn.source.width / 2;
                fromY = conn.source.y + conn.source.height / 2;
            }
            
            if (conn.targetPoint) {
                toX = conn.targetPoint.x;
                toY = conn.targetPoint.y;
            } else {
                toX = conn.target.x + conn.target.width / 2;
                toY = conn.target.y + conn.target.height / 2;
            }
            
            const controlX = (fromX + toX) / 2;
            const controlY = (fromY + toY) / 2;
            const deleteBtnSize = 16;
            const deleteBtnX = controlX - deleteBtnSize / 2;
            const deleteBtnY = controlY - deleteBtnSize / 2 - 15;
            
        // Более строгая проверка - проверяем расстояние до центра кнопки
        const centerX = deleteBtnX + deleteBtnSize / 2;
        const centerY = deleteBtnY + deleteBtnSize / 2;
        const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
        
        if (distance <= deleteBtnSize / 2) {
                return conn;
            }
        
        return null;
    }

    updateConnectionsReferences() {
        // Обновляем ссылки на узлы для всех связей
        this.connections.forEach(conn => {
            if (typeof conn.source === 'number' || typeof conn.source === 'string') {
                const foundSource = this.nodes.find(n => n.id === conn.source);
                console.log('Updating source for connection', conn.id, 'from', conn.source, 'to', foundSource);
                conn.source = foundSource;
            }
            if (typeof conn.target === 'number' || typeof conn.target === 'string') {
                const foundTarget = this.nodes.find(n => n.id === conn.target);
                console.log('Updating target for connection', conn.id, 'from', conn.target, 'to', foundTarget);
                conn.target = foundTarget;
            }
        });
    }

    deleteConnection(connection) {
        if (!connection) return;
        
        if (confirm('Удалить эту связь?')) {
            fetch(`/api/connections/${connection.id}`, {
                method: 'DELETE'
            })
            .then(response => {
                if (response.ok) {
                this.connections = this.connections.filter(c => c !== connection);
                
                if (this.selectedConnection === connection) {
                    this.selectedConnection = null;
                }
                
                this.render();
                    this.showNotification('Связь удалена', 'success', 2000);
                } else {
                    this.showNotification('Ошибка при удалении связи', 'error', 3000);
                }
            })
            .catch(error => {
                console.error('Ошибка при удалении связи:', error);
                this.showNotification('Ошибка при удалении связи', 'error', 3000);
            });
        }
    }

    clearWorkflow() {
        if (confirm('Удалить все узлы и связи?')) {
            // Удаляем все узлы с сервера
            const deletePromises = this.nodes.map(node => 
                fetch(`/api/nodes/${node.id}`, { method: 'DELETE' })
            );
            
            // Удаляем все связи с сервера
            const deleteConnectionPromises = this.connections.map(conn => 
                fetch(`/api/connections/${conn.id}`, { method: 'DELETE' })
            );
            
            Promise.all([...deletePromises, ...deleteConnectionPromises])
            .then(() => {
                this.nodes = [];
                this.connections = [];
                this.selectedNode = null;
                this.selectedNodes = [];
                this.connectStart = null;
                this.connectStartPoint = null;
                this.connectionPreview = null;
                this.hoveredNode = null;
                this.updatePropertiesPanel();
                this.render();
            })
            .catch(error => {
                console.error('Ошибка при очистке:', error);
                alert('Произошла ошибка при очистке. Пожалуйста, попробуйте еще раз.');
            });
        }
    }

    autoLayout() {
        const startX = 100;
        const startY = 100;
        const horizontalSpacing = 250;
        const verticalSpacing = 120;
        
        // Находим стартовый узел
        const startNode = this.nodes.find(node => node.type === 'start');
        if (!startNode) {
            console.log('No start node found for auto layout');
            return;
        }
        
        // Создаем карту посещенных узлов
        const visited = new Set();
        const levels = [];
        
        // Функция для обхода графа по уровням
        const traverseByLevels = (node, level = 0) => {
            if (visited.has(node.id)) return;
            visited.add(node.id);
            
            if (!levels[level]) {
                levels[level] = [];
            }
            levels[level].push(node);
            
            // Находим все узлы, к которым ведет текущий узел
            const connectedNodes = this.connections
                .filter(conn => conn.source.id === node.id)
                .map(conn => conn.target)
                .filter(target => target && !visited.has(target.id));
            
            // Рекурсивно обходим связанные узлы
            connectedNodes.forEach(connectedNode => {
                traverseByLevels(connectedNode, level + 1);
            });
        };
        
        // Начинаем обход со стартового узла
        traverseByLevels(startNode);
        
        // Располагаем узлы по уровням
        let yOffset = startY;
        levels.forEach((levelNodes, levelIndex) => {
            levelNodes.forEach((node, index) => {
                node.x = startX + (index % 3) * horizontalSpacing;
                node.y = yOffset + Math.floor(index / 3) * verticalSpacing;
                this.updateNode(node);
            });
            yOffset += Math.ceil(levelNodes.length / 3) * verticalSpacing + 50;
        });
        
        this.render();
    }

    loadWorkflow() {
        fetch('/api/nodes')
        .then(response => response.json())
        .then(nodes => {
            this.nodes = nodes.map(node => ({
                ...node,
                name: node.name || 'Блок',
                width: node.width || 200,
                height: node.height || 80
            }));
            
            return fetch('/api/connections');
        })
        .then(response => response.json())
        .then(connections => {
            this.connections = connections.map(conn => ({
                ...conn,
                source: this.nodes.find(n => n.id === conn.source),
                target: this.nodes.find(n => n.id === conn.target)
            })).filter(conn => conn.source && conn.target);
            
            // Убеждаемся, что все связи имеют правильные ссылки на узлы
            this.updateConnectionsReferences();
            
            // Центрируем на стартовом узле при загрузке
            this.centerOnStartNode();
            
            this.render();
        });
    }

    render() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Применяем трансформации зума и панорамирования
        this.ctx.save();
        this.ctx.translate(this.canvasOffset.x, this.canvasOffset.y);
        this.ctx.scale(this.zoom, this.zoom);
        
        console.log('Rendering with zoom:', this.zoom, 'offset:', this.canvasOffset);
        
        this.drawConnections();
        this.drawConnectionPreview();
        this.drawNodes();
        this.drawConnectionPoints();
        
        // Рисуем рамку выбора после узлов
        this.drawSelectionBox();
        
        this.ctx.restore();
    }
    
    renderConnections() {
        // Быстрый рендер только связей (для перетаскивания)
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Применяем трансформации зума и панорамирования
        this.ctx.save();
        this.ctx.translate(this.canvasOffset.x, this.canvasOffset.y);
        this.ctx.scale(this.zoom, this.zoom);
        
        this.drawConnections();
        this.drawNodes();
        this.drawConnectionPreview();
        this.drawSelectionBox();
        
        this.ctx.restore();
    }
    
    throttledRender() {
        // Throttled render для плавного перетаскивания
        const now = Date.now();
        if (now - this.lastRenderTime < 16) { // ~60 FPS
            if (this.renderTimeout) {
                clearTimeout(this.renderTimeout);
            }
            this.renderTimeout = setTimeout(() => {
                this.renderConnections();
                this.lastRenderTime = Date.now();
            }, 16 - (now - this.lastRenderTime));
        } else {
            this.renderConnections();
            this.lastRenderTime = now;
        }
    }


    drawNodes() {
        this.nodes.forEach(node => {
            const isSelected = node === this.selectedNode || this.selectedNodes.includes(node);
            const isConnectStart = node === this.connectStart;
            const isHovered = node === this.hoveredNode;
            
            // Скругленные прямоугольники
            const radius = 12;
            
            this.ctx.fillStyle = this.getNodeColor(node.type);
            // Выделенные узлы имеют фиолетовую рамку
            this.ctx.strokeStyle = isConnectStart ? '#22c55e' : (isSelected ? '#a855f7' : (isHovered ? '#666' : this.getNodeBorderColor(node.type)));
            this.ctx.lineWidth = isConnectStart ? 4 : (isSelected ? 3 : (isHovered ? 2.5 : 2));
            
            // Рисуем скругленный прямоугольник
            this.ctx.beginPath();
            this.ctx.moveTo(node.x + radius, node.y);
            this.ctx.lineTo(node.x + node.width - radius, node.y);
            this.ctx.quadraticCurveTo(node.x + node.width, node.y, node.x + node.width, node.y + radius);
            this.ctx.lineTo(node.x + node.width, node.y + node.height - radius);
            this.ctx.quadraticCurveTo(node.x + node.width, node.y + node.height, node.x + node.width - radius, node.y + node.height);
            this.ctx.lineTo(node.x + radius, node.y + node.height);
            this.ctx.quadraticCurveTo(node.x, node.y + node.height, node.x, node.y + node.height - radius);
            this.ctx.lineTo(node.x, node.y + radius);
            this.ctx.quadraticCurveTo(node.x, node.y, node.x + radius, node.y);
            this.ctx.closePath();
            this.ctx.fill();
            this.ctx.stroke();
            
            // Накладываем фиолетовый фильтр на выделенные узлы
            if (isSelected) {
                this.ctx.fillStyle = 'rgba(168, 85, 247, 0.2)'; // Фиолетовый с прозрачностью
                this.ctx.fill();
            }
            
            // Высота блока названия сверху
            const nameHeight = 28;
            
            // Рисуем блок названия сверху с фоном
            const nodeName = node.name || 'Блок';
            this.ctx.fillStyle = this.getNodeBorderColor(node.type);
            this.ctx.beginPath();
            this.ctx.moveTo(node.x + radius, node.y);
            this.ctx.lineTo(node.x + node.width - radius, node.y);
            this.ctx.quadraticCurveTo(node.x + node.width, node.y, node.x + node.width, node.y + radius);
            this.ctx.lineTo(node.x + node.width, node.y + nameHeight);
            this.ctx.lineTo(node.x, node.y + nameHeight);
            this.ctx.lineTo(node.x, node.y + radius);
            this.ctx.quadraticCurveTo(node.x, node.y, node.x + radius, node.y);
            this.ctx.closePath();
            this.ctx.fill();
            
            // Рисуем линию разделения между названием и контентом
            this.ctx.strokeStyle = this.getNodeBorderColor(node.type);
            this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            this.ctx.moveTo(node.x + 4, node.y + nameHeight);
            this.ctx.lineTo(node.x + node.width - 4, node.y + nameHeight);
            this.ctx.stroke();
            
            // Рисуем название сверху
            this.ctx.fillStyle = '#ffffff';
            this.ctx.font = 'bold 13px Inter, sans-serif';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            const truncatedName = nodeName.length > 18 ? nodeName.substring(0, 18) + '...' : nodeName;
            this.ctx.fillText(truncatedName, node.x + node.width / 2, node.y + nameHeight / 2);
            
            // Рисуем иконку или миниатюру изображения (под названием)
            const iconSize = 45; // Увеличенный размер для лучшего качества
            const iconX = node.x + 8;
            const iconY = node.y + nameHeight + 6;
            const iconSpacing = iconSize + 4; // Расстояние между миниатюрами
            
            // Проверяем, есть ли изображения у сообщения
            if (node.type === 'message' && node.media && node.media.length > 0) {
                const images = node.media.filter(m => m.type === 'image');
                if (images.length > 0) {
                    // Отображаем все изображения (максимум 3 для компактности)
                    const maxThumbnails = 3;
                    const imagesToShow = images.slice(0, maxThumbnails);
                    
                    imagesToShow.forEach((image, index) => {
                        const thumbX = iconX + (index * iconSpacing);
                        this.drawImageThumbnail(image.filename, thumbX, iconY, iconSize);
                    });
                    
                    // Если изображений больше 3, показываем индикатор
                    if (images.length > maxThumbnails) {
                        const indicatorX = iconX + (maxThumbnails * iconSpacing);
                        this.ctx.fillStyle = 'rgba(74, 158, 255, 0.8)';
                        this.ctx.fillRect(indicatorX - 2, iconY - 2, iconSize + 4, iconSize + 4);
                        this.ctx.strokeStyle = this.getNodeBorderColor('message');
                        this.ctx.lineWidth = 1;
                        this.ctx.strokeRect(indicatorX - 2, iconY - 2, iconSize + 4, iconSize + 4);
                        this.ctx.fillStyle = '#ffffff';
                        this.ctx.font = 'bold 12px Arial';
                        this.ctx.textAlign = 'center';
                        this.ctx.textBaseline = 'middle';
                        this.ctx.fillText(`+${images.length - maxThumbnails}`, indicatorX + iconSize / 2, iconY + iconSize / 2);
                    }
                } else {
                    // Нет изображений - рисуем обычную иконку
                    this.ctx.fillStyle = this.getNodeBorderColor(node.type);
                    this.ctx.font = '14px Arial';
                    this.ctx.textAlign = 'left';
                    this.ctx.textBaseline = 'top';
                    this.ctx.fillText(this.getNodeIcon(node.type), iconX, iconY);
                }
            } else {
                // Для других типов узлов рисуем обычную иконку
                this.ctx.fillStyle = this.getNodeBorderColor(node.type);
                this.ctx.font = '14px Arial';
                this.ctx.textAlign = 'left';
                this.ctx.textBaseline = 'top';
                this.ctx.fillText(this.getNodeIcon(node.type), iconX, iconY);
            }
            
            // Рисуем текст
            this.ctx.fillStyle = '#ffffff';
            this.ctx.font = '14px Inter, sans-serif';
            this.ctx.textAlign = 'left';
            this.ctx.textBaseline = 'middle';
            
            // Очищаем HTML-теги для отображения на canvas
            const cleanText = this.stripHtmlTags(node.text || '');
            const text = cleanText.length > 15 ? cleanText.substring(0, 15) + '...' : cleanText;
            // Смещаем текст вправо, если есть миниатюры изображений
            const hasImages = node.type === 'message' && node.media && node.media.length > 0 && 
                             node.media.filter(m => m.type === 'image').length > 0;
            const imagesCount = hasImages ? Math.min(node.media.filter(m => m.type === 'image').length, 3) : 0;
            const textX = hasImages ? node.x + 8 + (imagesCount * 49) + 8 : node.x + 28;
            this.ctx.fillText(text, textX, node.y + nameHeight + (node.height - nameHeight) / 2);
            
            // Тип узла с цветом
            this.ctx.fillStyle = this.getNodeBorderColor(node.type);
            this.ctx.font = '11px Inter, sans-serif';
            this.ctx.textAlign = 'right';
            this.ctx.textBaseline = 'bottom';
            const typeName = node.type === 'start' ? 'Старт' : (node.type === 'message' ? 'Сообщение' : 'Кнопка');
            this.ctx.fillText(typeName, node.x + node.width - 8, node.y + node.height - 6);
            
            // Рисуем кнопку удаления при наведении или выделении (только для основного выделенного узла или при одиночном выделении)
            if ((isHovered || isSelected) && (node === this.selectedNode || this.selectedNodes.length === 1)) {
                const nameHeight = 28;
                const deleteBtnSize = 20;
                const deleteBtnX = node.x + node.width - deleteBtnSize - 4;
                const deleteBtnY = node.y + nameHeight + 4;
                
                // Скругленная кнопка удаления
                this.ctx.fillStyle = '#ef4444';
                this.ctx.beginPath();
                this.ctx.arc(deleteBtnX + deleteBtnSize/2, deleteBtnY + deleteBtnSize/2, deleteBtnSize/2, 0, 2 * Math.PI);
                this.ctx.fill();
                
                // Крестик
                this.ctx.strokeStyle = '#ffffff';
                this.ctx.lineWidth = 2;
                this.ctx.beginPath();
                this.ctx.moveTo(deleteBtnX + 6, deleteBtnY + 6);
                this.ctx.lineTo(deleteBtnX + 14, deleteBtnY + 14);
                this.ctx.moveTo(deleteBtnX + 14, deleteBtnY + 6);
                this.ctx.lineTo(deleteBtnX + 6, deleteBtnY + 14);
                this.ctx.stroke();
                
                // Ручка для изменения размера (правый нижний угол)
                const resizeHandleX = node.x + node.width - this.resizeHandleSize - 2;
                const resizeHandleY = node.y + node.height - this.resizeHandleSize - 2;
                
                this.ctx.fillStyle = '#4a9eff';
                this.ctx.strokeStyle = '#ffffff';
                this.ctx.lineWidth = 2;
                this.ctx.beginPath();
                this.ctx.moveTo(resizeHandleX, resizeHandleY);
                this.ctx.lineTo(node.x + node.width - 2, resizeHandleY);
                this.ctx.lineTo(node.x + node.width - 2, node.y + node.height - 2);
                this.ctx.lineTo(resizeHandleX, node.y + node.height - 2);
                this.ctx.closePath();
                this.ctx.fill();
                this.ctx.stroke();
                
                // Рисуем индикатор изменения размера (диагональные линии)
                this.ctx.strokeStyle = '#ffffff';
                this.ctx.lineWidth = 1.5;
                this.ctx.beginPath();
                this.ctx.moveTo(resizeHandleX + 2, node.y + node.height - 6);
                this.ctx.lineTo(node.x + node.width - 6, resizeHandleY + 2);
                this.ctx.moveTo(resizeHandleX + 5, node.y + node.height - 3);
                this.ctx.lineTo(node.x + node.width - 3, resizeHandleY + 5);
                this.ctx.stroke();
            }
        });
    }

    drawConnections() {
        this.connections.forEach(conn => {
            // Всегда обновляем позиции связей на основе текущих позиций узлов
            let fromX, fromY, toX, toY;
            
            // Проверяем, что у нас есть правильные ссылки на узлы
            let sourceNode, targetNode;
            
            if (typeof conn.source === 'object' && conn.source !== null) {
                sourceNode = conn.source;
            } else {
                sourceNode = this.nodes.find(n => n.id === conn.source);
            }
            
            if (typeof conn.target === 'object' && conn.target !== null) {
                targetNode = conn.target;
            } else {
                targetNode = this.nodes.find(n => n.id === conn.target);
            }
            
            if (!sourceNode || !targetNode) {
                console.log('Node not found for connection:', conn, 'Source:', conn.source, 'Target:', conn.target);
                console.log('Available nodes:', this.nodes.map(n => ({ id: n.id, type: n.type })));
                return;
            }
            
            if (conn.sourcePoint) {
                fromX = conn.sourcePoint.x;
                fromY = conn.sourcePoint.y;
            } else {
                fromX = sourceNode.x + sourceNode.width / 2;
                fromY = sourceNode.y + sourceNode.height / 2;
            }
            
            if (conn.targetPoint) {
                toX = conn.targetPoint.x;
                toY = conn.targetPoint.y;
            } else {
                toX = targetNode.x + targetNode.width / 2;
                toY = targetNode.y + targetNode.height / 2;
            }
            
            this.drawArrow(fromX, fromY, toX, toY, '#4a9eff', conn.buttonText, conn);
        });
    }

    drawConnectionPreview() {
        if (this.connectionPreview) {
            let fromX, fromY;
            
            if (this.connectionPreview.sourcePoint) {
                fromX = this.connectionPreview.sourcePoint.x;
                fromY = this.connectionPreview.sourcePoint.y;
            } else {
                fromX = this.connectionPreview.source.x + this.connectionPreview.source.width / 2;
                fromY = this.connectionPreview.source.y + this.connectionPreview.source.height / 2;
            }
            
            let toX, toY;
            
            if (this.connectionPreview.targetPoint) {
                toX = this.connectionPreview.targetPoint.x;
                toY = this.connectionPreview.targetPoint.y;
            } else if (this.connectionPreview.targetNode) {
                toX = this.connectionPreview.targetNode.x + this.connectionPreview.targetNode.width / 2;
                toY = this.connectionPreview.targetNode.y + this.connectionPreview.targetNode.height / 2;
            } else {
                toX = this.connectionPreview.target.x;
                toY = this.connectionPreview.target.y;
            }
            
            this.drawArrow(fromX, fromY, toX, toY, 'rgba(74, 158, 255, 0.5)', 'Новая связь', null);
        }
    }

    drawArrow(fromX, fromY, toX, toY, color, text, connection) {
        const headLength = 15;
        const angle = Math.atan2(toY - fromY, toX - fromX);
        
        const toNodeX = toX;
        const toNodeY = toY;
        const fromNodeX = fromX;
        const fromNodeY = fromY;
        
        this.ctx.strokeStyle = color;
        this.ctx.fillStyle = color;
        this.ctx.lineWidth = 2;
        
        // Создаем более сложную кривую, которая огибает блоки
        const distance = Math.sqrt((toNodeX - fromNodeX) ** 2 + (toNodeY - fromNodeY) ** 2);
        const offset = Math.min(distance * 0.3, 50); // Максимальное смещение 50px
        
        // Вычисляем перпендикулярное направление для создания кривой
        const perpX = -(toNodeY - fromNodeY) / distance;
        const perpY = (toNodeX - fromNodeX) / distance;
        
        // Создаем контрольные точки для более сложной кривой
        const control1X = fromNodeX + (toNodeX - fromNodeX) * 0.3 + perpX * offset;
        const control1Y = fromNodeY + (toNodeY - fromNodeY) * 0.3 + perpY * offset;
        
        const control2X = fromNodeX + (toNodeX - fromNodeX) * 0.7 - perpX * offset;
        const control2Y = fromNodeY + (toNodeY - fromNodeY) * 0.7 - perpY * offset;
        
        this.ctx.beginPath();
        this.ctx.moveTo(fromNodeX, fromNodeY);
        
        // Используем кубическую кривую Безье для более плавного изгиба
        this.ctx.bezierCurveTo(
            control1X, control1Y,
            control2X, control2Y,
            toNodeX - headLength * Math.cos(angle), 
            toNodeY - headLength * Math.sin(angle)
        );
        this.ctx.stroke();
        
        // Рисуем стрелку
        this.ctx.beginPath();
        this.ctx.moveTo(toNodeX, toNodeY);
        this.ctx.lineTo(toNodeX - headLength * Math.cos(angle - Math.PI / 6), toNodeY - headLength * Math.sin(angle - Math.PI / 6));
        this.ctx.lineTo(toNodeX - headLength * Math.cos(angle + Math.PI / 6), toNodeY - headLength * Math.sin(angle + Math.PI / 6));
        this.ctx.closePath();
        this.ctx.fill();
        
        // Рисуем кнопку удаления только для наведенной связи
        if (this.hoveredConnection === connection) {
            const deleteBtnSize = 16;
            const controlX = (fromNodeX + toNodeX) / 2;
            const controlY = (fromNodeY + toNodeY) / 2;
            const deleteBtnX = controlX - deleteBtnSize / 2;
            const deleteBtnY = controlY - deleteBtnSize / 2 - 15;
            
            this.ctx.fillStyle = '#ef4444';
            this.ctx.beginPath();
            this.ctx.arc(deleteBtnX + deleteBtnSize/2, deleteBtnY + deleteBtnSize/2, deleteBtnSize/2, 0, 2 * Math.PI);
            this.ctx.fill();
            
            this.ctx.strokeStyle = '#ffffff';
            this.ctx.lineWidth = 1.5;
            this.ctx.beginPath();
            const centerX = deleteBtnX + deleteBtnSize/2;
            const centerY = deleteBtnY + deleteBtnSize/2;
            this.ctx.moveTo(centerX - 4, centerY - 4);
            this.ctx.lineTo(centerX + 4, centerY + 4);
            this.ctx.moveTo(centerX + 4, centerY - 4);
            this.ctx.lineTo(centerX - 4, centerY + 4);
            this.ctx.stroke();
        }
    }

    calculateConnectionPoints(node) {
        this.connectionPoints = [];
        
        if (node.type === 'start') {
            // У стартового узла только выход снизу
            this.connectionPoints.push({
                x: node.x + node.width / 2,
                y: node.y + node.height,
                type: 'output'
            });
        } else {
            // У остальных узлов вход сверху и выход снизу
            this.connectionPoints.push({
                x: node.x + node.width / 2,
                y: node.y,
                type: 'input'
            });
            
            this.connectionPoints.push({
                x: node.x + node.width / 2,
                y: node.y + node.height,
                type: 'output'
            });
        }
    }

    getConnectionPointAt(x, y) {
        for (let node of this.nodes) {
            this.calculateConnectionPoints(node);
            for (let point of this.connectionPoints) {
                const dist = Math.sqrt(Math.pow(x - point.x, 2) + Math.pow(y - point.y, 2));
                if (dist <= 10) {
                    return { node, point };
                }
            }
        }
        return null;
    }

    drawConnectionPoints() {
        const shouldShowPoints = this.connectionMode || this.hoveredNode;
        
        if (!shouldShowPoints) return;
        
        this.nodes.forEach(node => {
            const isHovered = this.hoveredNode === node;
            const shouldDrawForNode = this.connectionMode || isHovered;
            
            if (!shouldDrawForNode) return;
            
            this.calculateConnectionPoints(node);
            
            this.connectionPoints.forEach((point, index) => {
                const isConnectStart = node === this.connectStart;
                const isStartPoint = this.connectStart && this.connectStart === node && 
                    ((this.connectStartPoint && this.connectStartPoint.type === point.type) || 
                     (!this.connectStartPoint && index < 2));
                
                let fillColor = '#4a9eff';
                if (isConnectStart && isStartPoint) {
                    fillColor = '#22c55e';
                } else if (isHovered) {
                    fillColor = '#2d7dd2';
                }
                
                this.ctx.fillStyle = fillColor;
                this.ctx.beginPath();
                this.ctx.arc(point.x, point.y, 6, 0, 2 * Math.PI);
                this.ctx.fill();
                
                this.ctx.strokeStyle = '#ffffff';
                this.ctx.lineWidth = 2;
                this.ctx.beginPath();
                this.ctx.arc(point.x, point.y, 6, 0, 2 * Math.PI);
                this.ctx.stroke();
            });
            
            if (isHovered || (this.connectStart && this.connectStart === node)) {
                this.drawConnectionHighlights(node);
            }
        });
    }

    drawConnectionHighlights(node) {
        this.calculateConnectionPoints(node);
        
        this.connectionPoints.forEach(point => {
            if (point.type === 'output') {
                this.ctx.strokeStyle = 'rgba(34, 197, 94, 0.3)';
                this.ctx.fillStyle = 'rgba(34, 197, 94, 0.1)';
            } else {
                this.ctx.strokeStyle = 'rgba(74, 158, 255, 0.3)';
                this.ctx.fillStyle = 'rgba(74, 158, 255, 0.1)';
            }
            
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.arc(point.x, point.y, 15, 0, 2 * Math.PI);
            this.ctx.fill();
            this.ctx.stroke();
        });
    }

    drawSelectionBox() {
        if (this.selectionBox && this.isSelecting) {
            // Рисуем полупрозрачную фиолетовую рамку выбора
            this.ctx.fillStyle = 'rgba(168, 85, 247, 0.1)';
            this.ctx.fillRect(
                this.selectionBox.x,
                this.selectionBox.y,
                this.selectionBox.width,
                this.selectionBox.height
            );
            
            // Рисуем фиолетовую границу рамки
            this.ctx.strokeStyle = '#a855f7';
            this.ctx.lineWidth = 2;
            this.ctx.setLineDash([5, 5]);
            this.ctx.strokeRect(
                this.selectionBox.x,
                this.selectionBox.y,
                this.selectionBox.width,
                this.selectionBox.height
            );
            this.ctx.setLineDash([]);
        }
    }

    getNodeColor(type) {
        switch (type) {
            case 'start': return '#1a2e1a';
            case 'message': return '#1a2433';
            case 'button': return '#2d2416';
            default: return '#2d2d2d';
        }
    }

    getNodeBorderColor(type) {
        switch (type) {
            case 'start': return '#4ade80';
            case 'message': return '#4a9eff';
            case 'button': return '#f59e0b';
            default: return '#666';
        }
    }

    getNodeIcon(type) {
        switch (type) {
            case 'start':
                return '▶';
            case 'message':
                return '💬';
            case 'button':
                return '🔘';
            default:
                return '⚪';
        }
    }
    
    drawImageThumbnail(filename, x, y, size) {
        const imageUrl = `/uploads/${filename}`;
        
        // Включаем сглаживание для лучшего качества
        this.ctx.imageSmoothingEnabled = true;
        this.ctx.imageSmoothingQuality = 'high';
        
        // Проверяем кэш
        if (this.imageCache.has(imageUrl)) {
            const img = this.imageCache.get(imageUrl);
            if (img.complete && img.naturalWidth > 0) {
                // Рисуем рамку
                this.ctx.fillStyle = '#2d2d2d';
                this.ctx.fillRect(x - 2, y - 2, size + 4, size + 4);
                this.ctx.strokeStyle = this.getNodeBorderColor('message');
                this.ctx.lineWidth = 1.5;
                this.ctx.strokeRect(x - 2, y - 2, size + 4, size + 4);
                
                // Рисуем изображение с высоким качеством
                this.ctx.drawImage(img, x, y, size, size);
                return;
            }
        }
        
        // Если изображение уже загружается, рисуем заглушку и выходим
        if (this.loadingImages.has(imageUrl)) {
            this.ctx.fillStyle = '#2d2d2d';
            this.ctx.fillRect(x - 2, y - 2, size + 4, size + 4);
            this.ctx.strokeStyle = this.getNodeBorderColor('message');
            this.ctx.lineWidth = 1;
            this.ctx.strokeRect(x - 2, y - 2, size + 4, size + 4);
            this.ctx.fillStyle = '#666';
            this.ctx.font = '10px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText('...', x + size / 2, y + size / 2);
            return;
        }
        
        // Загружаем изображение (только если его еще нет в кэше)
        this.loadingImages.add(imageUrl);
        const img = new Image();
        img.onload = () => {
            // Сохраняем в кэш
            this.imageCache.set(imageUrl, img);
            this.loadingImages.delete(imageUrl);
            // Перерисовываем
            this.render();
        };
        img.onerror = () => {
            // Если изображение не загрузилось
            this.loadingImages.delete(imageUrl);
            // Перерисовываем для показа обычной иконки
            this.render();
        };
        img.src = imageUrl;
        
        // Пока изображение загружается, рисуем заглушку
        this.ctx.fillStyle = '#2d2d2d';
        this.ctx.fillRect(x - 2, y - 2, size + 4, size + 4);
        this.ctx.strokeStyle = this.getNodeBorderColor('message');
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(x - 2, y - 2, size + 4, size + 4);
        this.ctx.fillStyle = '#666';
        this.ctx.font = '10px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
            this.ctx.fillText('...', x + size / 2, y + size / 2);
    }
    
    stripHtmlTags(html) {
        // Создаем временный элемент для парсинга HTML
        const temp = document.createElement('div');
        temp.innerHTML = html;
        return temp.textContent || temp.innerText || '';
    }
    
    showNotification(message, type = 'info', duration = 3000) {
        // Удаляем предыдущие уведомления
        const existingNotifications = document.querySelectorAll('.notification');
        existingNotifications.forEach(notification => notification.remove());
        
        // Создаем новое уведомление
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        
        // Иконки для разных типов уведомлений
        const icons = {
            success: `<svg class="notification-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20 6L9 17l-5-5"></path>
            </svg>`,
            error: `<svg class="notification-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="15" y1="9" x2="9" y2="15"></line>
                <line x1="9" y1="9" x2="15" y2="15"></line>
            </svg>`,
            warning: `<svg class="notification-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                <line x1="12" y1="9" x2="12" y2="13"></line>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>`,
            info: `<svg class="notification-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="16" x2="12" y2="12"></line>
                <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>`
        };
        
        notification.innerHTML = `${icons[type] || icons.info}${message}`;
        document.body.appendChild(notification);
        
        // Показываем уведомление
        setTimeout(() => {
            notification.classList.add('show');
        }, 100);
        
        // Скрываем уведомление через указанное время
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, duration);
    }

    animate() {
        requestAnimationFrame(() => this.animate());
    }
}

function formatText(command) {
    document.execCommand(command, false, null);
}

function createLink() {
    const url = prompt('Введите URL ссылки:');
    if (url) {
        // Проверяем, что URL начинается с http:// или https://
        const fullUrl = url.startsWith('http://') || url.startsWith('https://') ? url : 'https://' + url;
        console.log('Creating link with URL:', fullUrl);
        
        // Выделяем текст, если ничего не выделено
        const selection = window.getSelection();
        if (selection.toString().trim() === '') {
            alert('Сначала выделите текст, который должен стать ссылкой');
            return;
        }
        
        document.execCommand('createLink', false, fullUrl);
        console.log('Link created, HTML after:', document.getElementById('node-text').innerHTML);
    }
}

function cleanHtmlForTelegram(html) {
    // Создаем временный элемент для парсинга HTML
    const temp = document.createElement('div');
    temp.innerHTML = html;
    
    // Функция для рекурсивной очистки узлов
    function cleanNode(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent;
        }
        
        if (node.nodeType === Node.ELEMENT_NODE) {
            const tagName = node.tagName.toLowerCase();
            
            // Поддерживаемые Telegram теги
            const supportedTags = ['b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del', 'code', 'pre', 'a'];
            
            if (supportedTags.includes(tagName)) {
                let result = '';
                
                // Обрабатываем ссылки
                if (tagName === 'a') {
                    const href = node.getAttribute('href');
                    console.log('Processing link tag with href:', href);
                    if (href) {
                        result += `<a href="${href}">`;
                        for (let child of node.childNodes) {
                            result += cleanNode(child);
                        }
                        result += '</a>';
                        console.log('Link result:', result);
                    } else {
                        // Если нет href, просто текст
                        for (let child of node.childNodes) {
                            result += cleanNode(child);
                        }
                    }
                } else {
                    // Обычные поддерживаемые теги
                    result += `<${tagName}>`;
                    for (let child of node.childNodes) {
                        result += cleanNode(child);
                    }
                    result += `</${tagName}>`;
                }
                
                return result;
            } else if (tagName === 'br') {
                return '\n';
            } else if (tagName === 'div' || tagName === 'p') {
                // div и p заменяем на переносы строк
                let result = '';
                for (let child of node.childNodes) {
                    result += cleanNode(child);
                }
                return result + '\n';
            } else {
                // Неподдерживаемые теги - извлекаем только текст
                let result = '';
                for (let child of node.childNodes) {
                    result += cleanNode(child);
                }
                return result;
            }
        }
        
        return '';
    }
    
    let cleaned = '';
    for (let child of temp.childNodes) {
        cleaned += cleanNode(child);
    }
    
    // Очищаем множественные переносы строк
    cleaned = cleaned
        .replace(/\n+/g, '\n')            // множественные переносы -> один
        .replace(/^\n+|\n+$/g, '')        // убираем переносы в начале и конце
        .trim();
    
    return cleaned;
}


function deleteImage(filename) {
    fetch(`/api/uploads/${filename}`, { method: 'DELETE' })
    .then(() => {
        editor.loadNodeImages();
    });
}

function deleteSelectedNode() {
    if (window.editor) {
        window.editor.deleteSelectedNode();
    }
}

function copySelectedNode() {
    if (window.editor) {
        window.editor.copySelectedNode();
    }
}

function copySelectedNodes() {
    if (window.editor) {
        window.editor.copySelectedNodes();
    }
}

function deleteSelectedNodes() {
    if (window.editor) {
        window.editor.deleteSelectedNodes();
    }
}

let editor;
window.editor = null; // Глобальная ссылка для доступа из inline обработчиков
document.addEventListener('DOMContentLoaded', () => {
    editor = new FlowEditor();
    window.editor = editor; // Сохраняем ссылку в window для доступа из inline обработчиков
});