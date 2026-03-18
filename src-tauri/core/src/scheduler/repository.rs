//! Repository: SQLite CRUD for `scheduled_tasks` and `scheduled_task_runs`.

use crate::database::Database;
use crate::scheduler::types::{
    JobStatus, RunStatus, RunTriggerSource, ScheduledTask, ScheduledTaskDeliveryPolicy,
    ScheduledTaskExecutionPolicy, ScheduledTaskNotificationPolicy, ScheduledTaskOfflinePolicy,
    ScheduledTaskPayload, ScheduledTaskRetryPolicy, ScheduledTaskRun, ScheduledTaskSchedule,
};
use std::str::FromStr;
use std::sync::Arc;

pub struct ScheduledTaskRepository {
    db: Arc<Database>,
}

impl ScheduledTaskRepository {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    pub async fn create(&self, task: &ScheduledTask) -> Result<(), String> {
        let (kind, at, every_ms, cron_expr, tz) = schedule_to_columns(&task.schedule);
        let retry_json =
            serde_json::to_string(&task.retry_policy.backoff_ms).map_err(|e| e.to_string())?;
        let notification_json =
            serde_json::to_string(&task.notification_policy).map_err(|e| e.to_string())?;
        let delivery_json =
            serde_json::to_string(&task.delivery_policy).map_err(|e| e.to_string())?;
        let offline_json =
            serde_json::to_string(&task.offline_policy).map_err(|e| e.to_string())?;

        self.db
            .execute(
                r#"INSERT INTO scheduled_tasks (
                    id, name, description, project_id,
                    schedule_kind, schedule_at, schedule_every_ms, schedule_cron_expr, schedule_tz,
                    schedule_nl_text,
                    payload_message, payload_model, payload_auto_approve_edits, payload_auto_approve_plan,
                    exec_max_concurrent_runs, exec_catch_up, exec_stagger_ms,
                    retry_max_attempts, retry_backoff_ms,
                    notification_policy_json, delivery_policy_json, offline_policy_json,
                    status, next_run_at, last_run_at, created_at, updated_at
                ) VALUES (
                    ?,?,?,?,
                    ?,?,?,?,?,
                    ?,
                    ?,?,?,?,
                    ?,?,?,
                    ?,?,
                    ?,?, ?,
                    ?,?,?,?,?
                )"#,
                vec![
                    serde_json::json!(task.id),
                    serde_json::json!(task.name),
                    serde_json::json!(task.description),
                    serde_json::json!(task.project_id),
                    serde_json::json!(kind),
                    serde_json::json!(at),
                    serde_json::json!(every_ms),
                    serde_json::json!(cron_expr),
                    serde_json::json!(tz),
                    serde_json::json!(task.schedule_nl_text),
                    serde_json::json!(task.payload.message),
                    serde_json::json!(task.payload.model),
                    serde_json::json!(task.payload.auto_approve_edits as i64),
                    serde_json::json!(task.payload.auto_approve_plan as i64),
                    serde_json::json!(task.execution_policy.max_concurrent_runs),
                    serde_json::json!(task.execution_policy.catch_up as i64),
                    serde_json::json!(task.execution_policy.stagger_ms),
                    serde_json::json!(task.retry_policy.max_attempts),
                    serde_json::json!(retry_json),
                    serde_json::json!(notification_json),
                    serde_json::json!(delivery_json),
                    serde_json::json!(offline_json),
                    serde_json::json!(task.status.as_str()),
                    serde_json::json!(task.next_run_at),
                    serde_json::json!(task.last_run_at),
                    serde_json::json!(task.created_at),
                    serde_json::json!(task.updated_at),
                ],
            )
            .await
            .map(|_| ())
    }

    pub async fn find_by_id(&self, id: &str) -> Result<Option<ScheduledTask>, String> {
        let result = self
            .db
            .query(
                "SELECT * FROM scheduled_tasks WHERE id = ?",
                vec![serde_json::json!(id)],
            )
            .await?;
        result.rows.first().map(row_to_task).transpose()
    }

    pub async fn list(&self, project_id: Option<&str>) -> Result<Vec<ScheduledTask>, String> {
        let result = match project_id {
            Some(pid) => self
                .db
                .query(
                    "SELECT * FROM scheduled_tasks WHERE project_id = ? ORDER BY created_at DESC",
                    vec![serde_json::json!(pid)],
                )
                .await?,
            None => {
                self.db
                    .query(
                        "SELECT * FROM scheduled_tasks ORDER BY created_at DESC",
                        vec![],
                    )
                    .await?
            }
        };
        result.rows.iter().map(row_to_task).collect()
    }

    pub async fn find_due_jobs(&self, now_ms: i64) -> Result<Vec<ScheduledTask>, String> {
        let result = self
            .db
            .query(
                "SELECT * FROM scheduled_tasks WHERE status = 'enabled' AND next_run_at IS NOT NULL AND next_run_at <= ?",
                vec![serde_json::json!(now_ms)],
            )
            .await?;
        result.rows.iter().map(row_to_task).collect()
    }

    pub async fn find_overdue_jobs(&self, now_ms: i64) -> Result<Vec<ScheduledTask>, String> {
        let result = self
            .db
            .query(
                "SELECT * FROM scheduled_tasks WHERE status = 'enabled' AND next_run_at IS NOT NULL AND next_run_at < ?",
                vec![serde_json::json!(now_ms)],
            )
            .await?;
        result.rows.iter().map(row_to_task).collect()
    }

    pub async fn update_next_run(
        &self,
        id: &str,
        next_run_at: Option<i64>,
        last_run_at: Option<i64>,
    ) -> Result<(), String> {
        let now = chrono::Utc::now().timestamp_millis();
        self.db
            .execute(
                "UPDATE scheduled_tasks SET next_run_at = ?, last_run_at = ?, updated_at = ? WHERE id = ?",
                vec![
                    serde_json::json!(next_run_at),
                    serde_json::json!(last_run_at),
                    serde_json::json!(now),
                    serde_json::json!(id),
                ],
            )
            .await
            .map(|_| ())
    }

    pub async fn set_status(&self, id: &str, status: &JobStatus) -> Result<(), String> {
        let now = chrono::Utc::now().timestamp_millis();
        self.db
            .execute(
                "UPDATE scheduled_tasks SET status = ?, updated_at = ? WHERE id = ?",
                vec![
                    serde_json::json!(status.as_str()),
                    serde_json::json!(now),
                    serde_json::json!(id),
                ],
            )
            .await
            .map(|_| ())
    }

    pub async fn update(&self, id: &str, task: &ScheduledTask) -> Result<(), String> {
        let (kind, at, every_ms, cron_expr, tz) = schedule_to_columns(&task.schedule);
        let retry_json =
            serde_json::to_string(&task.retry_policy.backoff_ms).map_err(|e| e.to_string())?;
        let notification_json =
            serde_json::to_string(&task.notification_policy).map_err(|e| e.to_string())?;
        let delivery_json =
            serde_json::to_string(&task.delivery_policy).map_err(|e| e.to_string())?;
        let offline_json =
            serde_json::to_string(&task.offline_policy).map_err(|e| e.to_string())?;

        self.db
            .execute(
                r#"UPDATE scheduled_tasks SET
                    name = ?, description = ?, project_id = ?,
                    schedule_kind = ?, schedule_at = ?, schedule_every_ms = ?,
                    schedule_cron_expr = ?, schedule_tz = ?, schedule_nl_text = ?,
                    payload_message = ?, payload_model = ?,
                    payload_auto_approve_edits = ?, payload_auto_approve_plan = ?,
                    exec_max_concurrent_runs = ?, exec_catch_up = ?, exec_stagger_ms = ?,
                    retry_max_attempts = ?, retry_backoff_ms = ?,
                    notification_policy_json = ?, delivery_policy_json = ?, offline_policy_json = ?,
                    status = ?, next_run_at = ?, updated_at = ?
                WHERE id = ?"#,
                vec![
                    serde_json::json!(task.name),
                    serde_json::json!(task.description),
                    serde_json::json!(task.project_id),
                    serde_json::json!(kind),
                    serde_json::json!(at),
                    serde_json::json!(every_ms),
                    serde_json::json!(cron_expr),
                    serde_json::json!(tz),
                    serde_json::json!(task.schedule_nl_text),
                    serde_json::json!(task.payload.message),
                    serde_json::json!(task.payload.model),
                    serde_json::json!(task.payload.auto_approve_edits as i64),
                    serde_json::json!(task.payload.auto_approve_plan as i64),
                    serde_json::json!(task.execution_policy.max_concurrent_runs),
                    serde_json::json!(task.execution_policy.catch_up as i64),
                    serde_json::json!(task.execution_policy.stagger_ms),
                    serde_json::json!(task.retry_policy.max_attempts),
                    serde_json::json!(retry_json),
                    serde_json::json!(notification_json),
                    serde_json::json!(delivery_json),
                    serde_json::json!(offline_json),
                    serde_json::json!(task.status.as_str()),
                    serde_json::json!(task.next_run_at),
                    serde_json::json!(task.updated_at),
                    serde_json::json!(id),
                ],
            )
            .await
            .map(|_| ())
    }

    pub async fn delete(&self, id: &str) -> Result<(), String> {
        self.db
            .execute(
                "DELETE FROM scheduled_tasks WHERE id = ?",
                vec![serde_json::json!(id)],
            )
            .await
            .map(|_| ())
    }

    pub async fn create_run(&self, run: &ScheduledTaskRun) -> Result<(), String> {
        self.db
            .execute(
                r#"INSERT INTO scheduled_task_runs
                    (id, scheduled_task_id, task_id, status, triggered_at, completed_at, error, attempt, trigger_source, scheduled_for_at, payload_snapshot_json, project_id_snapshot, delivery_status, delivery_error)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
                vec![
                    serde_json::json!(run.id),
                    serde_json::json!(run.scheduled_task_id),
                    serde_json::json!(run.task_id),
                    serde_json::json!(run.status.as_str()),
                    serde_json::json!(run.triggered_at),
                    serde_json::json!(run.completed_at),
                    serde_json::json!(run.error),
                    serde_json::json!(run.attempt),
                    serde_json::json!(run.trigger_source.as_str()),
                    serde_json::json!(run.scheduled_for_at),
                    serde_json::json!(run.payload_snapshot_json),
                    serde_json::json!(run.project_id_snapshot),
                    serde_json::json!(run.delivery_status),
                    serde_json::json!(run.delivery_error),
                ],
            )
            .await
            .map(|_| ())
    }

    pub async fn update_run_complete(
        &self,
        run_id: &str,
        status: &RunStatus,
        task_id: Option<String>,
        error: Option<String>,
        delivery_status: Option<String>,
        delivery_error: Option<String>,
    ) -> Result<(), String> {
        let now = chrono::Utc::now().timestamp_millis();
        self.db
            .execute(
                "UPDATE scheduled_task_runs SET status = ?, task_id = ?, completed_at = ?, error = ?, delivery_status = ?, delivery_error = ? WHERE id = ?",
                vec![
                    serde_json::json!(status.as_str()),
                    serde_json::json!(task_id),
                    serde_json::json!(now),
                    serde_json::json!(error),
                    serde_json::json!(delivery_status),
                    serde_json::json!(delivery_error),
                    serde_json::json!(run_id),
                ],
            )
            .await
            .map(|_| ())
    }

    pub async fn list_runs(
        &self,
        job_id: &str,
        limit: u32,
    ) -> Result<Vec<ScheduledTaskRun>, String> {
        let result = self
            .db
            .query(
                "SELECT * FROM scheduled_task_runs WHERE scheduled_task_id = ? ORDER BY triggered_at DESC LIMIT ?",
                vec![serde_json::json!(job_id), serde_json::json!(limit)],
            )
            .await?;
        result.rows.iter().map(row_to_run).collect()
    }

    pub async fn list_queued_runs(&self) -> Result<Vec<ScheduledTaskRun>, String> {
        let result = self
            .db
            .query(
                "SELECT * FROM scheduled_task_runs WHERE status = 'queued' ORDER BY triggered_at ASC",
                vec![],
            )
            .await?;
        result.rows.iter().map(row_to_run).collect()
    }

    pub async fn mark_run_started(&self, run_id: &str) -> Result<(), String> {
        self.db
            .execute(
                "UPDATE scheduled_task_runs SET status = 'running' WHERE id = ?",
                vec![serde_json::json!(run_id)],
            )
            .await
            .map(|_| ())
    }

    pub async fn find_stale_running_runs(
        &self,
        older_than_ms: i64,
    ) -> Result<Vec<ScheduledTaskRun>, String> {
        let result = self
            .db
            .query(
                "SELECT * FROM scheduled_task_runs WHERE status = 'running' AND triggered_at < ?",
                vec![serde_json::json!(older_than_ms)],
            )
            .await?;
        result.rows.iter().map(row_to_run).collect()
    }

    pub async fn count_running_runs(&self, job_id: &str) -> Result<i64, String> {
        let result = self
            .db
            .query(
                "SELECT COUNT(*) as cnt FROM scheduled_task_runs WHERE scheduled_task_id = ? AND status IN ('running', 'queued')",
                vec![serde_json::json!(job_id)],
            )
            .await?;
        Ok(result
            .rows
            .first()
            .and_then(|r| r.get("cnt"))
            .and_then(|v| v.as_i64())
            .unwrap_or(0))
    }

    pub async fn get_stats_summary(&self) -> Result<serde_json::Value, String> {
        let rows = self
            .db
            .query(
                r#"
                SELECT
                  COUNT(*) as total_runs,
                  SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_runs,
                  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_runs,
                  SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as queued_runs,
                  SUM(CASE WHEN attempt > 1 THEN 1 ELSE 0 END) as retried_runs,
                  SUM(CASE WHEN delivery_status = 'failed' THEN 1 ELSE 0 END) as delivery_failures,
                  AVG(CASE WHEN completed_at IS NOT NULL THEN completed_at - triggered_at END) as avg_duration_ms
                FROM scheduled_task_runs
                "#,
                vec![],
            )
            .await?;
        let row = rows
            .rows
            .first()
            .cloned()
            .unwrap_or_else(|| serde_json::json!({}));
        let total = row.get("total_runs").and_then(|v| v.as_i64()).unwrap_or(0) as f64;
        let completed = row
            .get("completed_runs")
            .and_then(|v| v.as_i64())
            .unwrap_or(0) as f64;
        let success_rate = if total > 0.0 { completed / total } else { 0.0 };
        Ok(serde_json::json!({
            "totalRuns": row.get("total_runs").and_then(|v| v.as_i64()).unwrap_or(0),
            "completedRuns": row.get("completed_runs").and_then(|v| v.as_i64()).unwrap_or(0),
            "failedRuns": row.get("failed_runs").and_then(|v| v.as_i64()).unwrap_or(0),
            "queuedRuns": row.get("queued_runs").and_then(|v| v.as_i64()).unwrap_or(0),
            "retriedRuns": row.get("retried_runs").and_then(|v| v.as_i64()).unwrap_or(0),
            "deliveryFailures": row.get("delivery_failures").and_then(|v| v.as_i64()).unwrap_or(0),
            "avgDurationMs": row.get("avg_duration_ms").and_then(|v| v.as_i64()).unwrap_or(0),
            "successRate": success_rate,
        }))
    }
}

fn row_to_task(row: &serde_json::Value) -> Result<ScheduledTask, String> {
    let kind = row["schedule_kind"].as_str().unwrap_or("cron");
    let schedule = match kind {
        "at" => ScheduledTaskSchedule::At {
            at: row["schedule_at"].as_str().unwrap_or("").to_string(),
        },
        "every" => ScheduledTaskSchedule::Every {
            every_ms: row["schedule_every_ms"].as_i64().unwrap_or(60_000),
        },
        _ => ScheduledTaskSchedule::Cron {
            expr: row["schedule_cron_expr"]
                .as_str()
                .unwrap_or("* * * * *")
                .to_string(),
            tz: row["schedule_tz"].as_str().map(|s| s.to_string()),
        },
    };

    let backoff_ms: Vec<i64> = row["retry_backoff_ms"]
        .as_str()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_else(|| vec![30_000, 60_000]);
    let notification_policy: ScheduledTaskNotificationPolicy = row["notification_policy_json"]
        .as_str()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    let delivery_policy: ScheduledTaskDeliveryPolicy = row["delivery_policy_json"]
        .as_str()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    let offline_policy: ScheduledTaskOfflinePolicy = row["offline_policy_json"]
        .as_str()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();

    Ok(ScheduledTask {
        id: row["id"].as_str().unwrap_or("").to_string(),
        name: row["name"].as_str().unwrap_or("").to_string(),
        description: row["description"].as_str().map(|s| s.to_string()),
        project_id: row["project_id"].as_str().map(|s| s.to_string()),
        schedule,
        schedule_nl_text: row["schedule_nl_text"].as_str().map(|s| s.to_string()),
        payload: ScheduledTaskPayload {
            message: row["payload_message"].as_str().unwrap_or("").to_string(),
            model: row["payload_model"].as_str().map(|s| s.to_string()),
            auto_approve_edits: row["payload_auto_approve_edits"].as_i64().unwrap_or(0) != 0,
            auto_approve_plan: row["payload_auto_approve_plan"].as_i64().unwrap_or(0) != 0,
        },
        execution_policy: ScheduledTaskExecutionPolicy {
            max_concurrent_runs: row["exec_max_concurrent_runs"].as_i64().unwrap_or(1),
            catch_up: row["exec_catch_up"].as_i64().unwrap_or(0) != 0,
            stagger_ms: row["exec_stagger_ms"].as_i64().unwrap_or(-1),
        },
        retry_policy: ScheduledTaskRetryPolicy {
            max_attempts: row["retry_max_attempts"].as_i64().unwrap_or(2) as i32,
            backoff_ms,
        },
        notification_policy,
        delivery_policy,
        offline_policy,
        status: row["status"]
            .as_str()
            .and_then(|s| JobStatus::from_str(s).ok())
            .unwrap_or(JobStatus::Disabled),
        next_run_at: row["next_run_at"].as_i64(),
        last_run_at: row["last_run_at"].as_i64(),
        created_at: row["created_at"].as_i64().unwrap_or(0),
        updated_at: row["updated_at"].as_i64().unwrap_or(0),
    })
}

fn row_to_run(row: &serde_json::Value) -> Result<ScheduledTaskRun, String> {
    Ok(ScheduledTaskRun {
        id: row["id"].as_str().unwrap_or("").to_string(),
        scheduled_task_id: row["scheduled_task_id"].as_str().unwrap_or("").to_string(),
        task_id: row["task_id"].as_str().map(|s| s.to_string()),
        status: row["status"]
            .as_str()
            .and_then(|s| RunStatus::from_str(s).ok())
            .unwrap_or(RunStatus::Failed),
        triggered_at: row["triggered_at"].as_i64().unwrap_or(0),
        completed_at: row["completed_at"].as_i64(),
        error: row["error"].as_str().map(|s| s.to_string()),
        attempt: row["attempt"].as_i64().unwrap_or(1) as i32,
        trigger_source: row["trigger_source"]
            .as_str()
            .and_then(|s| RunTriggerSource::from_str(s).ok())
            .unwrap_or(RunTriggerSource::Schedule),
        scheduled_for_at: row["scheduled_for_at"].as_i64(),
        payload_snapshot_json: row["payload_snapshot_json"].as_str().map(|s| s.to_string()),
        project_id_snapshot: row["project_id_snapshot"].as_str().map(|s| s.to_string()),
        delivery_status: row["delivery_status"].as_str().map(|s| s.to_string()),
        delivery_error: row["delivery_error"].as_str().map(|s| s.to_string()),
    })
}

fn schedule_to_columns(
    schedule: &ScheduledTaskSchedule,
) -> (
    &'static str,
    Option<String>,
    Option<i64>,
    Option<String>,
    Option<String>,
) {
    match schedule {
        ScheduledTaskSchedule::At { at } => ("at", Some(at.clone()), None, None, None),
        ScheduledTaskSchedule::Every { every_ms } => ("every", None, Some(*every_ms), None, None),
        ScheduledTaskSchedule::Cron { expr, tz } => {
            ("cron", None, None, Some(expr.clone()), tz.clone())
        }
    }
}
