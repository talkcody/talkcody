use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RemoteChannelId {
    Telegram,
    Feishu,
}

impl RemoteChannelId {
    pub fn as_str(&self) -> &'static str {
        match self {
            RemoteChannelId::Telegram => "telegram",
            RemoteChannelId::Feishu => "feishu",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RemoteAttachmentType {
    Image,
    Audio,
    Voice,
    File,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteAttachment {
    pub id: String,
    pub attachment_type: RemoteAttachmentType,
    pub file_path: String,
    pub filename: String,
    pub mime_type: String,
    pub size: u64,
    pub duration_seconds: Option<u32>,
    pub caption: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInboundMessage {
    pub channel_id: RemoteChannelId,
    pub chat_id: String,
    pub message_id: String,
    pub text: String,
    pub username: Option<String>,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub date: i64,
    pub attachments: Vec<RemoteAttachment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSendMessageRequest {
    pub channel_id: RemoteChannelId,
    pub chat_id: String,
    pub text: String,
    pub reply_to_message_id: Option<String>,
    pub disable_web_page_preview: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSendMessageResponse {
    pub message_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteEditMessageRequest {
    pub channel_id: RemoteChannelId,
    pub chat_id: String,
    pub message_id: String,
    pub text: String,
    pub disable_web_page_preview: Option<bool>,
}
