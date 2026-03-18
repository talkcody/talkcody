//! Cron utilities: compute next_run_at for all schedule kinds, with jitter and previews.

use crate::scheduler::types::{ScheduledTaskExecutionPolicy, ScheduledTaskSchedule};
use chrono::{DateTime, TimeZone, Utc};
use chrono_tz::Tz;
use cron::Schedule;
use serde::{Deserialize, Serialize};
use std::str::FromStr;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronPreviewEntry {
    pub raw_at: i64,
    pub jittered_at: i64,
    pub jitter_ms: i64,
}

pub fn now_unix_ms() -> i64 {
    Utc::now().timestamp_millis()
}

pub fn compute_next_run_at(
    schedule: &ScheduledTaskSchedule,
    exec_policy: &ScheduledTaskExecutionPolicy,
    after_ms: i64,
    job_id: &str,
) -> Result<i64, String> {
    let raw_next = compute_raw_next(schedule, after_ms)?;
    let stagger = effective_stagger_ms(schedule, exec_policy, job_id);
    Ok(raw_next + stagger)
}

pub fn preview_schedule(
    schedule: &ScheduledTaskSchedule,
    exec_policy: &ScheduledTaskExecutionPolicy,
    from_ms: i64,
    count: usize,
    job_id: &str,
) -> Result<Vec<CronPreviewEntry>, String> {
    let mut entries = Vec::new();
    let mut cursor = from_ms;
    for _ in 0..count {
        let raw = compute_raw_next(schedule, cursor)?;
        let jitter = effective_stagger_ms(schedule, exec_policy, job_id);
        let jittered = raw + jitter;
        entries.push(CronPreviewEntry {
            raw_at: raw,
            jittered_at: jittered,
            jitter_ms: jitter,
        });
        cursor = raw + 1;
    }
    Ok(entries)
}

fn compute_raw_next(schedule: &ScheduledTaskSchedule, after_ms: i64) -> Result<i64, String> {
    match schedule {
        ScheduledTaskSchedule::At { at } => {
            let dt = DateTime::parse_from_rfc3339(at)
                .map_err(|e| format!("Invalid 'at' datetime '{}': {}", at, e))?;
            Ok(dt.timestamp_millis())
        }
        ScheduledTaskSchedule::Every { every_ms } => {
            if *every_ms <= 0 {
                return Err(format!("everyMs must be positive, got {}", every_ms));
            }
            Ok(after_ms + every_ms)
        }
        ScheduledTaskSchedule::Cron { expr, tz } => {
            let tz_str = tz.as_deref().unwrap_or("UTC");
            let timezone: Tz = tz_str
                .parse()
                .map_err(|_| format!("Invalid IANA timezone: '{}'", tz_str))?;
            let cron_schedule = parse_cron_schedule(expr)?;
            let after_dt: DateTime<Tz> = timezone
                .timestamp_millis_opt(after_ms)
                .single()
                .ok_or_else(|| format!("Invalid timestamp: {}", after_ms))?;
            let next = cron_schedule
                .after(&after_dt)
                .next()
                .ok_or_else(|| format!("No future occurrences for cron expression '{}'", expr))?;
            Ok(next.timestamp_millis())
        }
    }
}

fn parse_cron_schedule(expr: &str) -> Result<Schedule, String> {
    let normalized = normalize_cron_expr(expr);
    Schedule::from_str(&normalized)
        .map_err(|e| format!("Invalid cron expression '{}': {}", expr, e))
}

fn normalize_cron_expr(expr: &str) -> String {
    let trimmed = expr.trim();
    match trimmed.split_whitespace().count() {
        5 => format!("0 {trimmed}"),
        _ => trimmed.to_string(),
    }
}

pub fn validate_cron_expr(expr: &str) -> Result<(), String> {
    parse_cron_schedule(expr).map(|_| ())
}

pub fn validate_timezone(tz: &str) -> Result<(), String> {
    tz.parse::<Tz>()
        .map(|_| ())
        .map_err(|_| format!("Invalid IANA timezone: '{}'", tz))
}

fn effective_stagger_ms(
    schedule: &ScheduledTaskSchedule,
    exec_policy: &ScheduledTaskExecutionPolicy,
    job_id: &str,
) -> i64 {
    match exec_policy.stagger_ms {
        0 => return 0,
        ms if ms > 0 => return deterministic_jitter(job_id, ms),
        _ => {}
    }

    if let ScheduledTaskSchedule::Cron { expr, .. } = schedule {
        if is_top_of_hour_cron(expr) {
            return deterministic_jitter(job_id, 120_000);
        }
    }

    0
}

pub fn deterministic_jitter(job_id: &str, max_ms: i64) -> i64 {
    if max_ms <= 0 {
        return 0;
    }
    let hash: u64 = job_id.bytes().fold(14_695_981_039_346_656_037u64, |h, b| {
        h.wrapping_mul(1_099_511_628_211).wrapping_add(b as u64)
    });
    (hash % max_ms as u64) as i64
}

fn is_top_of_hour_cron(expr: &str) -> bool {
    expr.split_whitespace()
        .next()
        .map(|m| m == "0")
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scheduler::types::{ScheduledTaskExecutionPolicy, ScheduledTaskSchedule};

    fn default_policy() -> ScheduledTaskExecutionPolicy {
        ScheduledTaskExecutionPolicy::default()
    }

    #[test]
    fn test_preview_entries() {
        let schedule = ScheduledTaskSchedule::Cron {
            expr: "0 * * * *".to_string(),
            tz: Some("UTC".to_string()),
        };
        let entries =
            preview_schedule(&schedule, &default_policy(), now_unix_ms(), 3, "job1").unwrap();
        assert_eq!(entries.len(), 3);
        assert!(entries[0].jittered_at >= entries[0].raw_at);
    }

    #[test]
    fn test_validate_cron_expr_accepts_five_fields() {
        assert!(validate_cron_expr("0 * * * *").is_ok());
        assert!(validate_cron_expr("*/15 * * * *").is_ok());
    }
}
