use crate::llm::ai_services::model_resolver::{resolve_model_identifier, FallbackStrategy};
use crate::llm::ai_services::stream_collector::StreamCollector;
use crate::llm::ai_services::stream_runner::StreamRunner;
use crate::llm::ai_services::types::{CompletionContext, CompletionResult};
use crate::llm::auth::api_key_manager::ApiKeyManager;
use crate::llm::providers::provider_registry::ProviderRegistry;
use std::time::Duration;

pub struct CompletionService;

impl CompletionService {
    pub fn new() -> Self {
        Self
    }

    /// Get AI completion for code based on context
    pub async fn get_completion(
        &self,
        context: CompletionContext,
        api_keys: &ApiKeyManager,
        registry: &ProviderRegistry,
    ) -> Result<CompletionResult, String> {
        log::info!(
            "getCompletion context: fileName={}, language={}, cursorPosition={}, contentLength={}",
            context.file_name,
            context.language,
            context.cursor_position,
            context.file_content.len()
        );

        let byte_offset =
            utf16_offset_to_byte_index(&context.file_content, context.cursor_position);

        let (previous_context, current_line, after_context) =
            Self::extract_context(&context.file_content, byte_offset, 10, 5);

        let prompt = self.build_prompt(
            &context.file_name,
            &context.language,
            &previous_context,
            &current_line,
            &after_context,
        );

        let model_identifier = resolve_model_identifier(
            api_keys,
            registry,
            context.model.clone(),
            FallbackStrategy::AnyAvailable,
        )
        .await?;

        let request = StreamCollector::create_completion_request(model_identifier, None, prompt);

        let runner = StreamRunner::new(registry.clone(), api_keys.clone());
        let result =
            StreamCollector::collect_with_runner(&runner, request, Duration::from_secs(30)).await?;

        Ok(CompletionResult {
            completion: result.text,
            range: None,
        })
    }

    /// Extract context around cursor position
    fn extract_context(
        content: &str,
        cursor_pos: usize,
        lines_before: usize,
        lines_after: usize,
    ) -> (String, String, String) {
        let before = if cursor_pos <= content.len() {
            &content[..cursor_pos]
        } else {
            content
        };
        let after = if cursor_pos < content.len() {
            &content[cursor_pos..]
        } else {
            ""
        };

        let before_lines: Vec<&str> = before.split('\n').collect();

        let (current_line, previous_lines_count) = if before.ends_with('\n') {
            ("".to_string(), before_lines.len().saturating_sub(1))
        } else {
            let current = before_lines.last().unwrap_or(&"").to_string();
            (current, before_lines.len().saturating_sub(1))
        };

        let context_start = previous_lines_count.saturating_sub(lines_before);
        let previous_lines_slice = &before_lines[context_start..previous_lines_count];
        let previous_context = previous_lines_slice.join("\n");

        let after_lines: Vec<&str> = after.split('\n').take(lines_after).collect();
        let after_context = after_lines.join("\n");

        (previous_context, current_line, after_context)
    }

    /// Build the completion prompt
    fn build_prompt(
        &self,
        file_name: &str,
        language: &str,
        previous_context: &str,
        current_line: &str,
        after_context: &str,
    ) -> String {
        format!(
            "You are an AI code completion assistant. Complete the following {} code.\n\n\
             File: {}\n\
             Context (previous lines):\n\
             ```{}\n\
             {}\n\
             ```\n\n\
             Current incomplete line: \"{}\"\n\n\
             After cursor:\n\
             ```{}\n\
             {}\n\
             ```\n\n\
             Provide ONLY the completion text that should be inserted at the cursor position. \
             Do not include the existing text or explanations.\n\
             Response should be plain text without markdown formatting.\n\
             Keep the completion concise and relevant to the current context.",
            language, file_name, language, previous_context, current_line, language, after_context
        )
    }
}

impl Default for CompletionService {
    fn default() -> Self {
        Self::new()
    }
}

fn utf16_offset_to_byte_index(text: &str, utf16_offset: usize) -> usize {
    let mut count = 0usize;
    for (byte_index, ch) in text.char_indices() {
        let len = ch.len_utf16();
        if count + len > utf16_offset {
            return byte_index;
        }
        count += len;
    }
    text.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_context_gets_correct_lines() {
        let content =
            "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11\nline12";

        // Cursor at the beginning of line12 (after "\n" at end of line11)
        let cursor_pos = content.find("line12").unwrap();

        let (prev, current, after) = CompletionService::extract_context(content, cursor_pos, 10, 5);

        // prev should contain lines 2-11 (10 lines before cursor)
        assert!(prev.contains("line2"));
        assert!(prev.contains("line10"));
        assert!(prev.contains("line11"));
        // current is empty because cursor is at start of a new line
        assert_eq!(current, "");
        assert_eq!(after, "line12");
    }

    #[test]
    fn extract_context_handles_cursor_at_end() {
        let content = "line1\nline2";
        let cursor_pos = content.len();

        let (prev, current, after) = CompletionService::extract_context(content, cursor_pos, 10, 5);

        assert_eq!(prev, "line1");
        assert_eq!(current, "line2");
        assert_eq!(after, "");
    }

    #[test]
    fn extract_context_handles_empty_after() {
        let content = "line1\nline2";
        let cursor_pos = content.len();

        let (_, _, after) = CompletionService::extract_context(content, cursor_pos, 10, 5);

        assert_eq!(after, "");
    }

    #[test]
    fn build_prompt_contains_all_parts() {
        let service = CompletionService::new();
        let prompt = service.build_prompt(
            "test.ts",
            "typescript",
            "const x = 1;",
            "const y = ",
            "console.log(y);",
        );

        assert!(prompt.contains("test.ts"));
        assert!(prompt.contains("typescript"));
        assert!(prompt.contains("const x = 1;"));
        assert!(prompt.contains("const y = "));
        assert!(prompt.contains("console.log(y);"));
        assert!(prompt.contains("AI code completion assistant"));
    }

    #[test]
    fn build_prompt_escapes_correctly() {
        let service = CompletionService::new();
        let prompt = service.build_prompt(
            "file.rs",
            "rust",
            "fn main() {",
            "    let x = \"test\";",
            "}",
        );

        assert!(prompt.contains("```rust"));
        assert!(prompt.contains("file.rs"));
    }

    #[test]
    fn utf16_offset_to_byte_index_handles_multibyte_chars() {
        let text = "ab😀中";
        // UTF-16 code units: a(1) b(1) 😀(2) 中(1)
        assert_eq!(utf16_offset_to_byte_index(text, 0), 0);
        assert_eq!(utf16_offset_to_byte_index(text, 1), 1);
        assert_eq!(utf16_offset_to_byte_index(text, 2), 2);
        // After emoji (2 code units) -> byte index after 😀
        assert_eq!(utf16_offset_to_byte_index(text, 4), "ab😀".len());
        assert_eq!(utf16_offset_to_byte_index(text, 5), text.len());
    }
}
