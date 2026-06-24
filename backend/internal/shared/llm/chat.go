// Package llm เก็บโครงสร้าง chat-completion และตัวคุมอัตราเรียก (rate limiter)
// ที่ใช้ร่วมกันระหว่าง scan, aisummary และ quickentry
package llm

// LLMChatReq คือ payload มาตรฐานของ chat-completion (OpenAI-compatible)
type LLMChatReq struct {
	Model       string       `json:"model"`
	Messages    []LLMChatMsg `json:"messages"`
	MaxTokens   int          `json:"max_tokens"`
	Temperature float64      `json:"temperature"`
	TopP        float64      `json:"top_p"`
}

type LLMChatMsg struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type LLMChatResp struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}
