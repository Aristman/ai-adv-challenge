package com.diaryai.domain.repository

import com.diaryai.domain.model.DiaryEntry

interface DiaryEntryRepository {
    suspend fun getEntries(): Result<List<DiaryEntry>>
    suspend fun getById(id: String): Result<DiaryEntry>
    suspend fun saveEntry(entry: DiaryEntry): Result<Unit>
    suspend fun deleteEntry(id: String): Result<Unit>
}
