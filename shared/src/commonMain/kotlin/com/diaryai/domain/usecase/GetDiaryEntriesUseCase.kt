package com.diaryai.domain.usecase

import com.diaryai.domain.model.DiaryEntry
import com.diaryai.domain.repository.DiaryEntryRepository

class GetDiaryEntriesUseCase(
    private val repository: DiaryEntryRepository,
) {
    suspend operator fun invoke(): Result<List<DiaryEntry>> =
        repository.getEntries()
}
