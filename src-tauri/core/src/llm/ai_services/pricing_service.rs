use crate::llm::ai_services::types::{CalculateCostRequest, CalculateCostResult, TokenUsage};
use crate::llm::types::ModelConfig;
use std::collections::HashMap;

pub struct PricingService;

impl PricingService {
    pub fn new() -> Self {
        Self
    }

    /// Calculate the cost based on model ID and token usage
    pub fn calculate_cost(
        &self,
        model_id: &str,
        usage: &TokenUsage,
        model_configs: &HashMap<String, ModelConfig>,
    ) -> Result<f64, String> {
        let model = self.get_model(model_id, model_configs);

        let pricing = match model.and_then(|m| m.pricing.clone()) {
            Some(p) => p,
            None => {
                log::error!("Pricing information not available for model: {}", model_id);
                return Ok(0.0);
            }
        };

        let input_rate = Self::parse_rate(&pricing.input, 0.0);
        let output_rate = Self::parse_rate(&pricing.output, 0.0);
        let cached_input_rate = pricing
            .cached_input
            .as_ref()
            .map(|r| Self::parse_rate(r, input_rate))
            .unwrap_or(input_rate);
        let cache_creation_rate = pricing
            .cache_creation
            .as_ref()
            .map(|r| Self::parse_rate(r, input_rate))
            .unwrap_or(input_rate);

        let cached_input_tokens = usage.cached_input_tokens.unwrap_or(0);
        let cache_creation_input_tokens = usage.cache_creation_input_tokens.unwrap_or(0);
        let non_cached_input_tokens = usage
            .input_tokens
            .saturating_sub(cached_input_tokens)
            .saturating_sub(cache_creation_input_tokens);

        let mut cost = 0.0_f64;
        cost += f64::from(non_cached_input_tokens) * input_rate;
        cost += f64::from(cached_input_tokens) * cached_input_rate;
        cost += f64::from(cache_creation_input_tokens) * cache_creation_rate;
        cost += f64::from(usage.output_tokens) * output_rate;

        Ok(cost)
    }

    /// Public calculate cost with request struct
    pub fn calculate_cost_request(
        &self,
        request: CalculateCostRequest,
    ) -> Result<CalculateCostResult, String> {
        let cost =
            self.calculate_cost(&request.model_id, &request.usage, &request.model_configs)?;
        Ok(CalculateCostResult { cost })
    }

    /// Get model config by ID (handles @provider suffix)
    fn get_model<'a>(
        &self,
        model_id: &str,
        model_configs: &'a HashMap<String, ModelConfig>,
    ) -> Option<&'a ModelConfig> {
        // Try exact match first
        if let Some(model) = model_configs.get(model_id) {
            return Some(model);
        }

        // Try without @provider suffix
        let base_model_id = if model_id.contains('@') {
            model_id.split('@').next().unwrap_or(model_id)
        } else {
            model_id
        };

        model_configs.get(base_model_id)
    }

    /// Parse rate string to f64, returning fallback if invalid
    fn parse_rate(value: &str, fallback: f64) -> f64 {
        value
            .parse::<f64>()
            .ok()
            .filter(|v| v.is_finite())
            .unwrap_or(fallback)
    }
}

impl Default for PricingService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::types::{ModelConfig, ModelPricing};
    use std::collections::HashMap;

    fn create_test_model_config(
        input: &str,
        output: &str,
        cached_input: Option<&str>,
        cache_creation: Option<&str>,
    ) -> ModelConfig {
        ModelConfig {
            name: "Test Model".to_string(),
            image_input: false,
            image_output: false,
            audio_input: false,
            video_input: false,
            interleaved: false,
            providers: vec!["test".to_string()],
            provider_mappings: None,
            pricing: Some(ModelPricing {
                input: input.to_string(),
                output: output.to_string(),
                cached_input: cached_input.map(|s| s.to_string()),
                cache_creation: cache_creation.map(|s| s.to_string()),
            }),
            context_length: None,
        }
    }

    fn create_simple_model_config(input: &str, output: &str) -> ModelConfig {
        create_test_model_config(input, output, None, None)
    }

    #[test]
    fn calculate_cost_with_cached_and_cache_creation_tokens() {
        let service = PricingService::new();
        let mut configs = HashMap::new();
        configs.insert(
            "gpt-5-mini".to_string(),
            create_test_model_config("0.00000025", "0.000002", Some("0.00000003"), Some("0")),
        );

        let usage = TokenUsage {
            input_tokens: 100,
            output_tokens: 50,
            cached_input_tokens: Some(40),
            cache_creation_input_tokens: Some(10),
        };

        let cost = service
            .calculate_cost("gpt-5-mini", &usage, &configs)
            .unwrap();

        let input_rate = 0.00000025_f64;
        let output_rate = 0.000002_f64;
        let cached_rate = 0.00000003_f64;
        let cache_creation_rate = 0.0_f64;
        let non_cached_input = 100 - 40 - 10;
        let expected = f64::from(non_cached_input) * input_rate
            + f64::from(40) * cached_rate
            + f64::from(10) * cache_creation_rate
            + f64::from(50) * output_rate;

        assert!((cost - expected).abs() < f64::EPSILON);
    }

    #[test]
    fn falls_back_to_input_rate_when_cached_rates_missing() {
        let service = PricingService::new();
        let mut configs = HashMap::new();
        configs.insert(
            "gemini-2.5-flash".to_string(),
            create_simple_model_config("0.0000003", "0.0000025"),
        );

        let usage = TokenUsage {
            input_tokens: 120,
            output_tokens: 60,
            cached_input_tokens: Some(30),
            cache_creation_input_tokens: Some(20),
        };

        let cost = service
            .calculate_cost("gemini-2.5-flash", &usage, &configs)
            .unwrap();

        let input_rate = 0.0000003_f64;
        let output_rate = 0.0000025_f64;
        let expected = (120 - 30 - 20) as f64 * input_rate
            + 30.0 * input_rate
            + 20.0 * input_rate
            + 60.0 * output_rate;

        assert!((cost - expected).abs() < f64::EPSILON);
    }

    #[test]
    fn handles_missing_pricing_gracefully() {
        let service = PricingService::new();
        let configs = HashMap::new();

        let usage = TokenUsage {
            input_tokens: 10,
            output_tokens: 5,
            cached_input_tokens: None,
            cache_creation_input_tokens: None,
        };

        let cost = service
            .calculate_cost("missing-model", &usage, &configs)
            .unwrap();
        assert_eq!(cost, 0.0);
    }

    #[test]
    fn handles_model_with_provider_suffix() {
        let service = PricingService::new();
        let mut configs = HashMap::new();
        configs.insert(
            "claude-sonnet-4.5".to_string(),
            create_simple_model_config("0.000003", "0.000015"),
        );

        let usage = TokenUsage {
            input_tokens: 1000,
            output_tokens: 500,
            cached_input_tokens: None,
            cache_creation_input_tokens: None,
        };

        let cost = service
            .calculate_cost("claude-sonnet-4.5@openRouter", &usage, &configs)
            .unwrap();

        let input_rate = 0.000003_f64;
        let output_rate = 0.000015_f64;
        let expected = 1000.0 * input_rate + 500.0 * output_rate;

        assert!((cost - expected).abs() < f64::EPSILON);
    }

    #[test]
    fn handles_zero_tokens() {
        let service = PricingService::new();
        let mut configs = HashMap::new();
        configs.insert(
            "test-model".to_string(),
            create_simple_model_config("0.000001", "0.000002"),
        );

        let usage = TokenUsage {
            input_tokens: 0,
            output_tokens: 0,
            cached_input_tokens: None,
            cache_creation_input_tokens: None,
        };

        let cost = service
            .calculate_cost("test-model", &usage, &configs)
            .unwrap();
        assert_eq!(cost, 0.0);
    }

    #[test]
    fn handles_invalid_pricing_values() {
        let service = PricingService::new();
        let mut configs = HashMap::new();
        configs.insert(
            "invalid-model".to_string(),
            create_simple_model_config("invalid", "also_invalid"),
        );

        let usage = TokenUsage {
            input_tokens: 100,
            output_tokens: 50,
            cached_input_tokens: None,
            cache_creation_input_tokens: None,
        };

        let cost = service
            .calculate_cost("invalid-model", &usage, &configs)
            .unwrap();
        // Invalid rates fall back to 0
        assert_eq!(cost, 0.0);
    }

    #[test]
    fn handles_mixed_valid_invalid_rates() {
        let service = PricingService::new();
        let mut configs = HashMap::new();
        configs.insert(
            "mixed-model".to_string(),
            create_test_model_config("0.000001", "invalid", Some("0.0000005"), Some("bad")),
        );

        let usage = TokenUsage {
            input_tokens: 100,
            output_tokens: 50,
            cached_input_tokens: Some(20),
            cache_creation_input_tokens: Some(10),
        };

        let cost = service
            .calculate_cost("mixed-model", &usage, &configs)
            .unwrap();

        // input_rate: 0.000001 (valid)
        // output_rate: 0 (invalid falls back)
        // cached_input_rate: 0.0000005 (valid)
        // cache_creation_rate: 0.000001 (invalid falls back to input_rate)
        let expected = 70.0 * 0.000001 + 20.0 * 0.0000005 + 10.0 * 0.000001 + 50.0 * 0.0;

        assert!((cost - expected).abs() < f64::EPSILON);
    }

    #[test]
    fn calculate_cost_request_works() {
        let service = PricingService::new();
        let mut configs = HashMap::new();
        configs.insert(
            "test-model".to_string(),
            create_simple_model_config("0.000001", "0.000002"),
        );

        let request = CalculateCostRequest {
            model_id: "test-model".to_string(),
            usage: TokenUsage {
                input_tokens: 1000,
                output_tokens: 500,
                cached_input_tokens: None,
                cache_creation_input_tokens: None,
            },
            model_configs: configs,
        };

        let result = service.calculate_cost_request(request).unwrap();
        let expected = 1000.0 * 0.000001 + 500.0 * 0.000002;

        assert!((result.cost - expected).abs() < f64::EPSILON);
    }

    #[test]
    fn handles_very_large_token_counts() {
        let service = PricingService::new();
        let mut configs = HashMap::new();
        configs.insert(
            "large-model".to_string(),
            create_simple_model_config("0.00000001", "0.00000002"),
        );

        let usage = TokenUsage {
            input_tokens: 1_000_000,
            output_tokens: 500_000,
            cached_input_tokens: Some(100_000),
            cache_creation_input_tokens: Some(50_000),
        };

        let cost = service
            .calculate_cost("large-model", &usage, &configs)
            .unwrap();

        let expected = 850_000.0 * 0.00000001
            + 100_000.0 * 0.00000001
            + 50_000.0 * 0.00000001
            + 500_000.0 * 0.00000002;

        assert!((cost - expected).abs() < f64::EPSILON * 1_000_000.0);
    }
}
