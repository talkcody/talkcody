use rusty_s3::{Bucket, Credentials, S3Action, UrlStyle};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;
use url::Url;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct S3BucketConfig {
    pub endpoint: String,
    pub region: String,
    pub bucket: String,
    #[serde(default)]
    pub path_style: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct S3CredentialsInput {
    pub access_key_id: String,
    pub secret_access_key: String,
    #[serde(default)]
    pub session_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct S3PresignRequest {
    pub bucket: S3BucketConfig,
    pub credentials: S3CredentialsInput,
    pub key: String,
    #[serde(default = "default_expires_seconds")]
    pub expires_seconds: u64,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub query: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct S3PresignedRequest {
    pub url: String,
    pub method: String,
    pub headers: HashMap<String, String>,
}

fn default_expires_seconds() -> u64 {
    900
}

fn build_bucket(cfg: &S3BucketConfig) -> Result<Bucket, String> {
    let endpoint =
        Url::parse(&cfg.endpoint).map_err(|e| format!("Invalid S3 endpoint URL: {e}"))?;
    let style = if cfg.path_style {
        UrlStyle::Path
    } else {
        UrlStyle::VirtualHost
    };

    Bucket::new(
        endpoint,
        style,
        cfg.bucket.clone(),
        cfg.region.clone(),
        rusty_s3::BucketSettings::default(),
    )
    .map_err(|e| format!("Failed to create S3 bucket: {e}"))
}

fn build_credentials(input: &S3CredentialsInput) -> Credentials {
    match input.session_token.as_deref() {
        Some(token) => Credentials::new_with_token(
            input.access_key_id.clone(),
            input.secret_access_key.clone(),
            token.to_string(),
        ),
        None => Credentials::new(input.access_key_id.clone(), input.secret_access_key.clone()),
    }
}

fn normalize_headers(headers: &HashMap<String, String>) -> Result<HashMap<String, String>, String> {
    let mut normalized = HashMap::new();
    for (key, value) in headers {
        let header_name = key.trim().to_ascii_lowercase();
        if header_name.is_empty() {
            return Err("S3 presign headers contains an empty header name".to_string());
        }
        if header_name == "host" {
            return Err("S3 presign headers must not include 'host'".to_string());
        }
        normalized.insert(header_name, value.trim().to_string());
    }
    Ok(normalized)
}

fn apply_headers_and_query<'a, A: S3Action<'a>>(
    action: &mut A,
    headers: &HashMap<String, String>,
    query: &HashMap<String, String>,
) {
    for (key, value) in headers {
        action.headers_mut().insert(key.clone(), value.clone());
    }
    for (key, value) in query {
        action.queries_mut().insert(key.clone(), value.clone());
    }
}

fn presign_action<'a, A: S3Action<'a>>(
    action: A,
    method: &'static str,
    expires_seconds: u64,
    headers: HashMap<String, String>,
) -> Result<S3PresignedRequest, String> {
    if expires_seconds == 0 {
        return Err("expiresSeconds must be greater than 0".to_string());
    }

    let url = action
        .sign(Duration::from_secs(expires_seconds))
        .to_string();

    Ok(S3PresignedRequest {
        url,
        method: method.to_string(),
        headers,
    })
}

#[tauri::command]
pub fn s3_presign_get_object(req: S3PresignRequest) -> Result<S3PresignedRequest, String> {
    let bucket = build_bucket(&req.bucket)?;
    let credentials = build_credentials(&req.credentials);
    let key = req.key;
    let headers = normalize_headers(&req.headers)?;

    let mut action = bucket.get_object(Some(&credentials), &key);
    apply_headers_and_query(&mut action, &headers, &req.query);
    presign_action(action, "GET", req.expires_seconds, headers)
}

#[tauri::command]
pub fn s3_presign_put_object(req: S3PresignRequest) -> Result<S3PresignedRequest, String> {
    let bucket = build_bucket(&req.bucket)?;
    let credentials = build_credentials(&req.credentials);
    let key = req.key;
    let headers = normalize_headers(&req.headers)?;

    let mut action = bucket.put_object(Some(&credentials), &key);
    apply_headers_and_query(&mut action, &headers, &req.query);
    presign_action(action, "PUT", req.expires_seconds, headers)
}

#[tauri::command]
pub fn s3_presign_delete_object(req: S3PresignRequest) -> Result<S3PresignedRequest, String> {
    let bucket = build_bucket(&req.bucket)?;
    let credentials = build_credentials(&req.credentials);
    let key = req.key;
    let headers = normalize_headers(&req.headers)?;

    let mut action = bucket.delete_object(Some(&credentials), &key);
    apply_headers_and_query(&mut action, &headers, &req.query);
    presign_action(action, "DELETE", req.expires_seconds, headers)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_request(path_style: bool) -> S3PresignRequest {
        S3PresignRequest {
            bucket: S3BucketConfig {
                endpoint: "https://s3.example.com".to_string(),
                region: "us-east-1".to_string(),
                bucket: "my-bucket".to_string(),
                path_style,
            },
            credentials: S3CredentialsInput {
                access_key_id: "AKIDEXAMPLE".to_string(),
                secret_access_key: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY".to_string(),
                session_token: None,
            },
            key: "folder/file.txt".to_string(),
            expires_seconds: 60,
            headers: HashMap::new(),
            query: HashMap::new(),
        }
    }

    fn assert_presigned_url_has_core_params(url: &str) {
        let parsed = Url::parse(url).expect("valid url");
        let query_pairs: HashMap<String, String> =
            parsed.query_pairs().map(|(k, v)| (k.into(), v.into())).collect();
        for key in [
            "X-Amz-Algorithm",
            "X-Amz-Credential",
            "X-Amz-Date",
            "X-Amz-Expires",
            "X-Amz-SignedHeaders",
            "X-Amz-Signature",
        ] {
            assert!(
                query_pairs.contains_key(key),
                "missing expected presign param: {key}"
            );
        }
    }

    #[test]
    fn presign_get_virtual_host_style() {
        let req = base_request(false);
        let signed = s3_presign_get_object(req).expect("presign ok");

        assert_eq!(signed.method, "GET");
        assert!(signed.url.starts_with("https://my-bucket.s3.example.com/folder/file.txt?"));
        assert_presigned_url_has_core_params(&signed.url);
    }

    #[test]
    fn presign_get_path_style() {
        let req = base_request(true);
        let signed = s3_presign_get_object(req).expect("presign ok");

        assert_eq!(signed.method, "GET");
        assert!(signed
            .url
            .starts_with("https://s3.example.com/my-bucket/folder/file.txt?"));
        assert_presigned_url_has_core_params(&signed.url);
    }

    #[test]
    fn presign_put_includes_custom_headers_in_signed_headers() {
        let mut req = base_request(true);
        req.headers.insert("Content-Type".to_string(), "text/plain".to_string());

        let signed = s3_presign_put_object(req).expect("presign ok");
        assert_eq!(signed.method, "PUT");
        assert_eq!(signed.headers.get("content-type").map(String::as_str), Some("text/plain"));

        let parsed = Url::parse(&signed.url).expect("valid url");
        let query_pairs: HashMap<String, String> =
            parsed.query_pairs().map(|(k, v)| (k.into(), v.into())).collect();
        let signed_headers = query_pairs
            .get("X-Amz-SignedHeaders")
            .expect("signed headers present");

        assert!(
            signed_headers.split(';').any(|h| h == "content-type"),
            "expected content-type in signed headers, got: {signed_headers}"
        );
    }

    #[test]
    fn rejects_host_header_override() {
        let mut req = base_request(true);
        req.headers.insert("Host".to_string(), "evil.example.com".to_string());
        let err = s3_presign_get_object(req).expect_err("should reject host header");
        assert!(err.to_lowercase().contains("host"));
    }
}

