# Отчёт: Файн-тюнинг модели для генерации Kotlin-кода

**Дата:** 2026-04-26
**Ветка:** AIACH-005
**Статус:** ✅ Выполнено (baseline + файнтюн — отложены до наличия API-ключа)

---

## 1. Задача

Полный пайплайн подготовки к файн-тюну LLM через OpenAI API для генерации Kotlin-кода.

### Чек-лист задания

| # | Требование | Статус | Детали |
|---|-----------|--------|--------|
| 1 | Выбор задачи | ✅ | Генерация Kotlin-кода |
| 2 | Датасет ≥50 примеров JSONL | ✅ | 60 примеров (12 real + 48 synthetic) |
| 3 | Формат: messages с system/user/assistant | ✅ | Все 60 строк валидны |
| 4 | ≥20% реальных данных | ✅ | 20% (12/60) из DiaryAI |
| 5 | Убрать мусор (дубли, пустые, короткие) | ✅ | Валидация пройдена |
| 6 | Разделение train (80%) / eval (20%) | ✅ | 48 train / 12 eval |
| 7 | Скрипт валидации | ✅ | scripts/validate.ts |
| 8 | Baseline: 10 примеров gpt-4o-mini | ⏸️ | Скрипт готов, API-ключ не задан |
| 9 | Критерии оценки | ✅ | criteria.md (4 критерия, веса) |
| 10 | Клиент для запуска файнтюна | ✅ | scripts/fine-tune-client.ts |

---

## 2. Датасет

### Статистика
- Файл: data/dataset.jsonl
- Размер: 60 примеров
- Реальных: 12 (20%) из DiaryAI
- Синтетических: 48 (80%)
- Train: 48 примеров (data/train.jsonl)
- Eval: 12 примеров (data/eval.jsonl)

### Формат
Каждая строка — JSON объект:

```jsonl
{"messages": [
  {"role": "system", "content": "You are an expert Kotlin developer..."},
  {"role": "user", "content": "Запрос на генерацию кода"},
  {"role": "assistant", "content": "data class Example(...)"}
]}
```

### Категории примеров
| Категория | Кол-во | % | Примеры |
|-----------|--------|---|---------|
| Утилиты | 14 | 23% | charFrequency, flatten, chunked, fibonacci... |
| Data-классы и модели | 8 | 13% | User+Role, ApiResponse, ValidationResult... |
| Kotlin-специфика | 8 | 13% | sealed+when, scope functions, value class... |
| Коллекции и Sequences | 8 | 13% | groupingBy, sliding window, top-K... |
| Null-safety и ошибки | 5 | 8% | requireNotNull, runCatching+recover... |
| Extensions | 5 | 8% | toSlug, partitionN, rootCause... |
| Из DiaryAI (реальные) | 12 | 20% | DiaryEntry, Repository, UseCase, DTO, Mapper... |

### Реальные данные (источники)
| Файл | Примеры | Извлечённые паттерны |
|------|---------|---------------------|
| domain/model/DiaryEntry.kt | 2 | data class, enum class |
| domain/repository/DiaryEntryRepository.kt | 1 | suspend + Result interface |
| domain/usecase/GetDiaryEntriesUseCase.kt | 2 | operator fun invoke |
| data/local/dao/DiaryEntryDao.kt | 1 | DAO interface |
| data/local/dto/DiaryEntryDto.kt | 1 | @Serializable DTO |
| data/mapper/DiaryEntryDtoToDomainMapper.kt | 3 | DTO↔Domain mapping, runCatching |
| data/repository/DiaryEntryRepositoryImpl.kt | 2 | Repository impl, coroutines |

### Валидация
```
$ npx ts-node scripts/validate.ts --input data/dataset.jsonl
Validating data/dataset.jsonl...
[1/60] PASS
...
[60/60] PASS
✓ Valid lines: 60/60
✗ Invalid lines: 0/60
✓ Duplicates: 0
✓ Min content length: 70
✓ Max content length: 1064
RESULT: PASS
```

---

## 3. Скрипты

### 3.1 validate.ts
- **Путь:** scripts/validate.ts
- **Назначение:** Валидация JSONL датасета
- **Проверки:** JSON, messages структура, roles, content тип, content пустой, дубли, min длина
- **Код возврата:** 0=OK, 1=ошибка

### 3.2 baseline.ts
- **Путь:** scripts/baseline.ts
- **Назначение:** Baseline-замеры через gpt-4o-mini
- **Модель:** gpt-4o-mini, temperature=0, без system prompt
- **Rate limit:** 1 сек между запросами
- **Вывод:** baseline/responses.jsonl

### 3.3 fine-tune-client.ts
- **Путь:** scripts/fine-tune-client.ts
- **Назначение:** Автоматизация файнтюна через OpenAI API
- **Пайплайн:** validate → upload → create job → poll status
- **Retry:** exponential backoff (3 попытки)
- **Команды:** --file для запуска, --status для проверки статуса

---

## 4. Критерии оценки

Файл: criteria.md

| Критерий | Вес | Описание |
|----------|-----|----------|
| Синтаксическая корректность | 40% | Код компилируется без ошибок |
| Формальное соответствие | 25% | Типы, сигнатура, результат |
| Идиоматичность / Стиль | 20% | Kotlin-идиомы, data class, sealed, Result |
| Полнота | 15% | Импорты, edge cases, документация |

```
Score = 0.4 × Syntax + 0.25 × Compliance + 0.2 × Style + 0.15 × Completeness
```

---

## 5. Git-история

| Commit | Сообщение | Детали |
|--------|-----------|--------|
| f779b99 | create spec | Спецификация плана |
| 099eff0 | feat: init fine-tuning project structure and dataset | package.json, tsconfig, dataset 60 примеров |
| ff7675f | fix: remove duplicate entry, replace println with Napier | Починка датасета |
| b5dda5c | feat: add validation script, baseline runner, fine-tune client | Все скрипты + criteria.md |
| 731c2b9 | fix: resolve TS compilation errors, add content type validation | Починка скриптов |

---

## 6. Найденные и починенные баги

| # | Баг | Серьёзность | Починка | Commit |
|---|-----|-------------|---------|--------|
| 1 | Дубликат в датасете (use case примеры 3 и 11) | HIGH | Удалён, заменён уникальным примером | ff7675f |
| 2 | println() в обучающих данных | MEDIUM | Заменён на Napier | ff7675f |
| 3 | Отсутствие trailing newline в JSONL | LOW | Добавлен | ff7675f |
| 4 | FineTuningJob тип несовместим с SDK v4 | CRITICAL | Исправлен доступ к свойствам | 731c2b9 |
| 5 | Нет проверки типа content в validate.ts | MEDIUM | Добавлена typeof string проверка | 731c2b9 |

---

## 7. Как запустить

### Валидация датасета
```bash
npx ts-node scripts/validate.ts --input data/dataset.jsonl
```

### Baseline (требуется OPENAI_API_KEY)
```bash
export OPENAI_API_KEY="sk-your-key-here"
npx ts-node scripts/baseline.ts --input data/eval.jsonl --output baseline/responses.jsonl
```

### Файнтюн (требуется OPENAI_API_KEY)
```bash
export OPENAI_API_KEY="sk-your-key-here"
npx ts-node scripts/fine-tune-client.ts --file data/train.jsonl
```

### Проверка статуса файнтюна
```bash
npx ts-node scripts/fine-tune-client.ts --status ftjob-xxx
```

---

## 8. Что осталось

| Задача | Статус | Как сделать |
|--------|--------|-------------|
| Запустить baseline | ⏸️ | OPENAI_API_KEY + npx ts-node scripts/baseline.ts |
| Оценить baseline ответы | ⏸️ | criteria.md — оценить 10 ответов вручную |
| Запустить файнтюн | ⏸️ | npx ts-node scripts/fine-tune-client.ts --file data/train.jsonl |
| Запустить eval на fine-tuned модели | ⏸️ | Модифицировать baseline.ts с fine-tuned model id |
| Сравнить baseline vs fine-tuned | ⏸️ | Оценить по criteria.md, составить таблицу сравнения |

---

## 9. Файловая структура

```
ai-adv-challenge/
├── data/
│   ├── dataset.jsonl          # 60 примеров (57KB)
│   ├── train.jsonl            # 48 примеров (45KB)
│   └── eval.jsonl             # 12 примеров (12KB)
├── scripts/
│   ├── validate.ts            # Валидация JSONL
│   ├── baseline.ts            # Baseline gpt-4o-mini
│   └── fine-tune-client.ts    # Клиент файнтюна
├── baseline/                  # Пусто (для результатов)
├── criteria.md                # Критерии оценки
├── docs/specs/
│   ├── spec_fine-tuning-kotlin-code_2026-04-26.md
│   └── report_fine-tuning-kotlin-code_2026-04-26.md  ← этот файл
├── package.json
├── tsconfig.json
└── .gitignore
```
