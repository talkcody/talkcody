// Database module using libsql for Turso integration
use libsql::Builder;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

#[derive(Debug, Serialize, Deserialize)]
pub struct QueryResult {
    pub rows: Vec<serde_json::Value>,
    pub rows_affected: u64,
}

pub struct Database {
    conn: Arc<Mutex<Option<libsql::Connection>>>,
    db_path: String,
}

impl Database {
    pub fn new(db_path: String) -> Self {
        Self {
            conn: Arc::new(Mutex::new(None)),
            db_path,
        }
    }

    pub async fn connect(&self) -> Result<(), String> {
        // Ensure the parent directory exists before attempting to open the database
        let db_path = Path::new(&self.db_path);
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create database directory '{}': {}. Please check directory permissions.", parent.display(), e))?;
        }

        let db = Builder::new_local(&self.db_path)
            .build()
            .await
            .map_err(|e| format!("Failed to build database: {}", e))?;

        let conn = db
            .connect()
            .map_err(|e| format!("Failed to connect to database: {}", e))?;

        let mut lock = self.conn.lock().await;
        *lock = Some(conn);

        // Enable WAL mode for better concurrent access
        drop(lock);
        self.execute("PRAGMA journal_mode=WAL", vec![]).await?;

        // Set busy timeout to 5 seconds (5000 milliseconds)
        self.execute("PRAGMA busy_timeout=5000", vec![]).await?;

        Ok(())
    }

    pub async fn execute(
        &self,
        sql: &str,
        params: Vec<serde_json::Value>,
    ) -> Result<QueryResult, String> {
        self.execute_with_retry(sql, params, 3).await
    }

    /// Execute a multi-statement SQL script without parameters.
    ///
    /// This is required for migrations because libsql `execute()` only runs a
    /// single statement, while migration files often contain multiple DDL lines.
    pub async fn execute_batch(&self, sql: &str) -> Result<(), String> {
        let lock = self.conn.lock().await;
        let conn = lock.as_ref().ok_or("Database not connected")?;
        conn.execute_batch(sql)
            .await
            .map_err(|e| format!("Execute batch error: {}", e))?;
        Ok(())
    }

    async fn execute_with_retry(
        &self,
        sql: &str,
        params: Vec<serde_json::Value>,
        max_retries: u32,
    ) -> Result<QueryResult, String> {
        let mut attempt = 0;

        loop {
            let lock = self.conn.lock().await;
            let conn = lock.as_ref().ok_or("Database not connected")?;

            // Convert JSON values to libsql Values
            let libsql_params: Vec<libsql::Value> =
                params.iter().map(json_to_libsql_value).collect();

            // Check if this is a SELECT query - if so, use query() instead
            let sql_trimmed = sql.trim_start().to_uppercase();
            let result = if sql_trimmed.starts_with("SELECT") || sql_trimmed.starts_with("PRAGMA") {
                // This is a query that returns rows, use query() instead
                let stmt = match conn.prepare(sql).await {
                    Ok(stmt) => stmt,
                    Err(e) => {
                        let error_msg = format!("Prepare error: {}", e);
                        if Self::is_busy_error(&error_msg) && attempt < max_retries {
                            drop(lock);
                            attempt += 1;
                            tokio::time::sleep(tokio::time::Duration::from_millis(
                                10 * attempt as u64,
                            ))
                            .await;
                            continue;
                        }
                        return Err(error_msg);
                    }
                };

                let mut rows_result = match stmt.query(libsql_params).await {
                    Ok(rows) => rows,
                    Err(e) => {
                        let error_msg = format!("Query error: {}", e);
                        if Self::is_busy_error(&error_msg) && attempt < max_retries {
                            drop(lock);
                            attempt += 1;
                            tokio::time::sleep(tokio::time::Duration::from_millis(
                                10 * attempt as u64,
                            ))
                            .await;
                            continue;
                        }
                        return Err(error_msg);
                    }
                };

                let mut rows = Vec::new();

                while let Some(row) = rows_result
                    .next()
                    .await
                    .map_err(|e| format!("Row fetch error: {}", e))?
                {
                    let mut row_obj = serde_json::Map::new();
                    let column_count = row.column_count();

                    for i in 0..column_count {
                        let value = row
                            .get_value(i)
                            .map_err(|e| format!("Get value error: {}", e))?;
                        let column_name = row
                            .column_name(i)
                            .unwrap_or(&format!("column_{}", i))
                            .to_string();
                        row_obj.insert(column_name, libsql_value_to_json(&value));
                    }

                    rows.push(serde_json::Value::Object(row_obj));
                }

                Ok(QueryResult {
                    rows,
                    rows_affected: 0,
                })
            } else {
                // This is an INSERT/UPDATE/DELETE/CREATE, use execute()
                match conn.execute(sql, libsql_params).await {
                    Ok(rows_affected) => Ok(QueryResult {
                        rows: vec![],
                        rows_affected,
                    }),
                    Err(e) => {
                        let error_msg = format!("Execute error: {}", e);
                        if Self::is_busy_error(&error_msg) && attempt < max_retries {
                            drop(lock);
                            attempt += 1;
                            tokio::time::sleep(tokio::time::Duration::from_millis(
                                10 * attempt as u64,
                            ))
                            .await;
                            continue;
                        }
                        Err(error_msg)
                    }
                }
            };

            return result;
        }
    }

    fn is_busy_error(error_msg: &str) -> bool {
        error_msg.contains("database is locked") || error_msg.contains("SQLITE_BUSY")
    }

    pub async fn query(
        &self,
        sql: &str,
        params: Vec<serde_json::Value>,
    ) -> Result<QueryResult, String> {
        let lock = self.conn.lock().await;
        let conn = lock.as_ref().ok_or("Database not connected")?;

        // Convert JSON values to libsql Values
        let libsql_params: Vec<libsql::Value> = params.iter().map(json_to_libsql_value).collect();

        let stmt = conn
            .prepare(sql)
            .await
            .map_err(|e| format!("Prepare error: {}", e))?;

        let mut rows_result = stmt
            .query(libsql_params)
            .await
            .map_err(|e| format!("Query error: {}", e))?;

        let mut rows = Vec::new();

        while let Some(row) = rows_result
            .next()
            .await
            .map_err(|e| format!("Row fetch error: {}", e))?
        {
            let mut row_obj = serde_json::Map::new();

            // Get column count
            let column_count = row.column_count();

            for i in 0..column_count {
                let value = row
                    .get_value(i)
                    .map_err(|e| format!("Get value error: {}", e))?;
                let column_name = row
                    .column_name(i)
                    .unwrap_or(&format!("column_{}", i))
                    .to_string();

                row_obj.insert(column_name, libsql_value_to_json(&value));
            }

            rows.push(serde_json::Value::Object(row_obj));
        }

        Ok(QueryResult {
            rows,
            rows_affected: 0,
        })
    }

    pub async fn batch(
        &self,
        statements: Vec<(String, Vec<serde_json::Value>)>,
    ) -> Result<Vec<QueryResult>, String> {
        let mut results = Vec::new();

        for (sql, params) in statements {
            let result = self.execute(&sql, params).await?;
            results.push(result);
        }

        Ok(results)
    }

    /// Close the database connection gracefully
    /// This should be called when the application exits to release file handles
    #[allow(dead_code)]
    pub async fn close(&self) -> Result<(), String> {
        let lock = self.conn.lock().await;
        if lock.is_some() {
            // Run PRAGMA optimize before closing (SQLite best practice)
            drop(lock);
            let _ = self.execute("PRAGMA optimize", vec![]).await;

            // Now set connection to None to release it
            let mut lock = self.conn.lock().await;
            *lock = None;
            log::info!("Database connection closed successfully");
        }
        Ok(())
    }

    /// Synchronous close for use in Drop or sync contexts
    pub fn close_sync(&self) {
        // Try to acquire lock and clear connection
        // This is a best-effort cleanup in sync context
        if let Ok(rt) = tokio::runtime::Runtime::new() {
            let conn = self.conn.clone();
            rt.block_on(async move {
                let mut lock = conn.lock().await;
                *lock = None;
                log::info!("Database connection closed (sync)");
            });
        }
    }
}

// Convert serde_json::Value to libsql::Value
fn json_to_libsql_value(v: &serde_json::Value) -> libsql::Value {
    match v {
        serde_json::Value::Null => libsql::Value::Null,
        serde_json::Value::Bool(b) => libsql::Value::Integer(if *b { 1 } else { 0 }),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                libsql::Value::Integer(i)
            } else if let Some(f) = n.as_f64() {
                libsql::Value::Real(f)
            } else {
                libsql::Value::Null
            }
        }
        serde_json::Value::String(s) => libsql::Value::Text(s.clone()),
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => {
            // Convert complex types to JSON string
            libsql::Value::Text(v.to_string())
        }
    }
}

// Convert libsql::Value to serde_json::Value
fn libsql_value_to_json(v: &libsql::Value) -> serde_json::Value {
    match v {
        libsql::Value::Null => serde_json::Value::Null,
        libsql::Value::Integer(i) => serde_json::Value::Number((*i).into()),
        libsql::Value::Real(f) => serde_json::Number::from_f64(*f)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        libsql::Value::Text(s) => serde_json::Value::String(s.clone()),
        libsql::Value::Blob(b) => serde_json::Value::String(base64_encode(b)),
    }
}

fn base64_encode(data: &[u8]) -> String {
    use std::io::Write;
    let mut buf = Vec::new();
    {
        let mut encoder =
            base64::write::EncoderWriter::new(&mut buf, &base64::engine::general_purpose::STANDARD);
        encoder.write_all(data).unwrap();
    }
    String::from_utf8(buf).unwrap()
}

// Tauri commands
#[tauri::command]
pub async fn db_connect(db: State<'_, Arc<Database>>) -> Result<(), String> {
    db.connect().await
}

#[tauri::command]
pub async fn db_execute(
    db: State<'_, Arc<Database>>,
    sql: String,
    params: Vec<serde_json::Value>,
) -> Result<QueryResult, String> {
    db.execute(&sql, params).await
}

#[tauri::command]
pub async fn db_query(
    db: State<'_, Arc<Database>>,
    sql: String,
    params: Vec<serde_json::Value>,
) -> Result<QueryResult, String> {
    db.query(&sql, params).await
}

#[tauri::command]
pub async fn db_batch(
    db: State<'_, Arc<Database>>,
    statements: Vec<(String, Vec<serde_json::Value>)>,
) -> Result<Vec<QueryResult>, String> {
    db.batch(statements).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn test_database_creates_parent_directory() {
        // Test case for bug fix: SQLite error 14 (CANTOPEN)
        // This test ensures that the database connection creates parent directories
        // when they don't exist, preventing the error users experienced.

        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir
            .path()
            .join("nested")
            .join("subdirectory")
            .join("test.db");

        // Verify parent directory does not exist initially
        assert!(!db_path.parent().unwrap().exists());

        // Create database instance and connect
        let database = Database::new(db_path.to_string_lossy().to_string());
        let result = database.connect().await;

        // Verify connection succeeds
        assert!(
            result.is_ok(),
            "Database connection should succeed: {:?}",
            result
        );

        // Verify parent directory was created
        assert!(
            db_path.parent().unwrap().exists(),
            "Parent directory should be created"
        );

        // Verify database file was created
        assert!(db_path.exists(), "Database file should be created");
    }

    #[tokio::test]
    async fn test_database_works_when_parent_directory_exists() {
        // Test that database connection still works when parent directory already exists

        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");

        // Parent directory already exists (temp_dir)
        assert!(db_path.parent().unwrap().exists());

        // Create database instance and connect
        let database = Database::new(db_path.to_string_lossy().to_string());
        let result = database.connect().await;

        // Verify connection succeeds
        assert!(
            result.is_ok(),
            "Database connection should succeed: {:?}",
            result
        );

        // Verify database file was created
        assert!(db_path.exists(), "Database file should be created");
    }

    #[tokio::test]
    async fn test_database_operations_after_directory_creation() {
        // Test that database operations work correctly after directory creation

        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("subdir").join("test.db");

        // Create database and connect
        let database = Database::new(db_path.to_string_lossy().to_string());
        database.connect().await.expect("Failed to connect");

        // Test CREATE TABLE operation
        let create_result = database
            .execute(
                "CREATE TABLE IF NOT EXISTS test (id INTEGER PRIMARY KEY, name TEXT)",
                vec![],
            )
            .await;
        assert!(
            create_result.is_ok(),
            "CREATE TABLE should succeed: {:?}",
            create_result
        );

        // Test INSERT operation
        let insert_result = database
            .execute(
                "INSERT INTO test (id, name) VALUES (?, ?)",
                vec![
                    serde_json::Value::Number(1.into()),
                    serde_json::Value::String("test".to_string()),
                ],
            )
            .await;
        assert!(
            insert_result.is_ok(),
            "INSERT should succeed: {:?}",
            insert_result
        );
        assert_eq!(
            insert_result.unwrap().rows_affected,
            1,
            "Should insert 1 row"
        );

        // Test SELECT operation
        let query_result = database
            .query(
                "SELECT * FROM test WHERE id = ?",
                vec![serde_json::Value::Number(1.into())],
            )
            .await;
        assert!(
            query_result.is_ok(),
            "SELECT should succeed: {:?}",
            query_result
        );

        let rows = query_result.unwrap().rows;
        assert_eq!(rows.len(), 1, "Should return 1 row");

        // Verify the data
        let row = &rows[0];
        assert_eq!(row["id"], serde_json::Value::Number(1.into()));
        assert_eq!(row["name"], serde_json::Value::String("test".to_string()));
    }

    #[tokio::test]
    async fn test_database_deeply_nested_directory() {
        // Test with a deeply nested directory structure similar to macOS Application Support
        // This simulates the actual user scenario: /Users/username/Library/Application Support/com.talkcody/

        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir
            .path()
            .join("Library")
            .join("Application Support")
            .join("com.talkcody")
            .join("talkcody.db");

        // Verify none of the nested directories exist
        assert!(!db_path.parent().unwrap().exists());

        // Create database instance and connect
        let database = Database::new(db_path.to_string_lossy().to_string());
        let result = database.connect().await;

        // Verify connection succeeds
        assert!(
            result.is_ok(),
            "Database connection should succeed for deeply nested path: {:?}",
            result
        );

        // Verify all parent directories were created
        assert!(temp_dir.path().join("Library").exists());
        assert!(temp_dir
            .path()
            .join("Library")
            .join("Application Support")
            .exists());
        assert!(temp_dir
            .path()
            .join("Library")
            .join("Application Support")
            .join("com.talkcody")
            .exists());

        // Verify database file was created
        assert!(db_path.exists(), "Database file should be created");
    }

    #[tokio::test]
    async fn test_database_multiple_connections() {
        // Test that multiple connect() calls work correctly (idempotent behavior)

        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("subdir").join("test.db");

        let database = Database::new(db_path.to_string_lossy().to_string());

        // First connection
        let result1 = database.connect().await;
        assert!(result1.is_ok(), "First connection should succeed");

        // Second connection (should still work)
        let result2 = database.connect().await;
        assert!(result2.is_ok(), "Second connection should succeed");

        // Verify directory and file still exist
        assert!(db_path.parent().unwrap().exists());
        assert!(db_path.exists());
    }

    #[tokio::test]
    async fn test_batch_operations() {
        // Test batch SQL operations

        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("batch_test.db");

        let database = Database::new(db_path.to_string_lossy().to_string());
        database.connect().await.expect("Failed to connect");

        // Create table first
        database
            .execute(
                "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)",
                vec![],
            )
            .await
            .expect("Failed to create table");

        // Execute batch insert operations
        let statements = vec![
            (
                "INSERT INTO users (id, name, age) VALUES (?, ?, ?)".to_string(),
                vec![
                    serde_json::Value::Number(1.into()),
                    serde_json::Value::String("Alice".to_string()),
                    serde_json::Value::Number(25.into()),
                ],
            ),
            (
                "INSERT INTO users (id, name, age) VALUES (?, ?, ?)".to_string(),
                vec![
                    serde_json::Value::Number(2.into()),
                    serde_json::Value::String("Bob".to_string()),
                    serde_json::Value::Number(30.into()),
                ],
            ),
            (
                "INSERT INTO users (id, name, age) VALUES (?, ?, ?)".to_string(),
                vec![
                    serde_json::Value::Number(3.into()),
                    serde_json::Value::String("Charlie".to_string()),
                    serde_json::Value::Number(35.into()),
                ],
            ),
        ];

        let results = database.batch(statements).await;
        assert!(
            results.is_ok(),
            "Batch operation should succeed: {:?}",
            results
        );

        let results = results.unwrap();
        assert_eq!(results.len(), 3, "Should have 3 results");
        for result in &results {
            assert_eq!(result.rows_affected, 1, "Each insert should affect 1 row");
        }

        // Verify all rows were inserted
        let query_result = database
            .query("SELECT COUNT(*) as count FROM users", vec![])
            .await;
        assert!(query_result.is_ok());
        let count = &query_result.unwrap().rows[0]["count"];
        assert_eq!(count, &serde_json::Value::Number(3.into()));
    }

    #[tokio::test]
    async fn test_query_with_multiple_rows() {
        // Test query returning multiple rows

        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("query_test.db");

        let database = Database::new(db_path.to_string_lossy().to_string());
        database.connect().await.expect("Failed to connect");

        // Setup: create table and insert data
        database
            .execute(
                "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, price REAL)",
                vec![],
            )
            .await
            .unwrap();

        database.execute(
            "INSERT INTO items (id, name, price) VALUES (1, 'Apple', 1.5), (2, 'Banana', 0.75), (3, 'Orange', 2.0)",
            vec![]
        ).await.unwrap();

        // Query all items
        let result = database
            .query("SELECT * FROM items ORDER BY id", vec![])
            .await;
        assert!(result.is_ok());

        let rows = result.unwrap().rows;
        assert_eq!(rows.len(), 3);

        assert_eq!(
            rows[0]["name"],
            serde_json::Value::String("Apple".to_string())
        );
        assert_eq!(
            rows[1]["name"],
            serde_json::Value::String("Banana".to_string())
        );
        assert_eq!(
            rows[2]["name"],
            serde_json::Value::String("Orange".to_string())
        );
    }

    #[tokio::test]
    async fn test_update_and_delete_operations() {
        // Test UPDATE and DELETE SQL operations

        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("update_delete_test.db");

        let database = Database::new(db_path.to_string_lossy().to_string());
        database.connect().await.expect("Failed to connect");

        // Setup
        database
            .execute(
                "CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, stock INTEGER)",
                vec![],
            )
            .await
            .unwrap();

        database
            .execute(
                "INSERT INTO products (id, name, stock) VALUES (1, 'Widget', 100)",
                vec![],
            )
            .await
            .unwrap();

        // Test UPDATE
        let update_result = database
            .execute(
                "UPDATE products SET stock = ? WHERE id = ?",
                vec![
                    serde_json::Value::Number(50.into()),
                    serde_json::Value::Number(1.into()),
                ],
            )
            .await;
        assert!(update_result.is_ok());
        assert_eq!(update_result.unwrap().rows_affected, 1);

        // Verify update
        let query_result = database
            .query("SELECT stock FROM products WHERE id = 1", vec![])
            .await
            .unwrap();
        assert_eq!(
            query_result.rows[0]["stock"],
            serde_json::Value::Number(50.into())
        );

        // Test DELETE
        let delete_result = database
            .execute(
                "DELETE FROM products WHERE id = ?",
                vec![serde_json::Value::Number(1.into())],
            )
            .await;
        assert!(delete_result.is_ok());
        assert_eq!(delete_result.unwrap().rows_affected, 1);

        // Verify delete
        let query_result = database
            .query("SELECT * FROM products", vec![])
            .await
            .unwrap();
        assert_eq!(query_result.rows.len(), 0);
    }

    #[tokio::test]
    async fn test_null_value_handling() {
        // Test handling of NULL values

        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("null_test.db");

        let database = Database::new(db_path.to_string_lossy().to_string());
        database.connect().await.expect("Failed to connect");

        database
            .execute(
                "CREATE TABLE nullable (id INTEGER PRIMARY KEY, value TEXT)",
                vec![],
            )
            .await
            .unwrap();

        // Insert NULL value
        database
            .execute(
                "INSERT INTO nullable (id, value) VALUES (?, ?)",
                vec![serde_json::Value::Number(1.into()), serde_json::Value::Null],
            )
            .await
            .unwrap();

        // Query and verify NULL is returned
        let result = database
            .query("SELECT * FROM nullable WHERE id = 1", vec![])
            .await
            .unwrap();
        assert_eq!(result.rows[0]["value"], serde_json::Value::Null);
    }

    #[tokio::test]
    async fn test_boolean_value_conversion() {
        // Test boolean to integer conversion (SQLite doesn't have native boolean)

        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("bool_test.db");

        let database = Database::new(db_path.to_string_lossy().to_string());
        database.connect().await.expect("Failed to connect");

        database
            .execute(
                "CREATE TABLE flags (id INTEGER PRIMARY KEY, active INTEGER)",
                vec![],
            )
            .await
            .unwrap();

        // Insert boolean true (should convert to 1)
        database
            .execute(
                "INSERT INTO flags (id, active) VALUES (?, ?)",
                vec![
                    serde_json::Value::Number(1.into()),
                    serde_json::Value::Bool(true),
                ],
            )
            .await
            .unwrap();

        // Insert boolean false (should convert to 0)
        database
            .execute(
                "INSERT INTO flags (id, active) VALUES (?, ?)",
                vec![
                    serde_json::Value::Number(2.into()),
                    serde_json::Value::Bool(false),
                ],
            )
            .await
            .unwrap();

        // Query and verify conversion
        let result = database
            .query("SELECT * FROM flags ORDER BY id", vec![])
            .await
            .unwrap();
        assert_eq!(
            result.rows[0]["active"],
            serde_json::Value::Number(1.into())
        );
        assert_eq!(
            result.rows[1]["active"],
            serde_json::Value::Number(0.into())
        );
    }

    #[tokio::test]
    async fn test_execute_before_connect_fails() {
        // Test that operations fail gracefully when database is not connected

        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("not_connected.db");

        let database = Database::new(db_path.to_string_lossy().to_string());
        // Note: NOT calling connect()

        let result = database.execute("SELECT 1", vec![]).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not connected"));
    }

    #[test]
    fn test_json_to_libsql_value_conversion() {
        // Test JSON to libsql value conversion

        // Test null
        let null_val = json_to_libsql_value(&serde_json::Value::Null);
        assert!(matches!(null_val, libsql::Value::Null));

        // Test boolean
        let bool_true = json_to_libsql_value(&serde_json::Value::Bool(true));
        assert!(matches!(bool_true, libsql::Value::Integer(1)));

        let bool_false = json_to_libsql_value(&serde_json::Value::Bool(false));
        assert!(matches!(bool_false, libsql::Value::Integer(0)));

        // Test integer
        let int_val = json_to_libsql_value(&serde_json::Value::Number(42.into()));
        assert!(matches!(int_val, libsql::Value::Integer(42)));

        // Test float
        let float_val = json_to_libsql_value(&serde_json::json!(3.14));
        if let libsql::Value::Real(f) = float_val {
            assert!((f - 3.14).abs() < 0.001);
        } else {
            panic!("Expected Real value");
        }

        // Test string
        let str_val = json_to_libsql_value(&serde_json::Value::String("hello".to_string()));
        assert!(matches!(str_val, libsql::Value::Text(s) if s == "hello"));

        // Test array (should be converted to JSON string)
        let arr_val = json_to_libsql_value(&serde_json::json!([1, 2, 3]));
        assert!(matches!(arr_val, libsql::Value::Text(_)));

        // Test object (should be converted to JSON string)
        let obj_val = json_to_libsql_value(&serde_json::json!({"key": "value"}));
        assert!(matches!(obj_val, libsql::Value::Text(_)));
    }

    #[test]
    fn test_is_busy_error() {
        assert!(Database::is_busy_error("database is locked"));
        assert!(Database::is_busy_error("Error: SQLITE_BUSY"));
        assert!(!Database::is_busy_error("some other error"));
        assert!(!Database::is_busy_error(""));
    }

    #[tokio::test]
    async fn test_database_close_releases_connection() {
        // Test that close() properly releases the database connection
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("close_test.db");

        let database = Database::new(db_path.to_string_lossy().to_string());
        database.connect().await.expect("Failed to connect");

        // Verify connection works before close
        let result = database.execute("SELECT 1 as test", vec![]).await;
        assert!(result.is_ok(), "Should be able to execute before close");

        // Close the connection
        let close_result = database.close().await;
        assert!(close_result.is_ok(), "Close should succeed");

        // After close, operations should fail
        let result_after_close = database.execute("SELECT 1 as test", vec![]).await;
        assert!(result_after_close.is_err(), "Should fail after close");
        assert!(result_after_close.unwrap_err().contains("not connected"));
    }

    #[tokio::test]
    async fn test_database_close_is_idempotent() {
        // Test that calling close() multiple times doesn't cause issues
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("close_idempotent_test.db");

        let database = Database::new(db_path.to_string_lossy().to_string());
        database.connect().await.expect("Failed to connect");

        // Close multiple times - should not panic
        let result1 = database.close().await;
        assert!(result1.is_ok(), "First close should succeed");

        let result2 = database.close().await;
        assert!(result2.is_ok(), "Second close should succeed (no-op)");

        let result3 = database.close().await;
        assert!(result3.is_ok(), "Third close should succeed (no-op)");
    }

    #[tokio::test]
    async fn test_database_close_without_connect() {
        // Test that close() works even if connect() was never called
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("never_connected.db");

        let database = Database::new(db_path.to_string_lossy().to_string());
        // Note: NOT calling connect()

        let result = database.close().await;
        assert!(
            result.is_ok(),
            "Close should succeed even without prior connect"
        );
    }

    #[test]
    fn test_database_close_sync_works() {
        // Test that close_sync() works correctly
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("close_sync_test.db");

        let database = Database::new(db_path.to_string_lossy().to_string());

        // Connect in async context
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            database.connect().await.expect("Failed to connect");
        });

        // close_sync should not panic
        database.close_sync();

        // Verify connection is closed - operations should fail
        rt.block_on(async {
            let result = database.execute("SELECT 1", vec![]).await;
            assert!(result.is_err(), "Should fail after close_sync");
        });
    }

    #[test]
    fn test_database_close_sync_is_idempotent() {
        // Test that calling close_sync() multiple times doesn't panic
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("close_sync_idempotent.db");

        let database = Database::new(db_path.to_string_lossy().to_string());

        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            database.connect().await.expect("Failed to connect");
        });

        // Multiple close_sync calls should not panic
        database.close_sync();
        database.close_sync();
        database.close_sync();
    }

    #[tokio::test]
    async fn test_database_file_handles_released_after_close() {
        // Test that file handles are released after close, allowing file operations
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("handle_release_test.db");
        let db_path_str = db_path.to_string_lossy().to_string();

        {
            let database = Database::new(db_path_str.clone());
            database.connect().await.expect("Failed to connect");

            // Create a table and insert data
            database
                .execute("CREATE TABLE test (id INTEGER PRIMARY KEY)", vec![])
                .await
                .expect("Failed to create table");

            // Close the database
            database.close().await.expect("Failed to close");
        }

        // After close, we should be able to delete the database file
        // This verifies that file handles were properly released
        assert!(db_path.exists(), "Database file should exist");

        // On Windows, this would fail if handles weren't released
        let remove_result = std::fs::remove_file(&db_path);
        assert!(
            remove_result.is_ok(),
            "Should be able to remove db file after close: {:?}",
            remove_result
        );
    }

    #[tokio::test]
    async fn test_database_wal_files_can_be_removed_after_close() {
        // Test that WAL mode files can be cleaned up after database close
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("wal_cleanup_test.db");
        let wal_path = temp_dir.path().join("wal_cleanup_test.db-wal");
        let shm_path = temp_dir.path().join("wal_cleanup_test.db-shm");

        {
            let database = Database::new(db_path.to_string_lossy().to_string());
            database.connect().await.expect("Failed to connect");

            // Perform some writes to ensure WAL files are created
            database
                .execute("CREATE TABLE test (id INTEGER, data TEXT)", vec![])
                .await
                .expect("Failed to create table");

            for i in 0..10 {
                database
                    .execute(
                        "INSERT INTO test (id, data) VALUES (?, ?)",
                        vec![
                            serde_json::Value::Number(i.into()),
                            serde_json::Value::String(format!("data_{}", i)),
                        ],
                    )
                    .await
                    .expect("Failed to insert");
            }

            // Close the database
            database.close().await.expect("Failed to close");
        }

        // Verify main db file exists and can be removed
        assert!(db_path.exists(), "Database file should exist");
        let _ = std::fs::remove_file(&db_path);

        // WAL files may or may not exist depending on checkpointing,
        // but if they exist, they should be removable
        if wal_path.exists() {
            let result = std::fs::remove_file(&wal_path);
            assert!(
                result.is_ok(),
                "Should be able to remove WAL file: {:?}",
                result
            );
        }
        if shm_path.exists() {
            let result = std::fs::remove_file(&shm_path);
            assert!(
                result.is_ok(),
                "Should be able to remove SHM file: {:?}",
                result
            );
        }
    }
}
