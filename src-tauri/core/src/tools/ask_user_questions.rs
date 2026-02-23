use crate::core::tools::ToolContext;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AskUserQuestionsResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub answers: Option<serde_json::Map<String, serde_json::Value>>,
}

#[derive(Debug, Deserialize)]
pub struct QuestionOption {
    pub label: String,
    pub description: String,
}

#[derive(Debug, Deserialize)]
pub struct Question {
    pub id: String,
    pub question: String,
    pub header: String,
    pub options: Vec<QuestionOption>,
    pub multi_select: bool,
}

/// Execute askUserQuestions tool
/// Note: In backend-only mode, this returns an error since we cannot interact with the user
pub async fn execute(questions: Vec<Question>, _ctx: &ToolContext) -> AskUserQuestionsResult {
    // Validate that question IDs are unique
    let mut ids = std::collections::HashSet::new();
    for question in &questions {
        if !ids.insert(&question.id) {
            return AskUserQuestionsResult {
                success: false,
                error: Some(format!("Duplicate question IDs found: {}", question.id)),
                answers: None,
            };
        }
    }

    // In backend mode without UI, we cannot ask the user
    // Return a clear error message
    AskUserQuestionsResult {
        success: false,
        error: Some(
            "askUserQuestions tool requires user interaction which is not available in backend-only mode. \
            Please provide all necessary information in the initial request or use default values. \
            In a full application, this would pause execution and wait for user input.".to_string()
        ),
        answers: None,
    }
}

/// For auto-approve mode or testing, generate default answers
/// Selects the first option for each question
pub fn generate_default_answers(
    questions: &[Question],
) -> serde_json::Map<String, serde_json::Value> {
    let mut answers = serde_json::Map::new();

    for question in questions {
        if question.multi_select {
            // For multi-select, select first option
            if let Some(first_option) = question.options.first() {
                answers.insert(
                    question.id.clone(),
                    serde_json::json!({
                        "selectedOptions": vec![&first_option.label],
                        "customText": null
                    }),
                );
            }
        } else {
            // For single-select, select first option
            if let Some(first_option) = question.options.first() {
                answers.insert(
                    question.id.clone(),
                    serde_json::json!({
                        "selectedOptions": vec![&first_option.label],
                        "customText": null
                    }),
                );
            }
        }
    }

    answers
}
