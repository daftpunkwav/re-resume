//! One-time copy of the database as it stood before the schema rebuild.
//!
//! Responsibilities:
//! - Copy `<app config>/re-resume.db` to `<app config>/re-resume.pre-v2.db` once
//! - Report which of the three outcomes happened: copied, already copied, no
//!   database to copy
//!
//! Contracts:
//! - `backup_database_once` answers with one tagged value: the outcome status
//!   and, for the two outcomes that leave a file behind, the absolute path of
//!   the copy. `missing-source` carries no path, because there is no file.
//!   The frontend records the answer and does not act on it.
//!
//! Constraints:
//! - The source is resolved under `app_config_dir()`: the SQL plugin resolves a
//!   relative `sqlite:` URL against the application configuration directory, so
//!   the copy must read from that same directory rather than from app data,
//!   which only happens to be the same path on some platforms.
//! - The copy happens before the frontend loads the SQL plugin, which is what
//!   runs the migrations; once the plugin has connected, the file it would copy
//!   already holds the rebuilt schema. The frontend calls this command before
//!   the first `Database.load`.
//! - The destination is named here, not by the caller: a path from the webview
//!   would be a write outside the application configuration directory.
//! - An existing destination is never overwritten. It is the copy of the
//!   pre-rebuild state, and a later launch must not replace it with the rebuilt
//!   schema.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::Manager;

/// File name of the database the SQL plugin opens, relative to the app config
/// directory. Must match `DATABASE_URL` in `lib.rs`.
const DATABASE_FILE_NAME: &str = "re-resume.db";

/// File name of the preserved pre-rebuild copy.
const BACKUP_FILE_NAME: &str = "re-resume.pre-v2.db";

/// Which of the three outcomes the one-time copy reached.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum BackupStatus {
    Created,
    Exists,
    MissingSource,
}

/// The answer the frontend receives.
///
/// The destination is part of the answer rather than appended to a string: the
/// status and the path are read as two fields, so neither side has to parse the
/// other's formatting.
#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct DatabaseBackupOutcome {
    pub status: BackupStatus,
    /// Absolute path of the preserved copy; `None` when there was no database.
    pub path: Option<String>,
}

/// Copies the database file as it is before any migration runs.
///
/// The command runs on the async runtime: the copy is file I/O and the window
/// shows its boot state while the frontend waits for the answer.
#[tauri::command(async)]
pub fn backup_database_once<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<DatabaseBackupOutcome, String> {
    let config_directory = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("cannot resolve the application config directory: {error}"))?;
    copy_once(&config_directory)
}

/// The copy itself, separated from the Tauri handle so the decision logic can
/// be read and tested without a running application.
fn copy_once(config_directory: &Path) -> Result<DatabaseBackupOutcome, String> {
    let source = config_directory.join(DATABASE_FILE_NAME);
    let destination: PathBuf = config_directory.join(BACKUP_FILE_NAME);

    if destination.exists() {
        return Ok(DatabaseBackupOutcome {
            status: BackupStatus::Exists,
            path: Some(destination.display().to_string()),
        });
    }
    if !source.exists() {
        return Ok(DatabaseBackupOutcome {
            status: BackupStatus::MissingSource,
            path: None,
        });
    }
    std::fs::copy(&source, &destination).map_err(|error| {
        format!(
            "cannot copy {} to {}: {error}",
            source.display(),
            destination.display()
        )
    })?;
    Ok(DatabaseBackupOutcome {
        status: BackupStatus::Created,
        path: Some(destination.display().to_string()),
    })
}

#[cfg(test)]
mod tests {
    use super::{copy_once, BackupStatus};
    use std::fs;

    fn temporary_directory(name: &str) -> std::path::PathBuf {
        let directory = std::env::temp_dir().join(format!("re-resume-backup-{name}"));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).expect("temporary directory");
        directory
    }

    #[test]
    fn copies_the_database_when_a_backup_is_absent() {
        let directory = temporary_directory("created");
        fs::write(directory.join("re-resume.db"), b"legacy bytes").expect("write source");

        let outcome = copy_once(&directory).expect("copy succeeds");

        assert_eq!(outcome.status, BackupStatus::Created);
        assert_eq!(
            outcome.path,
            Some(directory.join("re-resume.pre-v2.db").display().to_string())
        );
        assert_eq!(
            fs::read(directory.join("re-resume.pre-v2.db")).expect("backup exists"),
            b"legacy bytes"
        );
        fs::remove_dir_all(directory).expect("cleanup");
    }

    #[test]
    fn keeps_an_existing_backup() {
        let directory = temporary_directory("exists");
        fs::write(directory.join("re-resume.db"), b"rebuilt").expect("write source");
        fs::write(directory.join("re-resume.pre-v2.db"), b"original").expect("write backup");

        let outcome = copy_once(&directory).expect("copy succeeds");

        assert_eq!(outcome.status, BackupStatus::Exists);
        assert!(outcome.path.is_some());
        assert_eq!(
            fs::read(directory.join("re-resume.pre-v2.db")).expect("backup exists"),
            b"original"
        );
        fs::remove_dir_all(directory).expect("cleanup");
    }

    #[test]
    fn reports_a_missing_database() {
        let directory = temporary_directory("no-source");

        let outcome = copy_once(&directory).expect("no source is not an error");

        assert_eq!(outcome.status, BackupStatus::MissingSource);
        assert_eq!(outcome.path, None);
        fs::remove_dir_all(directory).expect("cleanup");
    }
}
