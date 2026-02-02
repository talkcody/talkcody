pub mod provider;
pub mod provider_configs;
pub mod provider_registry;

// New provider implementations
pub mod default_provider;
pub mod github_copilot_provider;
pub mod moonshot_provider;
pub mod openai_provider;

// Re-export key types
pub use default_provider::DefaultProvider;
pub use github_copilot_provider::GithubCopilotProvider;
pub use moonshot_provider::MoonshotProvider;
pub use openai_provider::OpenAiProvider;
pub use provider::{BaseProvider, BuiltRequest, Provider, ProviderContext, ProviderCredentials};
