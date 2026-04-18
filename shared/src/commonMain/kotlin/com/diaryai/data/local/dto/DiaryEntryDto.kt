package com.diaryai.data.local.dto

import kotlinx.serialization.Serializable

@Serializable
data class DiaryEntryDto(
    val id: String,
    val content: String,
    val date: Long,
    val mood: String? = null,
    val tags: List<String> = emptyList(),
    val aiSummary: String? = null,
)
