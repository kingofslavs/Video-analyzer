let mediaInfoInstance = null;
let currentFileData = null;

// Инициализация MediaInfo
async function initMediaInfo() {
    try {
        mediaInfoInstance = await MediaInfo.default({
            locateFile: (path, prefix) => {
                return 'https://unpkg.com/mediainfo.js/dist/' + path;
            }
        });
        console.log('MediaInfo инициализирован');
    } catch (error) {
        console.error('Ошибка инициализации MediaInfo:', error);
        alert('Ошибка загрузки библиотеки анализа. Проверьте подключение к интернету.');
    }
}

// Инициализация при загрузке страницы
window.addEventListener('load', () => {
    initMediaInfo();
    initEventListeners();
});

// Инициализация обработчиков событий
function initEventListeners() {
    // Обработка загрузки файлов
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');

    // Drag & Drop функциональность
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('drag-over');
    });

    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('drag-over');
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('drag-over');
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFile(files[0]);
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFile(e.target.files[0]);
        }
    });
}

// Обработка файла
async function handleFile(file) {
    if (!mediaInfoInstance) {
        alert('MediaInfo еще не загружен. Попробуйте еще раз через несколько секунд.');
        return;
    }

    // Проверяем размер файла
    const maxSize = 24 * 1024 * 1024 * 1024; // 24GB лимит
    if (file.size > maxSize) {
        alert('Файл слишком большой. Максимальный размер: 24GB');
        return;
    }

    currentFileData = file;
    showLoading();
    updateProgress(0, 'Подготовка к анализу...');

    try {
        // Проверяем доступную память (если поддерживается)
        if ('memory' in performance) {
            const memInfo = performance.memory;
            const availableMemory = memInfo.jsHeapSizeLimit - memInfo.usedJSHeapSize;
            if (file.size > availableMemory * 0.5) {
                console.warn('Предупреждение: файл может быть слишком большим для доступной памяти');
            }
        }

        // Для больших файлов (>100MB) используем потоковое чтение
        const isLargeFile = file.size > 100 * 1024 * 1024;
        let result;

        if (isLargeFile) {
            result = await analyzeFileInChunks(file);
        } else {
            // Для небольших файлов загружаем целиком
            updateProgress(50, 'Загрузка файла...');
            const arrayBuffer = await file.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);

            updateProgress(80, 'Анализ файла...');
            result = await mediaInfoInstance.analyzeData(
                () => uint8Array.length,
                (size, offset) => uint8Array.slice(offset, offset + size)
            );
        }

        console.log('MediaInfo result:', result);
        updateProgress(100, 'Анализ завершен!');

        // Отображаем результаты
        setTimeout(() => displayResults(file, result), 500);
    } catch (error) {
        console.error('Ошибка анализа файла:', error);
        if (error.name === 'QuotaExceededError' || error.message.includes('memory')) {
            alert('Недостаточно памяти для анализа такого большого файла. Попробуйте файл поменьше.');
        } else if (error.name === 'NotAllowedError') {
            alert('Доступ к файлу запрещен. Проверьте права доступа.');
        } else {
            alert('Ошибка при анализе файла: ' + error.message);
        }
        hideLoading();
    }
}

// Анализ больших файлов по частям
async function analyzeFileInChunks(file) {
    // Динамический размер чанка в зависимости от размера файла
    let chunkSize;
    if (file.size > 1024 * 1024 * 1024) { // >1GB
        chunkSize = 1024 * 1024; // 1MB chunks для очень больших файлов
    } else if (file.size > 500 * 1024 * 1024) { // >500MB
        chunkSize = 512 * 1024; // 512KB chunks
    } else {
        chunkSize = 64 * 1024; // 64KB chunks для файлов <500MB
    }
    
    const fileSize = file.size;
    let offset = 0;
    
    updateProgress(10, 'Анализ большого файла...');

    // Создаем функции для MediaInfo
    const getSize = () => fileSize;
    const readChunk = async (size, fileOffset) => {
        // Обновляем прогресс
        const progress = Math.min(10 + (fileOffset / fileSize) * 70, 80);
        updateProgress(progress, `Обработка: ${formatFileSize(fileOffset)} из ${formatFileSize(fileSize)}`);

        const start = fileOffset;
        const end = Math.min(start + size, fileSize);
        const chunk = file.slice(start, end);
        const arrayBuffer = await chunk.arrayBuffer();
        return new Uint8Array(arrayBuffer);
    };

    // Анализируем файл
    const result = await mediaInfoInstance.analyzeData(getSize, readChunk);
    return result;
}

// Отображение результатов
function displayResults(file, mediaInfo) {
    hideLoading();
    
    // Скрываем секцию загрузки
    document.getElementById('uploadSection').style.display = 'none';
    
    // Базовая информация о файле
    document.getElementById('fileName').textContent = file.name;
    document.getElementById('fileSize').textContent = formatFileSize(file.size);
    document.getElementById('fileType').textContent = file.type || 'Неизвестно';

    // Парсим MediaInfo результат
    const tracks = parseMediaInfo(mediaInfo);
    
    // Заполняем вкладки
    fillSummaryInfo(tracks);
    fillGeneralInfo(tracks.general);
    fillVideoInfo(tracks.video);
    fillAudioInfo(tracks.audio);
    fillRawInfo(mediaInfo);

    // Показываем результаты
    document.getElementById('resultsSection').style.display = 'block';
}

// Парсинг результатов MediaInfo
function parseMediaInfo(mediaInfo) {
    const tracks = {
        general: [],
        video: [],
        audio: []
    };

    // MediaInfo возвращает объект с массивом треков
    if (mediaInfo && mediaInfo.media && mediaInfo.media.track) {
        mediaInfo.media.track.forEach(track => {
            const trackType = track['@type'];
            if (trackType === 'General') {
                tracks.general.push(track);
            } else if (trackType === 'Video') {
                tracks.video.push(track);
            } else if (trackType === 'Audio') {
                tracks.audio.push(track);
            }
        });
    }

    return tracks;
}

// Заполнение краткой информации
function fillSummaryInfo(tracks) {
    const container = document.getElementById('summaryInfo');
    container.innerHTML = '';

    // Видео информация
    if (tracks.video.length > 0) {
        tracks.video.forEach((track, index) => {
            const videoSection = document.createElement('div');
            videoSection.className = 'summary-section';
            
            const title = document.createElement('h4');
            title.innerHTML = `🎥 Видео${tracks.video.length > 1 ? ` ${index + 1}` : ''}`;
            videoSection.appendChild(title);
            
            const summaryText = document.createElement('div');
            summaryText.className = 'summary-text';
            
            const videoSummary = [];
            
            // Кодек
            if (track.Format) {
                let codec = track.Format;
                if (track.Format_Profile) {
                    codec += ` (${track.Format_Profile})`;
                }
                videoSummary.push(`Кодек: ${codec}`);
            }
            
            // Разрешение
            if (track.Width && track.Height) {
                let resolution = `${track.Width}×${track.Height}`;
                if (track.DisplayAspectRatio) {
                    resolution += ` (${formatAspectRatio(track.DisplayAspectRatio)})`;
                }
                videoSummary.push(`Разрешение: ${resolution}`);
            }
            
            // Частота кадров
            if (track.FrameRate) {
                videoSummary.push(`Частота кадров: ${formatValue('FrameRate', track.FrameRate)}`);
            }
            
            // Битрейт
            if (track.BitRate) {
                videoSummary.push(`Битрейт: ${formatValue('BitRate', track.BitRate)}`);
            }
            
            summaryText.textContent = videoSummary.length > 0 ? videoSummary.join(', ') : 'Данные недоступны';
            if (videoSummary.length === 0) {
                summaryText.className += ' no-data';
            }
            
            videoSection.appendChild(summaryText);
            container.appendChild(videoSection);
        });
    }

    // Аудио информация
    if (tracks.audio.length > 0) {
        tracks.audio.forEach((track, index) => {
            const audioSection = document.createElement('div');
            audioSection.className = 'summary-section';
            
            const title = document.createElement('h4');
            title.innerHTML = `🔊 Аудио${tracks.audio.length > 1 ? ` ${index + 1}` : ''}`;
            audioSection.appendChild(title);
            
            const summaryText = document.createElement('div');
            summaryText.className = 'summary-text';
            
            const audioSummary = [];
            
            // Кодек
            if (track.Format) {
                let codec = track.Format;
                if (track.Format_Profile) {
                    codec += ` (${track.Format_Profile})`;
                }
                audioSummary.push(`Кодек: ${codec}`);
            }
            
            // Частота дискретизации
            if (track.SamplingRate) {
                audioSummary.push(`Частота: ${formatValue('SamplingRate', track.SamplingRate)}`);
            }
            
            // Конфигурация каналов
            if (track.Channel_s_) {
                let channels = `${track.Channel_s_} каналов`;
                if (track.ChannelLayout) {
                    channels += ` (${track.ChannelLayout})`;
                }
                audioSummary.push(`Каналы: ${channels}`);
            } else if (track.ChannelLayout) {
                audioSummary.push(`Каналы: ${track.ChannelLayout}`);
            }
            
            // Битрейт
            if (track.BitRate) {
                audioSummary.push(`Битрейт: ${formatValue('BitRate', track.BitRate)}`);
            }
            
            summaryText.textContent = audioSummary.length > 0 ? audioSummary.join(', ') : 'Данные недоступны';
            if (audioSummary.length === 0) {
                summaryText.className += ' no-data';
            }
            
            audioSection.appendChild(summaryText);
            container.appendChild(audioSection);
        });
    }

    // Если нет ни видео, ни аудио
    if (tracks.video.length === 0 && tracks.audio.length === 0) {
        const noDataSection = document.createElement('div');
        noDataSection.className = 'summary-section';
        
        const noDataText = document.createElement('div');
        noDataText.className = 'summary-text no-data';
        noDataText.textContent = 'Видео и аудио дорожки не найдены';
        
        noDataSection.appendChild(noDataText);
        container.appendChild(noDataSection);
    }
}

// Заполнение общей информации
function fillGeneralInfo(generalTracks) {
    const container = document.getElementById('generalInfo');
    container.innerHTML = '';

    if (generalTracks.length === 0) {
        container.innerHTML = '<p>Общая информация недоступна</p>';
        return;
    }

    const track = generalTracks[0];
    const importantFields = [
        { key: 'CompleteName', label: 'Полное имя' },
        { key: 'Format', label: 'Формат' },
        { key: 'Format_Version', label: 'Версия формата' },
        { key: 'FileSize', label: 'Размер файла' },
        { key: 'Duration', label: 'Длительность' },
        { key: 'OverallBitRate', label: 'Общий битрейт' },
        { key: 'Encoded_Date', label: 'Дата кодирования' },
        { key: 'Tagged_Date', label: 'Дата тегирования' }
    ];

    const grid = document.createElement('div');
    grid.className = 'info-grid';

    for (const field of importantFields) {
        const value = track[field.key];
        if (value) {
            const item = createInfoItem(field.label, formatValue(field.key, value));
            grid.appendChild(item);
        }
    }

    container.appendChild(grid);
}

// Заполнение информации о видео
function fillVideoInfo(videoTracks) {
    const container = document.getElementById('videoInfo');
    container.innerHTML = '';

    if (videoTracks.length === 0) {
        container.innerHTML = '<p>Видеодорожки не найдены</p>';
        return;
    }

    videoTracks.forEach((track, index) => {
        const trackDiv = document.createElement('div');
        trackDiv.className = 'track-info';
        
        if (videoTracks.length > 1) {
            const title = document.createElement('h4');
            title.textContent = `Видеодорожка ${index + 1}`;
            trackDiv.appendChild(title);
        }

        const importantFields = [
            { key: 'Format', label: 'Формат' },
            { key: 'Format_Profile', label: 'Профиль формата' },
            { key: 'Width', label: 'Ширина' },
            { key: 'Height', label: 'Высота' },
            { key: 'DisplayAspectRatio', label: 'Соотношение сторон' },
            { key: 'FrameRate', label: 'Частота кадров' },
            { key: 'BitRate', label: 'Битрейт' },
            { key: 'ColorSpace', label: 'Цветовое пространство' },
            { key: 'BitDepth', label: 'Битность' },
            { key: 'Duration', label: 'Длительность' }
        ];

        const grid = document.createElement('div');
        grid.className = 'info-grid';

        for (const field of importantFields) {
            const value = track[field.key];
            if (value) {
                const item = createInfoItem(field.label, formatValue(field.key, value));
                grid.appendChild(item);
            }
        }

        trackDiv.appendChild(grid);
        container.appendChild(trackDiv);
    });
}

// Заполнение информации об аудио
function fillAudioInfo(audioTracks) {
    const container = document.getElementById('audioInfo');
    container.innerHTML = '';

    if (audioTracks.length === 0) {
        container.innerHTML = '<p>Аудиодорожки не найдены</p>';
        return;
    }

    audioTracks.forEach((track, index) => {
        const trackDiv = document.createElement('div');
        trackDiv.className = 'track-info';
        
        if (audioTracks.length > 1) {
            const title = document.createElement('h4');
            title.textContent = `Аудиодорожка ${index + 1}`;
            trackDiv.appendChild(title);
        }

        const importantFields = [
            { key: 'Format', label: 'Формат' },
            { key: 'Format_Profile', label: 'Профиль формата' },
            { key: 'Duration', label: 'Длительность' },
            { key: 'BitRate', label: 'Битрейт' },
            { key: 'Channel_s_', label: 'Каналы' },
            { key: 'ChannelLayout', label: 'Расположение каналов' },
            { key: 'SamplingRate', label: 'Частота дискретизации' },
            { key: 'BitDepth', label: 'Битность' },
            { key: 'Language', label: 'Язык' }
        ];

        const grid = document.createElement('div');
        grid.className = 'info-grid';

        for (const field of importantFields) {
            const value = track[field.key];
            if (value) {
                const item = createInfoItem(field.label, formatValue(field.key, value));
                grid.appendChild(item);
            }
        }

        trackDiv.appendChild(grid);
        container.appendChild(trackDiv);
    });
}

// Заполнение сырых данных
function fillRawInfo(mediaInfo) {
    const rawInfoElement = document.getElementById('rawInfo');
    rawInfoElement.textContent = JSON.stringify(mediaInfo, null, 2);
}

// Форматирование значений
function formatValue(key, value) {
    if (!value) return '';
    
    // Форматирование времени
    if (key === 'Duration') {
        return formatDuration(value);
    }
    
    // Форматирование размера файла
    if (key === 'FileSize' && !isNaN(value)) {
        return formatFileSize(parseInt(value));
    }
    
    // Форматирование битрейта
    if ((key === 'BitRate' || key === 'OverallBitRate') && !isNaN(value)) {
        return Math.round(parseInt(value) / 1000) + ' kbps';
    }
    
    // Форматирование частоты дискретизации
    if (key === 'SamplingRate' && !isNaN(value)) {
        return Math.round(parseInt(value) / 1000) + ' kHz';
    }
    
    // Форматирование частоты кадров
    if (key === 'FrameRate' && !isNaN(value)) {
        return parseFloat(value).toFixed(3) + ' fps';
    }
    
    // Форматирование разрешения
    if ((key === 'Width' || key === 'Height') && !isNaN(value)) {
        return value + ' px';
    }
    
    // Форматирование соотношения сторон
    if (key === 'DisplayAspectRatio') {
        return formatAspectRatio(value);
    }
    
    return value.toString();
}

// Специальная функция для форматирования длительности
function formatDuration(duration) {
    if (!duration) return '';
    
    // Если это уже отформатированная строка (например, "1h 23min 45s")
    if (typeof duration === 'string' && duration.includes('h')) {
        return duration;
    }
    
    // Если это строка времени в формате "HH:MM:SS"
    if (typeof duration === 'string' && duration.includes(':')) {
        return duration;
    }
    
    // Если это числовое значение в миллисекундах
    let totalSeconds;
    if (typeof duration === 'string') {
        // Пытаемся парсить как число
        const parsed = parseFloat(duration);
        if (isNaN(parsed)) return duration; // Возвращаем как есть, если не можем распарсить
        totalSeconds = parsed;
    } else {
        totalSeconds = parseFloat(duration);
    }
    
    // MediaInfo обычно возвращает длительность в миллисекундах
    if (totalSeconds > 3600000) { // Если больше часа в миллисекундах
        totalSeconds = totalSeconds / 1000; // Конвертируем в секунды
    }
    
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    } else {
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
}

// Специальная функция для форматирования соотношения сторон
function formatAspectRatio(ratio) {
    if (!ratio) return '';
    
    // Если это уже в формате 16:9, возвращаем как есть
    if (typeof ratio === 'string' && ratio.includes(':')) {
        return ratio;
    }
    
    // Если это десятичное число (например, 1.778)
    const numericRatio = parseFloat(ratio);
    if (isNaN(numericRatio)) return ratio;
    
    // Определяем наиболее близкое стандартное соотношение
    const commonRatios = [
        { ratio: 16/9, display: '16:9' },
        { ratio: 4/3, display: '4:3' },
        { ratio: 21/9, display: '21:9' },
        { ratio: 1.85, display: '1.85:1' },
        { ratio: 2.35, display: '2.35:1' },
        { ratio: 2.39, display: '2.39:1' },
        { ratio: 1/1, display: '1:1' },
        { ratio: 3/2, display: '3:2' },
        { ratio: 5/4, display: '5:4' },
        { ratio: 16/10, display: '16:10' }
    ];
    
    // Находим ближайшее соотношение
    let closest = commonRatios[0];
    let minDifference = Math.abs(numericRatio - closest.ratio);
    
    for (const commonRatio of commonRatios) {
        const difference = Math.abs(numericRatio - commonRatio.ratio);
        if (difference < minDifference) {
            minDifference = difference;
            closest = commonRatio;
        }
    }
    
    // Если разница очень маленькая (менее 0.01), используем стандартное обозначение
    if (minDifference < 0.01) {
        return closest.display;
    }
    
    // Иначе пытаемся найти простую дробь
    const simplifiedRatio = simplifyRatio(numericRatio);
    if (simplifiedRatio) {
        return simplifiedRatio;
    }
    
    // В крайнем случае, показываем с точностью до 2 знаков
    return numericRatio.toFixed(2) + ':1';
}

// Функция для упрощения соотношения до простых чисел
function simplifyRatio(decimal) {
    // Пробуем найти простое соотношение
    for (let denominator = 1; denominator <= 20; denominator++) {
        const numerator = Math.round(decimal * denominator);
        const calculatedRatio = numerator / denominator;
        
        if (Math.abs(calculatedRatio - decimal) < 0.005) {
            const gcd = findGCD(numerator, denominator);
            const simplifiedNum = numerator / gcd;
            const simplifiedDen = denominator / gcd;
            
            if (simplifiedNum <= 50 && simplifiedDen <= 50) {
                return `${simplifiedNum}:${simplifiedDen}`;
            }
        }
    }
    return null;
}

// Функция для нахождения наибольшего общего делителя
function findGCD(a, b) {
    while (b !== 0) {
        const temp = b;
        b = a % b;
        a = temp;
    }
    return a;
}

// Создание элемента информации
function createInfoItem(label, value) {
    const item = document.createElement('div');
    item.className = 'info-item';
    
    const labelSpan = document.createElement('span');
    labelSpan.className = 'label';
    labelSpan.textContent = label + ':';
    
    const valueSpan = document.createElement('span');
    valueSpan.className = 'value';
    valueSpan.textContent = value;
    
    item.appendChild(labelSpan);
    item.appendChild(valueSpan);
    
    return item;
}

// Переключение вкладок
function showTab(tabName) {
    // Скрываем все вкладки
    const tabs = document.querySelectorAll('.tab-pane');
    tabs.forEach(tab => tab.classList.remove('active'));
    
    // Убираем активность с кнопок
    const buttons = document.querySelectorAll('.tab-btn');
    buttons.forEach(btn => btn.classList.remove('active'));
    
    // Показываем нужную вкладку
    document.getElementById(tabName + '-tab').classList.add('active');
    event.target.classList.add('active');
}

// Показать загрузку
function showLoading() {
    document.getElementById('loadingSection').style.display = 'block';
    document.getElementById('resultsSection').style.display = 'none';
    
    // Создаем элементы прогресса, если их еще нет
    if (!document.getElementById('progressBar')) {
        const loadingSection = document.getElementById('loadingSection');
        
        const progressContainer = document.createElement('div');
        progressContainer.className = 'progress-container';
        progressContainer.innerHTML = `
            <div class="progress-bar-container">
                <div class="progress-bar" id="progressBar"></div>
            </div>
            <div class="progress-text" id="progressText">Инициализация...</div>
        `;
        
        loadingSection.appendChild(progressContainer);
    }
}

// Обновление прогресса
function updateProgress(percent, text) {
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    
    if (progressBar) {
        progressBar.style.width = percent + '%';
    }
    
    if (progressText) {
        progressText.textContent = text || `${Math.round(percent)}%`;
    }
}

// Скрыть загрузку
function hideLoading() {
    document.getElementById('loadingSection').style.display = 'none';
}

// Сброс анализатора
function resetAnalyzer() {
    document.getElementById('resultsSection').style.display = 'none';
    document.getElementById('uploadSection').style.display = 'block';
    document.getElementById('fileInput').value = '';
    currentFileData = null;
    
    // Очищаем прогресс-бар
    const progressContainer = document.querySelector('.progress-container');
    if (progressContainer) {
        progressContainer.remove();
    }
    
    // Принудительная очистка памяти
    if (window.gc) {
        window.gc();
    }
}

// Экспорт результатов
function exportResults() {
    if (!currentFileData) return;

    const rawData = document.getElementById('rawInfo').textContent;
    const blob = new Blob([rawData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = currentFileData.name + '_mediainfo.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Форматирование размера файла
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
