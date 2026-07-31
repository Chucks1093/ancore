//! Dead-letter store for events that fail normalisation.
//!
//! When [`crate::schema::canonical::normalise`] rejects a raw event the ingest
//! worker persists it here so the failure is observable and reprocessable
//! after a fix, instead of being silently dropped.

use anyhow::Context;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

use crate::schema::canonical::RawEvent;

// ── Types ─────────────────────────────────────────────────────────────────────

/// A raw event that could not be normalised, retained for later reprocessing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DeadLetterRecord {
    /// Ingestion stream that produced the failure.
    pub stream: String,
    /// Ledger sequence of the failed event.
    pub ledger_seq: u32,
    /// Human-readable normalisation error.
    pub error: String,
    /// Full raw event payload (recoverable input for reprocessing).
    pub raw: RawEvent,
    /// When the failure was recorded.
    pub failed_at: DateTime<Utc>,
}

// ── Trait ─────────────────────────────────────────────────────────────────────

/// Trait for durable storage of normalisation failures.
#[async_trait::async_trait]
pub trait DeadLetterStore: Send {
    /// Persist one or more dead-letter records.
    async fn persist_failures(&mut self, records: &[DeadLetterRecord]) -> anyhow::Result<()>;
}

// ── Postgres implementation ───────────────────────────────────────────────────

/// Durable dead-letter store backed by PostgreSQL.
#[derive(Debug, Clone)]
pub struct PostgresDeadLetterStore {
    pool: PgPool,
}

impl PostgresDeadLetterStore {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait::async_trait]
impl DeadLetterStore for PostgresDeadLetterStore {
    async fn persist_failures(&mut self, records: &[DeadLetterRecord]) -> anyhow::Result<()> {
        persist_failures(&self.pool, records).await
    }
}

/// Insert dead-letter rows for later reprocessing.
pub async fn persist_failures(db: &PgPool, records: &[DeadLetterRecord]) -> anyhow::Result<()> {
    for record in records {
        let raw_payload =
            serde_json::to_value(&record.raw).context("serialize dead-letter raw payload")?;

        sqlx::query(
            "INSERT INTO ingest_dead_letters \
                (stream, ledger_seq, tx_hash, contract_id, error_message, raw_payload, created_at) \
             VALUES ($1, $2, $3, $4, $5, $6, $7)",
        )
        .bind(&record.stream)
        .bind(record.ledger_seq as i64)
        .bind(&record.raw.tx_hash)
        .bind(&record.raw.contract_id)
        .bind(&record.error)
        .bind(raw_payload)
        .bind(record.failed_at)
        .execute(db)
        .await
        .context("persist dead-letter record")?;
    }

    Ok(())
}

// ── In-memory stub (tests) ────────────────────────────────────────────────────

/// Accumulates dead-letter records in memory for assertion in tests.
#[derive(Debug, Default)]
pub struct MemoryDeadLetterStore {
    pub records: Vec<DeadLetterRecord>,
}

#[async_trait::async_trait]
impl DeadLetterStore for MemoryDeadLetterStore {
    async fn persist_failures(&mut self, records: &[DeadLetterRecord]) -> anyhow::Result<()> {
        self.records.extend_from_slice(records);
        Ok(())
    }
}

// ── Failing stub (tests) ──────────────────────────────────────────────────────

/// A dead-letter store that always returns an error.
pub struct FailingDeadLetterStore;

#[async_trait::async_trait]
impl DeadLetterStore for FailingDeadLetterStore {
    async fn persist_failures(&mut self, _records: &[DeadLetterRecord]) -> anyhow::Result<()> {
        Err(anyhow::anyhow!("simulated dead-letter store failure"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn sample_record() -> DeadLetterRecord {
        DeadLetterRecord {
            stream: "main".into(),
            ledger_seq: 42,
            error: "Missing required field: tx_hash".into(),
            raw: RawEvent {
                ledger_seq: 42,
                ledger_close_time: Utc::now(),
                tx_hash: String::new(),
                contract_id: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN".into(),
                topics: vec!["transfer".into()],
                data: String::new(),
            },
            failed_at: Utc::now(),
        }
    }

    #[tokio::test]
    async fn memory_store_accumulates_records() {
        let mut store = MemoryDeadLetterStore::default();
        let record = sample_record();
        store.persist_failures(&[record.clone()]).await.unwrap();
        assert_eq!(store.records.len(), 1);
        assert_eq!(store.records[0].ledger_seq, 42);
        assert_eq!(store.records[0].error, record.error);
    }

    #[tokio::test]
    async fn failing_store_returns_error() {
        let mut store = FailingDeadLetterStore;
        let err = store
            .persist_failures(&[sample_record()])
            .await
            .unwrap_err();
        assert!(err.to_string().contains("simulated dead-letter"));
    }
}
