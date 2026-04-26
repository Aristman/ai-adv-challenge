# Спецификация: Файн-тюнинг модели для генерации Kotlin-кода

**Дата:** 2026-04-26
**Статус:** Черновик
**Тип:** Новый проект (отдельная задача)

---

## 1. Обзор

### 1.1 Цель

Подготовить полный пайплайн файн-тюнинга LLM через OpenAI API для задачи **генерации Kotlin-кода**. Результат: датасет, скрипты, baseline-замеры и клиент для запуска файнтюна.

### 1.2 Контекст

- Задача отдельная (не привязана к DiaryAI)
- Стек клиента: **TypeScript** (Node.js)
- Модель: OpenAI API (gpt-4o-mini для baseline и файнтюна)
- Датасет: **минимум 50 примеров** в формате JSONL (Chat Completions)
- Реальных данных: **минимум 20%** (10+ примеров из реального Kotlin-кода)
- Остальное: генерация через ИИ (gpt-4o-mini или любую другую модель)

### 1.3 Решение

Создать набор артефактов:
1. **Датасет** (train + eval) в JSONL — примеры пар "запрос → Kotlin-код"
2. **Скрипт валидации** — проверка формата, дублей, пустых полей
3. **Baseline-ответы** — 10 примеров через gpt-4o-mini без файнтюна
4. **Клиент на TypeScript** — автоматизация загрузки и запуска файнтюна
5. **Критерии оценки** — метрики качества генерации кода

---

## 2. Функциональные требования

### 2.1 Датасет

| Требование | Значение |
|-----------|----------|
| Формат | JSONL, Chat Completions (`messages: [{role, content}]`) |
| Минимальный размер | 50 примеров |
| Реальные данные | ≥ 20% (≥ 10 примеров) |
| Роли в каждом примере | `system` + `user` + `assistant` |
| Split | train 80% (40) / eval 20% (10) |

**Формат одной строки:**
```jsonl
{"messages": [
  {"role": "system", "content": "Ты — эксперт по Kotlin. Пиши чистый, идиоматичный код."},
  {"role": "user", "content": "Напиши функцию для подсчёта частоты символов в строке"},
  {"role": "assistant", "content": "fun charFrequency(s: String): Map<Char, Int> =\n    s.groupingBy { it }.eachCount()"}
]}
```

### 2.2 Типы примеров в датасете

| Категория | Доля | Примеры |
|-----------|------|---------|
| Функции-утилиты | 30% | charFrequency, flatten, chunked, partition, distinct |
| Data-классы и модели | 15% | data class + extensions + мапперы |
| Kotlin-специфика | 15% | scope functions (let/apply/run), sealed class, coroutines |
| Коллекции и Sequences | 15% | filter/map/fold, groupingBy, sequence |
| Null-safety | 10% | safe call, elvis, requireNotNull, let |
| Расширения (extensions) | 15% | extension functions/properties для стандартных типов |

### 2.3 Источники реальных данных

Реальные примеры (≥ 10) берутся из проекта **DiaryAI**:
- `shared/src/commonMain/kotlin/com/diaryai/domain/model/DiaryEntry.kt` — data class
- `shared/src/commonMain/kotlin/com/diaryai/data/mapper/DiaryEntryDtoToDomainMapper.kt` — маппер
- `shared/src/commonMain/kotlin/com/diaryai/data/repository/DiaryEntryRepositoryImpl.kt` — реализация
- `shared/src/commonMain/kotlin/com/diaryai/domain/usecase/GetDiaryEntriesUseCase.kt` — use case
- `shared/src/commonMain/kotlin/com/diaryai/data/local/dao/DiaryEntryDao.kt` — DAO
- `shared/src/commonMain/kotlin/com/diaryai/data/local/dto/DiaryEntryDto.kt` — DTO

Из каждого файла берётся 1-2 фрагмента кода с запросом на естественном языке.

### 2.4 Скрипт валидации

Скрипт на **TypeScript** (Node.js), который проверяет:

| Проверка | Описание |
|----------|----------|
| JSON-валидность | Каждая строка — валидный JSON |
| Структура | Есть поле `messages` — массив |
| Роли | В каждом примере есть `system`, `user`, `assistant` |
| Пустые content | Ни один `content` не пустой и не null |
| Дубли | Нет полностью идентичных строк `messages` |
| Длина | Минимальная длина content ≥ 10 символов |
| Размер | Вывод статистики: количество, min/max длина, распределение |

**Интерфейс:** `npx ts-node validate.ts --input data/dataset.jsonl`

### 2.5 Baseline

| Шаг | Детали |
|-----|--------|
| Выборка | 10 примеров из eval-сета |
| Модель | gpt-4o-mini (температура 0, без system prompt) |
| Процесс | Каждый user-запрос отправляется как есть, assistant-ответ сохраняется |
| Результат | Файл `baseline-responses.jsonl` — оригинал + ответ модели |
| Критерии | См. раздел 2.6 |

### 2.6 Критерии оценки

| Критерий | Вес | Описание |
|----------|-----|----------|
| **Синтаксическая корректность** | 40% | Код компилируется (ключевой для генерации кода) |
| **Формальное соответствие** | 25% | Тип возврата, сигнатура, использование правильных API |
| **Стиль/идиоматичность** | 20% | Использование Kotlin-идиом (scope functions, extensions, immutability) |
| **Полнота** | 15% | Все необходимые импорты, обработка краевых случаев |

Шкала: 0-10 по каждому критерию. Итог: взвешенная сумма.

---

## 3. План работ

### Этап 1: Сбор датасета (JSONL)

**Файлы:**
- `data/dataset.jsonl` — полный датасет (50+ строк)
- `data/train.jsonl` — 80% (40 строк)
- `data/eval.jsonl` — 20% (10 строк)

**Процесс:**
1. Извлечь 10+ реальных фрагментов Kotlin-кода из DiaryAI
2. Для каждого написать промпт на русском/английском (user) и сам код как ответ (assistant)
3. Сгенерировать 40+ синтетических примеров через gpt-4o-mini
4. Очистить: убрать дубли, пустые строки, проверить формат
5. Разделить train/eval в пропорции 80/20

### Этап 2: Скрипт валидации

**Файл:** `scripts/validate.ts`

**Логика:**
- Читает JSONL файл построчно
- Для каждой строки: JSON.parse → проверка структуры
- Статистика в консоль
- Код возврата: 0 если всё ОК, 1 если ошибки

**Зависимости:** минимальные — только Node.js built-ins + fs

### Этап 3: Baseline-замеры

**Файл:** `baseline-responses.jsonl`

**Формат строки:**
```jsonl
{"id": 1, "user": "...", "expected": "...", "model_response": "...", "score": null}
```

**Процесс:**
- Выбрать 10 примеров из eval
- Отправить user-запрос в gpt-4o-mini без system prompt
- Сохранить сырые ответы
- Оценка по критериям (раздел 2.6) — пока без файнтюна

### Этап 4: Клиент для запуска файнтюна

**Файл:** `scripts/fine-tune-client.ts`

**Процесс:**
```
1. uploadFile(train.jsonl) → fileId
2. createFineTuningJob({ fileId, model: "gpt-4o-mini" }) → jobId
3. pollJobStatus(jobId, каждые 30 сек) → finished/failed
4. При успехе: вывести modelId
```

**Требования:**
- OpenAI API key из переменной окружения `OPENAI_API_KEY`
- Использование `node-fetch` или `openai` npm-пакета
- Логирование шагов в консоль
- Обработка ошибок (rate limit, таймауты)
- Команда запуска: `npx ts-node scripts/fine-tune-client.ts --file data/train.jsonl`

### Этап 5: Сравнение baseline vs fine-tuned

- Взять те же 10 примеров из eval
- Прогнать через fine-tuned модель
- Сравнить оценки по критериям
- Оформить отчёт

---

## 4. Структура файлов

```
<project-root>/
├── data/
│   ├── dataset.jsonl         # Полный датасет (50+ строк)
│   ├── train.jsonl            # Train split (80%)
│   └── eval.jsonl             # Eval split (20%)
├── scripts/
│   ├── validate.ts            # Скрипт валидации датасета
│   ├── generate-synthetic.ts  # Генерация синтетических примеров (опционально)
│   └── fine-tune-client.ts    # Клиент для запуска файнтюна
├── baseline/
│   └── responses.jsonl        # 10 baseline-ответов gpt-4o-mini
├── criteria.md                # Критерии оценки качества генерации
└── README.md                  # Инструкция по запуску
```

---

## 5. Приоритеты (MoSCoW)

| Приоритет | Задача |
|-----------|--------|
| **Must** | Датасет 50+ примеров JSONL в правильном формате |
| **Must** | Разделение train/eval 80/20 |
| **Must** | Скрипт валидации датасета |
| **Must** | Baseline 10 примеров через gpt-4o-mini |
| **Must** | Клиент для файнтюна на TypeScript |
| **Must** | Критерии оценки |
| **Should** | ≥ 20% реальных данных из DiaryAI |
| **Should** | Генерация синтетики автоматизирована |
| **Could** | Сравнение baseline vs fine-tuned после файнтюна |
| **Could** | Кэширование запросов к API (чтобы не платить дважды) |

---

## 6. Риски и митигация

| Риск | Вероятность | Митигация |
|------|-------------|-----------|
| OpenAI API key не настроен | Низкая | Проверить `OPENAI_API_KEY` в env |
| Rate limits OpenAI | Средняя | Добавить retry с exponential backoff |
| Качество синтетических данных низкое | Средняя | Валидировать через gpt-4o-mini, удалять плохие |
| Датасет меньше 50 примеров | Низкая | Генерировать больше синтетики |
| Стоимость файнтюна | Низкая | gpt-4o-mini — $0.30/M токенов train, 50 примеров ≈ $0.5-1 |

---

## 7. Дальнейшие шаги

1. ✅ Создать `data/` и `scripts/` директории
2. ⬜ Собрать реальные примеры из DiaryAI (10+)
3. ⬜ Сгенерировать синтетические примеры (40+)
4. ⬜ Сформировать полный датасет и разбить на train/eval
5. ⬜ Написать скрипт валидации и прогнать на датасете
6. ⬜ Запустить baseline (10 примеров gpt-4o-mini)
7. ⬜ Записать критерии оценки
8. ⬜ Написать клиент для файнтюна на TypeScript
9. ⬜ *(Опционально)* Запустить файнтюн
10. ⬜ *(Опционально)* Сравнить baseline и fine-tuned
