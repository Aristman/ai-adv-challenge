package com.diaryai.domain.model

data class DiaryEntry(
    val id: String,
    val content: String,
    val date: Long,
    val mood: Mood? = null,
    val tags: List<String> = emptyList(),
    val aiSummary: String? = null,
)

enum class Mood {
    GREAT, GOOD, NEUTRAL, BAD, AWFUL,
}
