package com.diaryai.data.mapper

import com.diaryai.data.local.dto.DiaryEntryDto
import com.diaryai.domain.model.DiaryEntry
import com.diaryai.domain.model.Mood
import io.github.aakira.napier.Napier

class DiaryEntryDtoToDomainMapper {

    private companion object {
        const val LOG_TAG = "DiaryEntryDtoToDomainMapper"
    }

    fun map(dto: DiaryEntryDto): DiaryEntry = DiaryEntry(
        id = dto.id,
        content = dto.content,
        date = dto.date,
        mood = dto.mood?.let { moodStr ->
            runCatching { Mood.valueOf(moodStr) }.onFailure {
                Napier.w("Invalid mood value: '$moodStr' for entry ${dto.id}", throwable = it, tag = LOG_TAG)
            }.getOrElse { throw it }
        },
        tags = dto.tags,
        aiSummary = dto.aiSummary,
    )

    fun mapReverse(entry: DiaryEntry): DiaryEntryDto = DiaryEntryDto(
        id = entry.id,
        content = entry.content,
        date = entry.date,
        mood = entry.mood?.name,
        tags = entry.tags,
        aiSummary = entry.aiSummary,
    )
}
